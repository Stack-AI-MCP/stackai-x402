import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { registerServer, introspectTools, assertPublicUrl, scanAllKeys } from '../services/registration.service.js'
import type { ServerConfig, RedisLike } from '../services/registration.service.js'
import type { AppEnv } from '../app.js'
import { encrypt } from 'stackai-x402/internal'

const STACKS_ADDRESS_RE = /^S[TPMN][0-9A-Z]{38,}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const RegisterBodySchema = z.object({
  url: z.string().url('url must be a valid URL'),
  name: z.string().min(1, 'name is required'),
  description: z.string().optional(),
  recipientAddress: z
    .string()
    .regex(
      STACKS_ADDRESS_RE,
      'recipientAddress must be a valid Stacks address (SP/ST/SM/SN prefix, min 40 chars)',
    ),
  acceptedTokens: z.array(z.enum(['STX', 'sBTC', 'USDCx'])).optional(),
  toolPricing: z.record(z.string(), z.object({ price: z.number().nonnegative() })).optional(),
  upstreamAuth: z.string().optional(),
  telegramChatId: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  moltbookApiKey: z.string().optional(),
  createMoltbookAgent: z.boolean().optional(),
})

const PatchBodySchema = z.object({
  toolPricing: z.record(z.string(), z.object({ price: z.number().nonnegative() })).optional(),
  acceptedTokens: z.array(z.enum(['STX', 'sBTC', 'USDCx'])).optional(),
  recipientAddress: z
    .string()
    .regex(STACKS_ADDRESS_RE, 'recipientAddress must be a valid Stacks address (SP/ST/SM/SN prefix, min 40 chars)')
    .optional(),
  telegramChatId: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  upstreamAuth: z.string().optional(),
}).strict()

export const serversRouter = new Hono<AppEnv>()

serversRouter.get('/', async (c) => {
  const redis = c.get('redis')

  try {
    const configKeys = await scanAllKeys(redis as never, 'server:*:config')

    if (configKeys.length === 0) {
      return c.json({ servers: [] }, 200)
    }

    // Extract server IDs and build tool keys list
    const serverIds = configKeys.map((key) => key.split(':')[1])
    const toolKeys = serverIds.map((id) => `server:${id}:tools`)

    // Fetch all configs and tools in 2 MGET round-trips instead of 2N individual GETs
    const [configValues, toolValues] = await Promise.all([
      redis.mget(...configKeys),
      redis.mget(...toolKeys),
    ])

    const servers = configValues.map((configJson, i) => {
      if (!configJson) return null

      let config: ServerConfig
      let tools: { name: string; price: number }[] = []

      try {
        config = JSON.parse(configJson) as ServerConfig
      } catch {
        console.error(`Skipping corrupt config for key ${configKeys[i]}`)
        return null
      }

      try {
        tools = toolValues[i] ? (JSON.parse(toolValues[i]!) as { name: string; price: number }[]) : []
      } catch {
        console.error(`Skipping corrupt tools for server ${serverIds[i]}`)
        tools = []
      }

      // Compute price range from tools (only count paid tools)
      const prices = tools.map((t) => t.price).filter((p) => p > 0)
      const priceRange =
        prices.length > 0
          ? { min: Math.min(...prices), max: Math.max(...prices) }
          : { min: 0, max: 0 }

      // Strip sensitive fields before responding
      const { encryptedAuth: _, ...safeConfig } = config

      return {
        ...safeConfig,
        acceptedTokens: safeConfig.acceptedTokens ?? [],
        toolCount: tools.length,
        priceRange,
      }
    })

    return c.json({ servers: servers.filter(Boolean) }, 200)
  } catch (err) {
    console.error('Failed to list servers:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Failed to list servers', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ─── Introspect: GET /api/v1/servers/introspect ─────────────────────────────

serversRouter.get('/introspect', async (c) => {
  const url = c.req.query('url')

  if (!url) {
    return c.json({ error: 'url query parameter is required', code: 'INVALID_REQUEST' }, 400)
  }

  // SSRF protection: reject non-HTTPS and private/loopback addresses
  try {
    assertPublicUrl(url)
  } catch (err) {
    return c.json({ error: (err as Error).message, code: 'INVALID_REQUEST' }, 400)
  }

  // introspectTools has its own try/catch — always returns [] on failure, never throws
  const tools = await introspectTools(url)
  return c.json({ tools }, 200)
})

// ─── Register: POST /api/v1/servers ─────────────────────────────────────────

serversRouter.post('/', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Request body must be valid JSON', code: 'INVALID_REQUEST' }, 400)
  }

  const parsed = RegisterBodySchema.safeParse(body)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return c.json(
      { error: firstError.message, code: 'INVALID_REQUEST', field: firstError.path.join('.') },
      400,
    )
  }

  try {
    const result = await registerServer(parsed.data, {
      redis: c.get('redis'),
      encryptionKey: c.get('encryptionKey'),
    })
    // claimUrl is null when Moltbook was not requested or failed (AC3) — include in response
    return c.json(
      { serverId: result.serverId, gatewayUrl: result.gatewayUrl, ownerKey: result.ownerKey, claimUrl: result.claimUrl ?? null },
      201,
    )
  } catch (err) {
    console.error('Registration failed:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Registration failed', code: 'REGISTRATION_FAILED' }, 500)
  }
})

