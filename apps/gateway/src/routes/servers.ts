import { Hono } from 'hono'
import { z } from 'zod'
import { registerServer, introspectTools, introspectServerInfo, assertPublicUrl, scanAllKeys } from '../services/registration.service.js'
import type { ServerConfig } from '../services/registration.service.js'
import type { AppEnv } from '../app.js'
import { encrypt } from 'stackai-x402/internal'
import { verifyMessageSignature } from '../services/auth.service.js'

const STACKS_RE = /^S[TPMN][0-9A-Z]{38,}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const RegisterBody = z.object({
  url: z.string().url(),
  name: z.string().min(1),
  description: z.string().optional(),
  recipientAddress: z.string().regex(STACKS_RE),
  ownerAddress: z.string().regex(STACKS_RE),
  network: z.enum(['mainnet', 'testnet']).default('mainnet'),
  acceptedTokens: z.array(z.enum(['STX', 'sBTC', 'USDCx'])).optional(),
  toolPricing: z.record(z.string(), z.object({ price: z.number().nonnegative() })).optional(),
  upstreamAuth: z.string().optional(),
  telegramChatId: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  moltbookApiKey: z.string().optional(),
  createMoltbookAgent: z.boolean().optional(),
  signature: z.string().optional(),
  publicKey: z.string().optional(),
})

const PatchBody = z.object({
  toolPricing: z.record(z.string(), z.object({ price: z.number().nonnegative() })).optional(),
  acceptedTokens: z.array(z.enum(['STX', 'sBTC', 'USDCx'])).optional(),
  recipientAddress: z.string().regex(STACKS_RE).optional(),
  telegramChatId: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  upstreamAuth: z.string().optional(),
  signature: z.string(),
  publicKey: z.string(),
  signedMessage: z.string(),
})

export const serversRouter = new Hono<AppEnv>()

// ─── List ────────────────────────────────────────────────────────────────────

serversRouter.get('/', async (c) => {
  const redis = c.get('redis')
  const configKeys = await scanAllKeys(redis as never, 'server:*:config')
  if (!configKeys.length) return c.json({ servers: [] })

  const ids = configKeys.map((k) => k.split(':')[1])
  const toolKeys = ids.map((id) => `server:${id}:tools`)
  const [configs, toolSets] = await Promise.all([redis.mget(...configKeys), redis.mget(...toolKeys)])

  const servers = configs.map((json, i) => {
    if (!json) return null
    try {
      const cfg = JSON.parse(json) as ServerConfig
      const tools: { price: number }[] = toolSets[i] ? JSON.parse(toolSets[i]!) : []
      const prices = tools.map((t) => t.price).filter((p) => p > 0)
      const { encryptedAuth: _, ...safe } = cfg
      return { ...safe, acceptedTokens: safe.acceptedTokens ?? [], toolCount: tools.length, priceRange: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : { min: 0, max: 0 } }
    } catch { return null }
  })

  return c.json({ servers: servers.filter(Boolean) })
})

// ─── Introspect ──────────────────────────────────────────────────────────────

serversRouter.get('/introspect', async (c) => {
  const url = c.req.query('url')
  if (!url) return c.json({ error: 'url query parameter is required', code: 'INVALID_REQUEST' }, 400)

  try { assertPublicUrl(url) } catch (err) {
    return c.json({ error: (err as Error).message, code: 'INVALID_REQUEST' }, 400)
  }

  const [tools, serverInfo] = await Promise.all([introspectTools(url), introspectServerInfo(url)])
  return c.json({ tools, serverInfo })
})

// ─── Register ────────────────────────────────────────────────────────────────

serversRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON', code: 'INVALID_REQUEST' }, 400)

  const parsed = RegisterBody.safeParse(body)
  if (!parsed.success) {
    const e = parsed.error.issues[0]
    return c.json({ error: e.message, code: 'INVALID_REQUEST', field: e.path.join('.') }, 400)
  }

  const { signature, publicKey, ...input } = parsed.data

  try {
    const result = await registerServer(input, {
      redis: c.get('redis'),
      encryptionKey: c.get('encryptionKey'),
    })
    return c.json({ serverId: result.serverId, gatewayUrl: result.gatewayUrl, ownerAddress: input.ownerAddress, claimUrl: result.claimUrl ?? null }, 201)
  } catch (err) {
    console.error('Registration failed:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Registration failed', code: 'REGISTRATION_FAILED' }, 500)
  }
})

// ─── Get ─────────────────────────────────────────────────────────────────────

