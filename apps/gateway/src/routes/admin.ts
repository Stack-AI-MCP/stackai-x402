import { Hono } from 'hono'
import { timingSafeEqual } from 'node:crypto'
import type { AppEnv } from '../app.js'
import type { ServerConfig } from '../services/registration.service.js'
import { scanAllKeys } from '../services/registration.service.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// ─── Router ───────────────────────────────────────────────────────────────────

export const adminRouter = new Hono<AppEnv>()

// ── Operator auth middleware ──────────────────────────────────────────────────

adminRouter.use('*', async (c, next) => {
  const operatorKey = c.get('operatorKey')
  if (!operatorKey) {
    return c.json({ error: 'Admin endpoint not configured', code: 'NOT_CONFIGURED' }, 503)
  }

  const provided = c.req.header('X-Operator-Key')
  if (!provided) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 403)
  }

  // Constant-time comparison to prevent key-length oracle
  const maxLen = Math.max(operatorKey.length, provided.length)
  const bufA = Buffer.alloc(maxLen)
  const bufB = Buffer.alloc(maxLen)
  Buffer.from(operatorKey).copy(bufA)
  Buffer.from(provided).copy(bufB)
  if (!timingSafeEqual(bufA, bufB) || operatorKey.length !== provided.length) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 403)
  }

  await next()
})

// ── GET /api/v1/admin/servers ─────────────────────────────────────────────────

adminRouter.get('/servers', async (c) => {
  const redis = c.get('redis')
  const today = new Date().toISOString().slice(0, 10)

  // Scan for all registered server configs
  const configKeys = await scanAllKeys(redis, 'server:*:config')

  const servers = []
  for (const key of configKeys) {
    // Extract serverId from key: server:{id}:config
    const serverId = key.slice('server:'.length, key.length - ':config'.length)

    const [configJson, callsStr, errorsStr, lastSeenStr] = await Promise.all([
      redis.get(key),
      redis.get(`analytics:${serverId}:${today}:calls`),
      redis.get(`analytics:${serverId}:${today}:errors`),
      redis.get(`server:${serverId}:lastSeen`),
    ])

    if (!configJson) continue

    const config = JSON.parse(configJson) as ServerConfig
    const totalCalls = callsStr ? parseInt(callsStr, 10) : 0
    const errors = errorsStr ? parseInt(errorsStr, 10) : 0
    const errorRatePercent = totalCalls > 0 ? Math.round((errors / totalCalls) * 10000) / 100 : 0

    servers.push({
      serverId,
      name: config.name,
      callsToday: totalCalls,   // today's UTC day — use `lastSeenAt` for recency context
      errorRatePercent,
      lastSeenAt: lastSeenStr ?? null,
      status: config.status ?? 'active',
    })
  }

  return c.json({ servers, window: 'today' })
})

// ── PATCH /api/v1/admin/servers/:serverId ─────────────────────────────────────

adminRouter.patch('/servers/:serverId', async (c) => {
  const serverId = c.req.param('serverId')

  if (!UUID_RE.test(serverId)) {
    return c.json({ error: 'Invalid server ID format', code: 'INVALID_REQUEST' }, 400)
  }

  let body: { status?: string }
  try {
    body = (await c.req.json()) as { status?: string }
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_REQUEST' }, 400)
  }

  if (body.status !== 'active' && body.status !== 'disabled') {
    return c.json({ error: 'status must be "active" or "disabled"', code: 'INVALID_REQUEST' }, 400)
  }

  const redis = c.get('redis')
  const configJson = await redis.get(`server:${serverId}:config`)
  if (!configJson) {
    return c.json({ error: 'Server not found', code: 'SERVER_NOT_FOUND' }, 404)
  }

  const config = JSON.parse(configJson) as Record<string, unknown>
  config.status = body.status
  // KEEPTTL preserves the original 30-day expiry — without it, Redis resets the TTL to infinite
  await redis.set(`server:${serverId}:config`, JSON.stringify(config), 'KEEPTTL')

  return c.json({ serverId, status: body.status })
})