// ─── Update: PATCH /api/v1/servers/:serverId ─────────────────────────────────

serversRouter.patch('/:serverId', async (c) => {
  const serverId = c.req.param('serverId')

  if (!UUID_RE.test(serverId)) {
    return c.json({ error: 'Invalid server ID format', code: 'INVALID_REQUEST' }, 400)
  }

  const ownerKey = c.req.header('X-Owner-Key')

  if (!ownerKey) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 403)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Request body must be valid JSON', code: 'INVALID_REQUEST' }, 400)
  }

  const parsed = PatchBodySchema.safeParse(body)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return c.json(
      { error: firstError.message, code: 'INVALID_REQUEST', field: firstError.path.join('.') },
      400,
    )
  }

  const redis = c.get('redis')
  const encryptionKey = c.get('encryptionKey')

  // Auth check: constant-time comparison to prevent both timing oracle and key-length oracle
  const storedOwnerKey = await redis.get(`server:${serverId}:ownerKey`)
  const ref = storedOwnerKey ?? '\0'.repeat(ownerKey.length)
  const maxLen = Math.max(ref.length, ownerKey.length)
  const bufA = Buffer.alloc(maxLen)
  const bufB = Buffer.alloc(maxLen)
  Buffer.from(ref).copy(bufA)
  Buffer.from(ownerKey).copy(bufB)
  if (!timingSafeEqual(bufA, bufB) || ref.length !== ownerKey.length || storedOwnerKey === null) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 403)
  }

  // Load existing config
  const configJson = await redis.get(`server:${serverId}:config`)
  if (!configJson) {
    return c.json({ error: 'Server not found', code: 'NOT_FOUND' }, 404)
  }

  let config: ServerConfig
  try {
    config = JSON.parse(configJson) as ServerConfig
  } catch {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  }

  const updates = parsed.data

  // Re-encrypt upstreamAuth if it is being updated — never store plaintext credentials
  const encryptedAuth = updates.upstreamAuth !== undefined
    ? encrypt(updates.upstreamAuth, encryptionKey)
    : undefined

  // Merge only provided fields (partial update — unmentioned fields are unchanged)
  const updatedConfig: ServerConfig = {
    ...config,
    ...(updates.toolPricing !== undefined && { toolPricing: updates.toolPricing }),
    ...(updates.acceptedTokens !== undefined && { acceptedTokens: updates.acceptedTokens }),
    ...(updates.recipientAddress !== undefined && { recipientAddress: updates.recipientAddress }),
    ...(updates.telegramChatId !== undefined && { telegramChatId: updates.telegramChatId }),
    ...(updates.webhookUrl !== undefined && { webhookUrl: updates.webhookUrl }),
    ...(encryptedAuth !== undefined && { encryptedAuth }),
  }

  // Preserve original TTL — KEEPTTL avoids resetting the 30-day expiry on every update
  await redis.set(`server:${serverId}:config`, JSON.stringify(updatedConfig), 'KEEPTTL')

  // Strip sensitive fields from response (encryptedAuth is the stored form of upstreamAuth)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { encryptedAuth: _, ...safeConfig } = updatedConfig
  return c.json(safeConfig, 200)
})
