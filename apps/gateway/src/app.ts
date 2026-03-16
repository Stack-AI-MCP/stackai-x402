import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serversRouter } from './routes/servers.js'
import { agentCardRouter } from './routes/agent-card.js'
import { proxyRouter, handleProxy } from './routes/proxy.js'
import { analyticsRouter } from './routes/analytics.js'
import { adminRouter } from './routes/admin.js'
import { agentsRouter } from './routes/agents.js'
import { agentProxyRouter } from './routes/agent-proxy.js'
import type { RedisLike } from './services/registration.service.js'
import type { TokenType } from 'stackai-x402/internal'
import type { Hook } from 'stackai-x402/hooks'
import type { SettleFunction } from './routes/proxy.js'

// ─── Hono typed context variables ────────────────────────────────────────────

export type AppEnv = {
  Variables: {
    redis: RedisLike
    encryptionKey: string
    tokenPrices: Record<TokenType, number>
    relayUrl: string
    testnetRelayUrl: string
    hooks: Hook[]
    operatorKey: string | undefined
    settlePayment: SettleFunction | undefined
  }
}

export interface AppDeps {
  redis: RedisLike
  encryptionKey: string
  tokenPrices: Record<TokenType, number>
  relayUrl: string
  testnetRelayUrl: string
  hooks?: Hook[]
  operatorKey?: string
  settlePayment?: SettleFunction
}

// ─── App factory ──────────────────────────────────────────────────────────────

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.use('*', cors({
    origin: (origin) => origin ?? '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-wallet-address', 'x-api-key', 'payment-signature', 'payment-id', 'x-cronos402-target-url', 'target-url'],
    exposeHeaders: ['x-request-id', 'payment-required', 'payment-response'],
    maxAge: 86400,
  }))

  app.use('*', async (c, next) => {
    c.set('redis', deps.redis)
    c.set('encryptionKey', deps.encryptionKey)
    c.set('tokenPrices', deps.tokenPrices)
    c.set('relayUrl', deps.relayUrl)
    c.set('testnetRelayUrl', deps.testnetRelayUrl)
    c.set('hooks', deps.hooks ?? [])
    c.set('operatorKey', deps.operatorKey)
    c.set('settlePayment', deps.settlePayment)
    await next()
  })

  // ─── Routes ────────────────────────────────────────────────────────────────
  app.get('/health', (c) => c.json({ status: 'ok' }))

  // Unified MCP proxy
  app.all('/mcp', (c) => {
    const serverId = c.req.query('id')
    if (serverId) return handleProxy(c, serverId)
    const targetUrl = c.req.query('target-url') || c.req.header('x-cronos402-target-url')
    if (targetUrl) return c.json({ error: 'Ad-hoc target-url not implemented. Use ?id=serverId', code: 'NOT_IMPLEMENTED' }, 501)
    return c.json({ error: 'id query parameter is required', code: 'INVALID_REQUEST' }, 400)
  })

  app.route('/api/v1/servers', analyticsRouter)
  app.route('/api/v1/servers', serversRouter)
  app.route('/api/v1/admin', adminRouter)
  app.route('/api/v1/proxy', proxyRouter)
  app.route('/api/v1/agents', agentsRouter)
  app.route('/api/v1/agent', agentProxyRouter)
  app.route('/.well-known/agent.json', agentCardRouter)

  app.onError((err, c) => {
    console.error('Unhandled gateway error:', err.message)
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  })

  app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404))

  return app
}
