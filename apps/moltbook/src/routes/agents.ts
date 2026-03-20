import { Hono } from 'hono'
import { z } from 'zod'
import { MoltbookClient } from '../moltbook/sdk/index.js'
import type { AgentStore } from '../state/agent-store.js'
import type { EngagementTracker } from '../state/engagement-tracker.js'
import type { HeartbeatEngine } from '../scheduler/heartbeat-engine.js'
import type { CreateAgentRequest } from '../types.js'

const createAgentSchema = z.object({
  moltbookApiKey: z.string().startsWith('moltbook_'),
  moltbookName: z.string().min(2).max(32),
  description: z.string().max(500),
  gatewayServerId: z.string().optional(),
  gatewayAgentId: z.string().optional(),
  gatewayUrl: z.string(),
  toolNames: z.array(z.string()),
  toolPricing: z.array(z.object({
    name: z.string(),
    price: z.number(),
    token: z.string(),
  })).optional(),
  heartbeatIntervalHours: z.number().min(1).max(24).default(6),
})

const updateAgentSchema = z.object({
  heartbeatIntervalHours: z.number().min(1).max(24).optional(),
  heartbeatEnabled: z.boolean().optional(),
  description: z.string().max(500).optional(),
  toolNames: z.array(z.string()).optional(),
  toolPricing: z.array(z.object({
    name: z.string(),
    price: z.number(),
    token: z.string(),
  })).optional(),
})

export function agentRoutes(
  agentStore: AgentStore,
  tracker: EngagementTracker,
  engine: HeartbeatEngine,
): Hono {
  const app = new Hono()

  // Register new agent
  app.post('/agents', async (c) => {
    const body = await c.req.json()
    const parsed = createAgentSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const input = parsed.data as CreateAgentRequest

    // Register on Moltbook
    const client = new MoltbookClient({ apiKey: input.moltbookApiKey })
    let claimUrl: string | undefined
    let registrationResult: Awaited<ReturnType<typeof client.agents.register>> | undefined

    try {
      registrationResult = await client.agents.register({
        name: input.moltbookName,
        description: input.description,
      })
      claimUrl = registrationResult.agent.claim_url
    } catch (err) {
      // If agent already exists, that's fine — continue
      if (err instanceof Error && !err.message.includes('already exists') && !err.message.includes('CONFLICT')) {
        return c.json({ error: `Moltbook registration failed: ${err.message}` }, 502)
      }
    }

    // Store in our system
    const record = await agentStore.create(input)

    // Start heartbeat
    if (record.heartbeatEnabled) {
      engine.start(record.id, record.heartbeatIntervalHours)
    }

    return c.json({
      agent: record,
      claimUrl,
      message: claimUrl
        ? 'Agent registered! Claim your agent on Moltbook to activate.'
        : 'Agent registered (may already be claimed).',
    }, 201)
  })

  // List all agents
  app.get('/agents', async (c) => {
    const agents = await agentStore.list()
    return c.json({
      agents: agents.map((a) => ({
        ...a,
        moltbookApiKey: undefined, // Never expose API keys
        heartbeatRunning: engine.isRunning(a.id),
      })),
    })
  })

  // Get agent details
  app.get('/agents/:id', async (c) => {
    const agent = await agentStore.get(c.req.param('id'))
    if (!agent) return c.json({ error: 'Agent not found' }, 404)

    const stats = await tracker.getStats(agent.id)
    return c.json({
      agent: { ...agent, moltbookApiKey: undefined },
      heartbeatRunning: engine.isRunning(agent.id),
      engagement: stats,
    })
  })

  // Update agent
  app.put('/agents/:id', async (c) => {
    const body = await c.req.json()
    const parsed = updateAgentSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
    }

    const updated = await agentStore.update(c.req.param('id'), parsed.data)
    if (!updated) return c.json({ error: 'Agent not found' }, 404)

    // Restart heartbeat if interval changed
    if (parsed.data.heartbeatIntervalHours !== undefined || parsed.data.heartbeatEnabled !== undefined) {
      if (updated.heartbeatEnabled) {
        engine.start(updated.id, updated.heartbeatIntervalHours)
      } else {
        engine.stop(updated.id)
      }
    }

    return c.json({ agent: { ...updated, moltbookApiKey: undefined } })
  })

  // Delete agent
  app.delete('/agents/:id', async (c) => {
    const id = c.req.param('id')
    engine.stop(id)
    const deleted = await agentStore.delete(id)
    if (!deleted) return c.json({ error: 'Agent not found' }, 404)
    return c.json({ deleted: true })
  })

  // Trigger manual heartbeat
  app.post('/agents/:id/heartbeat', async (c) => {
    const agent = await agentStore.get(c.req.param('id'))
    if (!agent) return c.json({ error: 'Agent not found' }, 404)

    await engine.triggerNow(agent.id)
    return c.json({ triggered: true, agentId: agent.id })
  })

  // Check Moltbook claim status
  app.get('/agents/:id/status', async (c) => {
    const agent = await agentStore.get(c.req.param('id'))
    if (!agent) return c.json({ error: 'Agent not found' }, 404)

    try {
      const client = new MoltbookClient({ apiKey: agent.moltbookApiKey })
      const status = await client.agents.getStatus()

      // Update local status if changed
      const newStatus = status.status === 'claimed' ? 'active' : 'pending_claim'
      if (agent.moltbookStatus !== newStatus) {
        await agentStore.setStatus(agent.id, newStatus)
      }

      return c.json({ status: newStatus, moltbookStatus: status.status })
    } catch (err) {
      return c.json({ error: `Failed to check status: ${err instanceof Error ? err.message : err}` }, 502)
    }
  })

  return app
}
