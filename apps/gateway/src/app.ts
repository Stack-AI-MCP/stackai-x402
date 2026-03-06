import { Hono } from 'hono'
import { serversRouter } from './routes/servers.js'
import { agentCardRouter } from './routes/agent-card.js'
import { proxyRouter } from './routes/proxy.js'
import type { RedisLike } from './services/registration.service.js'
import type { TokenType } from 'stackai-x402/internal'

// ─── Hono typed context variables ────────────────────────────────────────────

export type AppEnv = {
  Variables: {
    redis: RedisLike
    encryptionKey: string
    network: 'mainnet' | 'testnet'
    tokenPrices: Record<TokenType, number>
    relayUrl: string
  }
}

export interface AppDeps {
  redis: RedisLike
  encryptionKey: string
  network: 'mainnet' | 'testnet'
  tokenPrices: Record<TokenType, number>
  relayUrl: string
}

// ─── App factory ──────────────────────────────────────────────────────────────

/**
 * Creates the Hono app with all routes wired.
 * Accepts explicit deps for testability — production code passes real singletons,
 * tests pass mocks.
 */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  // Inject deps into every request context
  app.use('*', async (c, next) => {
    c.set('redis', deps.redis)
    c.set('encryptionKey', deps.encryptionKey)
    c.set('network', deps.network)
    c.set('tokenPrices', deps.tokenPrices)
    c.set('relayUrl', deps.relayUrl)
    await next()
  })

  // ─── Routes ────────────────────────────────────────────────────────────────
  app.get('/health', (c) => c.json({ status: 'ok' }))
  app.route('/api/v1/servers', serversRouter)
  app.route('/api/v1/proxy', proxyRouter)
  app.route('/.well-known/agent.json', agentCardRouter)

  // ─── Global error handler ──────────────────────────────────────────────────
  app.onError((err, c) => {
    console.error('Unhandled gateway error:', err.message)
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500)
  })

  app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404))

  return app
}
