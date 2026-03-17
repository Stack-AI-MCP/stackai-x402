import type { RedisLike } from '../services/registration.service.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentTool {
  serverId: string
  toolName: string
  /** USD price per call (0 = free) */
  price: number
}

export interface AgentConfig {
  agentId: string
  name: string
  description: string
  ownerAddress: string
  moltbookAgentId?: string
  moltbookName?: string
  tools: AgentTool[]
  systemPrompt?: string
  starterPrompts?: string[]
  heartbeatIntervalHours?: number
  network: 'mainnet' | 'testnet'
  createdAt: string
  updatedAt: string
}

export interface CreateAgentInput {
  name: string
  description: string
  ownerAddress: string
  tools: AgentTool[]
  moltbookName?: string
  systemPrompt?: string
  starterPrompts?: string[]
  heartbeatIntervalHours?: number
  network?: 'mainnet' | 'testnet'
}

export interface ListAgentsOptions {
  page?: number
  limit?: number
}

// ─── ULID generation (simple timestamp-based, no dependency) ──────────────────

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function generateUlid(): string {
  const now = Date.now()
  let id = ''
  // Timestamp part (10 chars, 48-bit millisecond)
  let ts = now
  for (let i = 9; i >= 0; i--) {
    id = ENCODING[ts % 32] + id
    ts = Math.floor(ts / 32)
  }
  // Random part (16 chars)
  for (let i = 0; i < 16; i++) {
    id += ENCODING[Math.floor(Math.random() * 32)]
  }
  return id
}

// ─── Service ──────────────────────────────────────────────────────────────────

const TTL = 2_592_000 // 30 days

export async function createAgent(
  input: CreateAgentInput,
  deps: { redis: RedisLike },
): Promise<AgentConfig> {
  const { redis } = deps
  const agentId = generateUlid()
  const now = new Date().toISOString()

  // Validate that all referenced servers exist
  const serverIds = [...new Set(input.tools.map((t) => t.serverId))]
  if (serverIds.length > 0) {
    const configKeys = serverIds.map((id) => `server:${id}:config`)
    const configs = await redis.mget(...configKeys)
    for (let i = 0; i < serverIds.length; i++) {
      if (!configs[i]) {
        throw new Error(`Server ${serverIds[i]} not found`)
      }
    }
  }

  const config: AgentConfig = {
    agentId,
    name: input.name,
    description: input.description,
    ownerAddress: input.ownerAddress,
    tools: input.tools,
    network: input.network ?? 'mainnet',
    createdAt: now,
    updatedAt: now,
    ...(input.moltbookName && { moltbookName: input.moltbookName }),
    ...(input.systemPrompt && { systemPrompt: input.systemPrompt }),
    ...(input.starterPrompts?.length && { starterPrompts: input.starterPrompts }),
    ...(input.heartbeatIntervalHours && { heartbeatIntervalHours: input.heartbeatIntervalHours }),
  }

  await Promise.all([
    redis.set(`agent:${agentId}:config`, JSON.stringify(config), 'EX', TTL),
    // Add to sorted set for listing (score = timestamp for ordering)
    redis.zadd('agents:list', Date.now(), agentId),
  ])

  return config
}

export async function getAgent(
  agentId: string,
  deps: { redis: RedisLike },
): Promise<AgentConfig | null> {
  const json = await deps.redis.get(`agent:${agentId}:config`)
  if (!json) return null
  try {
    return JSON.parse(json) as AgentConfig
  } catch {
    return null
  }
}

export async function listAgents(
  deps: { redis: RedisLike },
  options?: ListAgentsOptions,
): Promise<{ agents: AgentConfig[]; total: number }> {
  const { redis } = deps
  const page = options?.page ?? 1
  const limit = Math.min(options?.limit ?? 24, 100)
  const start = (page - 1) * limit
  const end = start + limit - 1

  const total = await redis.zcard('agents:list')
  const agentIds = await redis.zrevrange('agents:list', start, end)

  if (agentIds.length === 0) {
    return { agents: [], total }
  }

  const configKeys = agentIds.map((id: string) => `agent:${id}:config`)
  const configs = await redis.mget(...configKeys)

  const agents = configs
    .map((json: string | null) => {
      if (!json) return null
      try {
        return JSON.parse(json) as AgentConfig
      } catch {
        return null
      }
    })
    .filter(Boolean) as AgentConfig[]

  return { agents, total }
}

export async function updateAgent(
  agentId: string,
  updates: Partial<Pick<AgentConfig, 'name' | 'description' | 'tools' | 'moltbookName' | 'moltbookAgentId' | 'systemPrompt' | 'starterPrompts' | 'heartbeatIntervalHours'>>,
  deps: { redis: RedisLike },
): Promise<AgentConfig | null> {
  const existing = await getAgent(agentId, deps)
  if (!existing) return null

  const updated: AgentConfig = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  await deps.redis.set(`agent:${agentId}:config`, JSON.stringify(updated), 'KEEPTTL')
  return updated
}

export async function deleteAgent(
  agentId: string,
  deps: { redis: RedisLike },
): Promise<boolean> {
  const exists = await deps.redis.get(`agent:${agentId}:config`)
  if (!exists) return false

  await Promise.all([
    deps.redis.del(`agent:${agentId}:config`),
    deps.redis.zrem('agents:list', agentId),
  ])
  return true
}

// ─── Transaction logging ────────────────────────────────────────────────────

export interface TransactionRecord {
  id: string
  status: 'settled' | 'free' | 'failed'
  serverId: string
  serverName: string
  agentId?: string
  agentName?: string
  moltbookName?: string
  toolName: string
  amount: string
  token: string
  network: 'mainnet' | 'testnet'
  payer: string
  txHash?: string
  timestamp: string
}

export async function logTransaction(
  record: TransactionRecord,
  deps: { redis: RedisLike },
): Promise<void> {
  const score = new Date(record.timestamp).getTime()
  await deps.redis.zadd('transactions:log', score, JSON.stringify(record))
}
