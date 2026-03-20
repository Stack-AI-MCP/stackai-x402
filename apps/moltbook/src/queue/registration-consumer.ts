/**
 * BRPOP consumer for the gateway → moltbook bridge.
 * Pops agent registration requests from Redis queue, registers on Moltbook,
 * generates skill.md via AI, starts heartbeat, and writes status back.
 */

import type { Redis } from 'ioredis'
import { MoltbookClient } from '../moltbook/sdk/index.js'
import type { AgentStore } from '../state/agent-store.js'
import type { HeartbeatEngine } from '../scheduler/heartbeat-engine.js'
import type { ContentGenerator } from '../ai/types.js'
import type { CreateAgentRequest } from '../types.js'
import { logger, errCtx } from '../logger.js'

const log = logger.child('queue')

const QUEUE_KEY = 'moltbook:agent-registrations'
const BRPOP_TIMEOUT = 5 // seconds

interface RegistrationMessage {
  gatewayAgentId: string
  moltbookApiKey: string
  moltbookName: string
  description: string
  tools: Array<{ serverId: string; toolName: string; price: number }>
  heartbeatIntervalHours: number
  action?: undefined
}

interface ApiKeyUpdateMessage {
  gatewayAgentId: string
  moltbookApiKey: string
  moltbookName: string
  action: 'update-api-key'
}

interface DeleteMessage {
  gatewayAgentId: string
  moltbookName: string
  action: 'delete'
}

type QueueMessage = RegistrationMessage | ApiKeyUpdateMessage | DeleteMessage