serversRouter.get('/:serverId', async (c) => {
  const serverId = c.req.param('serverId')
  if (!UUID_RE.test(serverId)) return c.json({ error: 'Invalid server ID', code: 'INVALID_REQUEST' }, 400)

  const redis = c.get('redis')
  const [cfgJson, toolsJson] = await Promise.all([redis.get(`server:${serverId}:config`), redis.get(`server:${serverId}:tools`)])
  if (!cfgJson) return c.json({ error: 'Server not found', code: 'NOT_FOUND' }, 404)

  try {
    const cfg = JSON.parse(cfgJson) as ServerConfig
    const tools = toolsJson ? JSON.parse(toolsJson) : []
    const { encryptedAuth: _, ...safe } = cfg
    return c.json({ ...safe, tools, acceptedTokens: safe.acceptedTokens ?? [] })
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500)
  }
})

// ─── Update ──────────────────────────────────────────────────────────────────

serversRouter.patch('/:serverId', async (c) => {
  const serverId = c.req.param('serverId')
  if (!UUID_RE.test(serverId)) return c.json({ error: 'Invalid server ID', code: 'INVALID_REQUEST' }, 400)

  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON', code: 'INVALID_REQUEST' }, 400)

  const parsed = PatchBody.safeParse(body)
  if (!parsed.success) {
    const e = parsed.error.issues[0]
    return c.json({ error: e.message, code: 'INVALID_REQUEST', field: e.path.join('.') }, 400)
  }

  const redis = c.get('redis')
  const ownerAddress = await redis.get(`server:${serverId}:ownerAddress`)
  if (!ownerAddress) return c.json({ error: 'Server not found', code: 'NOT_FOUND' }, 404)

  const { signature, publicKey, signedMessage, ...updates } = parsed.data
  const valid = verifyMessageSignature({ message: signedMessage, signature, publicKey }, ownerAddress)
  if (!valid) return c.json({ error: 'Invalid signature', code: 'UNAUTHORIZED' }, 403)

  const cfgJson = await redis.get(`server:${serverId}:config`)
  if (!cfgJson) return c.json({ error: 'Server not found', code: 'NOT_FOUND' }, 404)

  const cfg = JSON.parse(cfgJson) as ServerConfig
  const encKey = c.get('encryptionKey')
  const encAuth = updates.upstreamAuth ? encrypt(updates.upstreamAuth, encKey) : undefined

  const updated: ServerConfig = {
    ...cfg,
    ...(updates.toolPricing && { toolPricing: updates.toolPricing }),
    ...(updates.acceptedTokens && { acceptedTokens: updates.acceptedTokens }),
    ...(updates.recipientAddress && { recipientAddress: updates.recipientAddress }),
    ...(updates.telegramChatId !== undefined && { telegramChatId: updates.telegramChatId }),
    ...(updates.webhookUrl !== undefined && { webhookUrl: updates.webhookUrl }),
    ...(encAuth && { encryptedAuth: encAuth }),
  }

  await redis.set(`server:${serverId}:config`, JSON.stringify(updated), 'KEEPTTL')
  const { encryptedAuth: _, ...safe } = updated
  return c.json(safe)
})

// ─── Delete ──────────────────────────────────────────────────────────────────

serversRouter.delete('/:serverId', async (c) => {
  const serverId = c.req.param('serverId')
  if (!UUID_RE.test(serverId)) return c.json({ error: 'Invalid server ID', code: 'INVALID_REQUEST' }, 400)

  const redis = c.get('redis')
  const ownerAddress = await redis.get(`server:${serverId}:ownerAddress`)
  if (!ownerAddress) return c.json({ error: 'Server not found', code: 'NOT_FOUND' }, 404)

  const body = await c.req.json().catch(() => ({} as any))
  if (!body.signature || !body.publicKey || !body.signedMessage) {
    return c.json({ error: 'Signature required', code: 'UNAUTHORIZED' }, 403)
  }

  const valid = verifyMessageSignature(
    { message: body.signedMessage, signature: body.signature, publicKey: body.publicKey },
    ownerAddress,
  )
  if (!valid) return c.json({ error: 'Invalid signature', code: 'UNAUTHORIZED' }, 403)

  await Promise.all([
    redis.del(`server:${serverId}:config`),
    redis.del(`server:${serverId}:tools`),
    redis.del(`server:${serverId}:ownerAddress`),
    redis.del(`server:${serverId}:lastSeen`),
  ])

  return c.json({ message: 'Server deleted' })
})
