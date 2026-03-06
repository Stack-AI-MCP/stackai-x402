import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import { registerServer } from '../services/registration.service.js'
import type { ServerConfig } from '../services/registration.service.js'
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
