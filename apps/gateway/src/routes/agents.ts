import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app.js'
import { verifyMessageSignature } from '../services/auth.service.js'
import {
  createAgent,
  getAgent,
  listAgents,
  updateAgent,
  deleteAgent,
} from '../services/agent.service.js'

const STACKS_ADDRESS_RE = /^S[TPMN][0-9A-Z]{38,}$/
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

const AgentToolSchema = z.object({
  serverId: z.string().min(1),
  toolName: z.string().min(1),
  price: z.number().nonnegative(),
})

const CreateAgentSchema = z.object({
  name: z.string().min(1, 'name is required'),
  description: z.string().min(1, 'description is required'),
  ownerAddress: z.string().regex(STACKS_ADDRESS_RE, 'ownerAddress must be a valid Stacks address'),
  tools: z.array(AgentToolSchema).min(1, 'at least one tool is required'),
  moltbookName: z.string().optional(),
  moltbookApiKey: z.string().startsWith('moltbook_').optional(),
  heartbeatIntervalHours: z.number().min(1).max(24).optional(),
  systemPrompt: z.string().optional(),
  starterPrompts: z.array(z.string()).optional(),
  network: z.enum(['mainnet', 'testnet']).default('mainnet'),
  // Auth
  signature: z.string().optional(),
  publicKey: z.string().optional(),
  signedMessage: z.string().optional(),
})

const UpdateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  tools: z.array(AgentToolSchema).min(1).optional(),
  moltbookName: z.string().optional(),
  systemPrompt: z.string().optional(),
  starterPrompts: z.array(z.string()).optional(),
  // Auth
  signature: z.string().optional(),
  publicKey: z.string().optional(),
  signedMessage: z.string().optional(),
}).strict()

export const agentsRouter = new Hono<AppEnv>()

// ─── List agents: GET /agents ────────────────────────────────────────────────

