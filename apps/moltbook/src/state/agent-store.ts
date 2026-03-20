/**
 * Redis CRUD for MoltbookAgentRecord.
 */

import type { Redis } from 'ioredis'
import type { MoltbookAgentRecord, CreateAgentRequest, UpdateAgentRequest, GatewayServerConfig, GatewayToolDef, GatewayServerInfo } from '../types.js'
import { logger, errCtx } from '../logger.js'

const log = logger.child('agent-store')

const PREFIX = 'moltbook:agent'
const LIST_KEY = 'moltbook:agents:list'
const TTL_30D = 60 * 60 * 24 * 30

function configKey(id: string): string { return `${PREFIX}:${id}:config` }

function generateId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${ts}${rand}`
}

function safeParse(json: string): MoltbookAgentRecord | null {
  try {
    return JSON.parse(json) as MoltbookAgentRecord
  } catch (err) {
    log.error('corrupt JSON in Redis, skipping', errCtx(err))
    return null
  }
}

export class AgentStore {
  constructor(private redis: Redis) {}

  async create(input: CreateAgentRequest): Promise<MoltbookAgentRecord> {
    const id = generateId()
    const now = new Date().toISOString()

    const record: MoltbookAgentRecord = {
      id,
      gatewayServerId: input.gatewayServerId,
      gatewayAgentId: input.gatewayAgentId,
      moltbookApiKey: input.moltbookApiKey,
      moltbookName: input.moltbookName,
      moltbookStatus: 'pending_claim',
      description: input.description,
      gatewayUrl: input.gatewayUrl,
      toolNames: input.toolNames,
      toolPricing: input.toolPricing,
      heartbeatIntervalHours: input.heartbeatIntervalHours ?? 6,
      heartbeatEnabled: true,
      createdAt: now,
      updatedAt: now,
    }

    await this.redis.set(configKey(id), JSON.stringify(record), 'EX', TTL_30D)
    await this.redis.zadd(LIST_KEY, Date.now(), id)

    return record
  }

  async get(id: string): Promise<MoltbookAgentRecord | null> {
    const json = await this.redis.get(configKey(id))
    if (!json) return null
    return safeParse(json)
  }

  async update(id: string, updates: UpdateAgentRequest): Promise<MoltbookAgentRecord | null> {
    const existing = await this.get(id)
    if (!existing) return null

    const updated: MoltbookAgentRecord = {
      ...existing,
      ...(updates.heartbeatIntervalHours !== undefined && { heartbeatIntervalHours: updates.heartbeatIntervalHours }),
      ...(updates.heartbeatEnabled !== undefined && { heartbeatEnabled: updates.heartbeatEnabled }),
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.toolNames !== undefined && { toolNames: updates.toolNames }),
      ...(updates.toolPricing !== undefined && { toolPricing: updates.toolPricing }),
      updatedAt: new Date().toISOString(),
    }

    await this.redis.set(configKey(id), JSON.stringify(updated), 'KEEPTTL')
    return updated
  }

  /**
   * Set skillMd directly on the agent record.
   * Separate from update() because skillMd is generated internally, not via user input.
   */
  async setSkillMd(id: string, skillMd: string): Promise<void> {
    const existing = await this.get(id)
    if (!existing) return
    existing.skillMd = skillMd
    existing.updatedAt = new Date().toISOString()
    await this.redis.set(configKey(id), JSON.stringify(existing), 'KEEPTTL')
  }

  async updateApiKey(id: string, apiKey: string): Promise<void> {
    const existing = await this.get(id)
    if (!existing) return
    existing.moltbookApiKey = apiKey
    existing.updatedAt = new Date().toISOString()
    await this.redis.set(configKey(id), JSON.stringify(existing), 'KEEPTTL')
  }

  async setStatus(id: string, status: MoltbookAgentRecord['moltbookStatus']): Promise<void> {
    const existing = await this.get(id)
    if (!existing) return
    existing.moltbookStatus = status
    existing.updatedAt = new Date().toISOString()
    await this.redis.set(configKey(id), JSON.stringify(existing), 'KEEPTTL')
  }

  async setLastHeartbeat(id: string, nextHeartbeat: string): Promise<void> {
    const existing = await this.get(id)
    if (!existing) return
    existing.lastHeartbeat = new Date().toISOString()
    existing.nextHeartbeat = nextHeartbeat
    existing.updatedAt = new Date().toISOString()
    await this.redis.set(configKey(id), JSON.stringify(existing), 'KEEPTTL')
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.redis.del(configKey(id))
    await this.redis.zrem(LIST_KEY, id)

    // Clean up engagement tracking keys (best-effort)
    const engagementKeys = [
      `${PREFIX}:${id}:seen`,
      `${PREFIX}:${id}:voted`,
      `${PREFIX}:${id}:commented`,
      `${PREFIX}:${id}:lastPost`,
      `${PREFIX}:${id}:lastComment`,
      `${PREFIX}:${id}:skillmd`,
    ]
    try {
      await this.redis.del(...engagementKeys)
    } catch {
      // Best-effort cleanup — these keys have TTLs and will expire naturally
    }

    return deleted > 0
  }

  async list(): Promise<MoltbookAgentRecord[]> {
    const ids = await this.redis.zrange(LIST_KEY, 0, -1)
    if (ids.length === 0) return []

    const pipeline = this.redis.pipeline()
    for (const id of ids) pipeline.get(configKey(id))
    const results = await pipeline.exec()

    const records: MoltbookAgentRecord[] = []
    for (const result of results ?? []) {
      if (result[1]) {
        const parsed = safeParse(result[1] as string)
        if (parsed) records.push(parsed)
      }
    }
    return records
  }

  async findByServerId(serverId: string): Promise<MoltbookAgentRecord | null> {
    const all = await this.list()
    return all.find((a) => a.gatewayServerId === serverId) ?? null
  }

  /**
   * Read real server config + tools from gateway Redis keys.
   * The gateway stores servers as:
   *   server:{serverId}:config → JSON (GatewayServerConfig)
   *   server:{serverId}:tools  → JSON array (GatewayToolDef[])
   */
  async getServerInfo(serverId: string): Promise<GatewayServerInfo | null> {
    const [configJson, toolsJson] = await this.redis.mget(
      `server:${serverId}:config`,
      `server:${serverId}:tools`,
    )
    if (!configJson) return null

    try {
      const config = JSON.parse(configJson) as GatewayServerConfig
      const tools = toolsJson ? JSON.parse(toolsJson) as GatewayToolDef[] : []
      return { config, tools }
    } catch (err) {
      log.error('failed to parse server info from Redis', { serverId, ...errCtx(err) })
      return null
    }
  }

  /**
   * List all registered gateway servers by scanning server:*:config keys.
   */
  async listServers(): Promise<GatewayServerInfo[]> {
    const keys: string[] = []
    let cursor = '0'
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', 'server:*:config', 'COUNT', 100)
      cursor = next
      keys.push(...batch)
    } while (cursor !== '0')

    const servers: GatewayServerInfo[] = []
    for (const key of keys) {
      const serverId = key.split(':')[1]
      const info = await this.getServerInfo(serverId)
      if (info) servers.push(info)
    }
    return servers
  }

  /**
   * Enrich a MoltbookAgentRecord with real tool data from the gateway.
   * If the agent has a gatewayServerId, reads the actual tools from Redis
   * and overrides the agent's toolNames/toolPricing with real data.
   */
  async enrichWithServerTools(agent: MoltbookAgentRecord): Promise<MoltbookAgentRecord> {
    if (!agent.gatewayServerId) return agent

    const info = await this.getServerInfo(agent.gatewayServerId)
    if (!info) return agent

    return {
      ...agent,
      description: info.config.description || agent.description,
      gatewayUrl: info.config.url,
      toolNames: info.tools.map((t) => t.name),
      toolPricing: info.tools.map((t) => ({
        name: t.name,
        price: t.price,
        token: info.config.acceptedTokens[0] ?? 'STX',
      })),
    }
  }
}