async function resolveToolDescriptions(
  tools: RegistrationMessage['tools'],
  gatewayUrl: string,
): Promise<string[]> {
  const serverIds = [...new Set(tools.map((t) => t.serverId))]
  const toolNames: string[] = []

  for (const serverId of serverIds) {
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/servers/${serverId}`, {
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        const data = (await res.json()) as { tools?: Array<{ name: string; description?: string }> }
        if (data.tools) {
          for (const tool of tools.filter((t) => t.serverId === serverId)) {
            const match = data.tools.find((t) => t.name === tool.toolName)
            toolNames.push(match ? `${match.name}: ${match.description ?? ''}` : tool.toolName)
          }
        }
      }
    } catch {
      // Fallback to just tool names
      for (const tool of tools.filter((t) => t.serverId === serverId)) {
        toolNames.push(tool.toolName)
      }
    }
  }

  return toolNames.length > 0 ? toolNames : tools.map((t) => t.toolName)
}

export class RegistrationConsumer {
  private running = false

  constructor(
    private redis: Redis,
    private agentStore: AgentStore,
    private engine: HeartbeatEngine,
    private contentGenerator: ContentGenerator,
    private gatewayUrl: string,
  ) {}

  async start(): Promise<void> {
    this.running = true
    log.info('registration consumer started')

    while (this.running) {
      try {
        const result = await this.redis.brpop(QUEUE_KEY, BRPOP_TIMEOUT)
        if (!result) continue // timeout, loop again

        const [, json] = result
        const message = JSON.parse(json) as QueueMessage

        if (message.action === 'update-api-key') {
          await this.processApiKeyUpdate(message)
        } else if (message.action === 'delete') {
          await this.processDelete(message)
        } else {
          await this.processRegistration(message)
        }
      } catch (err) {
        if (!this.running) break
        log.error('error processing registration', errCtx(err))
        // Brief pause on error to avoid tight error loops
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
  }

  stop(): void {
    this.running = false
    log.info('registration consumer stopping')
  }

  private async processRegistration(msg: RegistrationMessage): Promise<void> {
    log.info('processing registration', { gatewayAgentId: msg.gatewayAgentId, name: msg.moltbookName })

    // 1. Resolve tool descriptions from gateway
    const toolDescriptions = await resolveToolDescriptions(msg.tools, this.gatewayUrl)
    const toolNames = msg.tools.map((t) => t.toolName)
    const toolPricing = msg.tools
      .filter((t) => t.price > 0)
      .map((t) => ({ name: t.toolName, price: t.price, token: 'STX' }))

    // 2. Create agent in moltbook store
    const input: CreateAgentRequest = {
      moltbookApiKey: msg.moltbookApiKey,
      moltbookName: msg.moltbookName,
      description: msg.description,
      gatewayAgentId: msg.gatewayAgentId,
      gatewayUrl: this.gatewayUrl,
      toolNames: toolDescriptions.length > 0 ? toolDescriptions : toolNames,
      toolPricing: toolPricing.length > 0 ? toolPricing : undefined,
      heartbeatIntervalHours: msg.heartbeatIntervalHours,
    }

    const record = await this.agentStore.create(input)

    // 3. Register on Moltbook platform FIRST — if this fails hard, don't start heartbeat
    const client = new MoltbookClient({ apiKey: msg.moltbookApiKey })
    let registrationFailed = false
    let claimUrl: string | undefined
    let verificationCode: string | undefined
    try {
      const result = await client.agents.register({
        name: msg.moltbookName,
        description: msg.description,
      })
      claimUrl = result.agent.claim_url
      verificationCode = result.agent.verification_code
      log.info('registered on Moltbook', { name: msg.moltbookName, claimUrl })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message.toLowerCase() : ''
      if (errMsg.includes('already exists') || errMsg.includes('conflict')) {
        log.info('already registered on Moltbook, continuing', { name: msg.moltbookName })
      } else {
        log.error('Moltbook registration failed', { name: msg.moltbookName, ...errCtx(err) })
        registrationFailed = true
      }
    }

    if (registrationFailed) {
      // Write failure status back to gateway Redis so the frontend shows what happened
      await this.redis.set(
        `moltbook:status:${msg.gatewayAgentId}`,
        JSON.stringify({
          moltbookStatus: 'registration_failed',
          error: 'Moltbook API rejected the registration. The name may be taken or invalid.',
        }),
        'EX',
        60 * 60 * 24 * 7, // 7 days
      )
      // Clean up the local record since Moltbook registration failed
      await this.agentStore.delete(record.id)
      log.error('aborted registration — Moltbook API rejected', { name: msg.moltbookName })
      return
    }

    // 4. Generate skill.md via AI
    try {
      const skillMd = await this.contentGenerator.generateSkillMd(record)
      await this.agentStore.setSkillMd(record.id, skillMd)
      log.info('generated skill.md', { name: msg.moltbookName, chars: skillMd.length })
    } catch (err) {
      log.warn('skill.md generation failed (will use template)', errCtx(err))
    }

    // 5. Start heartbeat
    this.engine.start(record.id, record.heartbeatIntervalHours)

    // 6. Write status for gateway to read (include claim URL for web UI)
    await this.writeGatewayStatus(msg.gatewayAgentId, record.id, 'pending_claim', undefined, claimUrl, verificationCode)

    log.info('registration complete', { name: msg.moltbookName, moltbookId: record.id })
  }

  private async processApiKeyUpdate(msg: ApiKeyUpdateMessage): Promise<void> {
    log.info('processing API key update', { gatewayAgentId: msg.gatewayAgentId, name: msg.moltbookName })

    // Find the moltbook agent linked to this gateway agent
    const agents = await this.agentStore.list()
    const agent = agents.find((a) => a.gatewayAgentId === msg.gatewayAgentId || a.moltbookName === msg.moltbookName)
    if (!agent) {
      log.warn('API key update: agent not found', { gatewayAgentId: msg.gatewayAgentId })
      return
    }

    await this.agentStore.updateApiKey(agent.id, msg.moltbookApiKey)
    log.info('API key updated', { name: msg.moltbookName, agentId: agent.id })
  }

  private async processDelete(msg: DeleteMessage): Promise<void> {
    log.info('processing agent delete', { gatewayAgentId: msg.gatewayAgentId, name: msg.moltbookName })

    const agents = await this.agentStore.list()
    const agent = agents.find((a) => a.gatewayAgentId === msg.gatewayAgentId || a.moltbookName === msg.moltbookName)
    if (!agent) {
      log.warn('delete: agent not found', { gatewayAgentId: msg.gatewayAgentId })
      return
    }

    this.engine.stop(agent.id)
    await this.agentStore.delete(agent.id)
    await this.redis.del(`moltbook:status:${msg.gatewayAgentId}`)
    log.info('agent deleted', { name: msg.moltbookName, agentId: agent.id })
  }

  async writeGatewayStatus(
    gatewayAgentId: string,
    moltbookAgentId: string,
    status: string,
    engagement?: { seen: number; voted: number; commented: number },
    claimUrl?: string,
    verificationCode?: string,
  ): Promise<void> {
    const statusData = {
      moltbookAgentId,
      moltbookStatus: status,
      heartbeatRunning: this.engine.isRunning(moltbookAgentId),
      lastHeartbeat: new Date().toISOString(),
      engagement: engagement ?? { seen: 0, voted: 0, commented: 0 },
      ...(claimUrl && { claimUrl }),
      ...(verificationCode && { verificationCode }),
    }
    await this.redis.set(
      `moltbook:status:${gatewayAgentId}`,
      JSON.stringify(statusData),
      'EX',
      60 * 60 * 24 * 30, // 30 days
    )
  }
}