agentsRouter.get('/', async (c) => {
  const redis = c.get('redis')
  const page = parseInt(c.req.query('page') ?? '1', 10)
  const limit = parseInt(c.req.query('limit') ?? '24', 10)

  try {
    const result = await listAgents({ redis }, { page, limit })
    return c.json({
      agents: result.agents,
      pagination: {
        page,
        limit,
        total: result.total,
        pages: Math.ceil(result.total / limit),
      },
    })
  } catch (err) {
    console.error('Failed to list agents:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Failed to list agents', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ─── Create agent: POST /agents ──────────────────────────────────────────────

agentsRouter.post('/', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Request body must be valid JSON', code: 'INVALID_REQUEST' }, 400)
  }

  const parsed = CreateAgentSchema.safeParse(body)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return c.json(
      { error: firstError.message, code: 'INVALID_REQUEST', field: firstError.path.join('.') },
      400,
    )
  }

  const { signature, publicKey, signedMessage, ...agentInput } = parsed.data

  // Require wallet ownership proof — prevents anyone from claiming an arbitrary ownerAddress
  if (!signature || !publicKey || !signedMessage) {
    return c.json({ error: 'Signature, publicKey, and signedMessage are required', code: 'UNAUTHORIZED' }, 403)
  }

  const valid = verifyMessageSignature(
    { message: signedMessage, signature, publicKey },
    agentInput.ownerAddress,
  )
  if (!valid) {
    return c.json({ error: 'Invalid signature', code: 'UNAUTHORIZED' }, 403)
  }

  const redis = c.get('redis')

  try {
    const agent = await createAgent(agentInput, { redis })

    // Bridge to moltbook service via Redis queue (API key passes through, not stored in gateway)
    if (parsed.data.moltbookApiKey && agentInput.moltbookName) {
      await (redis as any).lpush('moltbook:agent-registrations', JSON.stringify({ // eslint-disable-line @typescript-eslint/no-explicit-any
        gatewayAgentId: agent.agentId,
        moltbookApiKey: parsed.data.moltbookApiKey,
        moltbookName: agentInput.moltbookName,
        description: agentInput.description,
        tools: agentInput.tools,
        heartbeatIntervalHours: parsed.data.heartbeatIntervalHours ?? 6,
      }))
    }

    return c.json(agent, 201)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Agent creation failed'
    if (msg.includes('not found')) {
      return c.json({ error: msg, code: 'INVALID_REQUEST' }, 400)
    }
    console.error('Agent creation failed:', msg)
    return c.json({ error: 'Agent creation failed', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ─── Get agent: GET /agents/:agentId ─────────────────────────────────────────

agentsRouter.get('/:agentId', async (c) => {
  const agentId = c.req.param('agentId')
  const redis = c.get('redis')

  if (!ULID_RE.test(agentId)) {
    return c.json({ error: 'Invalid agent ID format', code: 'INVALID_REQUEST' }, 400)
  }

  const agent = await getAgent(agentId, { redis })
  if (!agent) {
    return c.json({ error: 'Agent not found', code: 'NOT_FOUND' }, 404)
  }

  // Resolve tool details from upstream servers
  const serverIds = [...new Set(agent.tools.map((t) => t.serverId))]
  const configKeys = serverIds.map((id) => `server:${id}:config`)
  const configs = await redis.mget(...configKeys)

  const serverMap = new Map<string, { name: string; url: string }>()
  configs.forEach((json: string | null, i: number) => {
    if (json) {
      try {
        const config = JSON.parse(json)
        serverMap.set(serverIds[i], { name: config.name, url: config.url })
      } catch { /* skip */ }
    }
  })

  const resolvedTools = agent.tools.map((t) => ({
    ...t,
    serverName: serverMap.get(t.serverId)?.name ?? 'Unknown',
  }))

  // Enrich with moltbook status if available
  const moltbookStatusJson = await redis.get(`moltbook:status:${agentId}`)
  const moltbook = moltbookStatusJson ? JSON.parse(moltbookStatusJson) : undefined

  return c.json({ ...agent, tools: resolvedTools, ...(moltbook && { moltbook }) })
})

// ─── Update agent: PUT /agents/:agentId ──────────────────────────────────────

agentsRouter.put('/:agentId', async (c) => {
  const agentId = c.req.param('agentId')
  const redis = c.get('redis')

  if (!ULID_RE.test(agentId)) {
    return c.json({ error: 'Invalid agent ID format', code: 'INVALID_REQUEST' }, 400)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Request body must be valid JSON', code: 'INVALID_REQUEST' }, 400)
  }

  const parsed = UpdateAgentSchema.safeParse(body)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return c.json(
      { error: firstError.message, code: 'INVALID_REQUEST', field: firstError.path.join('.') },
      400,
    )
  }

  // Verify ownership
  const existing = await getAgent(agentId, { redis })
  if (!existing) {
    return c.json({ error: 'Agent not found', code: 'NOT_FOUND' }, 404)
  }

  const { signature, publicKey, signedMessage, ...updates } = parsed.data

  if (signature && publicKey) {
    const valid = verifyMessageSignature(
      { message: signedMessage ?? '', signature, publicKey },
      existing.ownerAddress,
    )
    if (!valid) {
      return c.json({ error: 'Invalid signature', code: 'UNAUTHORIZED' }, 403)
    }
  } else {
    return c.json({ error: 'Signature required for updates', code: 'UNAUTHORIZED' }, 403)
  }

  const updated = await updateAgent(agentId, updates, { redis })
  return c.json(updated)
})

// ─── Delete agent: DELETE /agents/:agentId ───────────────────────────────────

agentsRouter.delete('/:agentId', async (c) => {
  const agentId = c.req.param('agentId')
  const redis = c.get('redis')

  if (!ULID_RE.test(agentId)) {
    return c.json({ error: 'Invalid agent ID format', code: 'INVALID_REQUEST' }, 400)
  }

  const existing = await getAgent(agentId, { redis })
  if (!existing) {
    return c.json({ error: 'Agent not found', code: 'NOT_FOUND' }, 404)
  }

  // Verify ownership
  let body: { signature?: string; publicKey?: string; signedMessage?: string } = {}
  try {
    body = await c.req.json()
  } catch { /* no body is fine if we add header-based auth later */ }

  if (body.signature && body.publicKey) {
    const valid = verifyMessageSignature(
      { message: body.signedMessage ?? '', signature: body.signature, publicKey: body.publicKey },
      existing.ownerAddress,
    )
    if (!valid) {
      return c.json({ error: 'Invalid signature', code: 'UNAUTHORIZED' }, 403)
    }
  } else {
    return c.json({ error: 'Signature required', code: 'UNAUTHORIZED' }, 403)
  }

  await deleteAgent(agentId, { redis })
  return c.json({ message: 'Agent deleted' })
})
