import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { registerServer, introspectTools } from '../services/registration.service.js'
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
  toolPricing: z.record(z.string(), z.object({ price: z.number() })).optional(),
  upstreamAuth: z.string().optional(),
  telegramChatId: z.string().optional(),
  webhookUrl: z.string().url().optional(),
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

// ─── List: GET /api/v1/servers ──────────────────────────────────────────────

/** Cursor-based SCAN — safe for production unlike KEYS which blocks Redis. */
async function scanAllKeys(redis: RedisLike, pattern: string): Promise<string[]> {
  const keys: string[] = []
  let cursor = '0'
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', '100')
    cursor = nextCursor
    keys.push(...batch)
  } while (cursor !== '0')
  return keys
}

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

  try {
    new URL(url)
  } catch {
    return c.json({ error: 'url must be a valid URL', code: 'INVALID_REQUEST' }, 400)
  }

  try {
    const tools = await introspectTools(url)
    return c.json({ tools }, 200)
  } catch (err) {
    console.error('Introspection failed:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Introspection failed', code: 'INTROSPECT_FAILED' }, 500)
  }
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
    return c.json(result, 201)
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

  // Auth check — timing-safe comparison to prevent brute-force via response timing
  const storedOwnerKey = await redis.get(`server:${serverId}:ownerKey`)
  if (
    storedOwnerKey === null ||
    storedOwnerKey.length !== ownerKey.length ||
    !timingSafeEqual(Buffer.from(storedOwnerKey), Buffer.from(ownerKey))
  ) {
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
