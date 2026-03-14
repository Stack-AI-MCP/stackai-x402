import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp } from '../app.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const ENCRYPTION_KEY = 'a'.repeat(64)
const OPERATOR_KEY = 'test-operator-key-secure'
const SERVER_ID = '11111111-1111-1111-1111-111111111111'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRedis(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK' as string | null
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async () => 1),
    scan: vi.fn(async (_cursor: string, ..._args: string[]) => {
      // Return all server:*:config keys (ignores MATCH/COUNT args — in-memory store)
      const matching = Array.from(store.keys()).filter((k) => k.match(/^server:.*:config$/))
      return ['0', matching] as [string, string[]]
    }),
    mget: vi.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
    incr: vi.fn(async () => 1),
    incrby: vi.fn(async () => 1),
    pfadd: vi.fn(async () => 1),
    pfcount: vi.fn(async () => 0),
    _store: store,
  }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Admin Routes', () => {
  describe('Operator key auth', () => {
    let app: ReturnType<typeof createApp>

    beforeEach(() => {
      app = createApp({
        redis: makeRedis(),
        encryptionKey: ENCRYPTION_KEY,
        relayUrl: 'https://relay.example.com',
        testnetRelayUrl: 'https://x402-relay.aibtc.dev',
        tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
        operatorKey: OPERATOR_KEY,
      })
    })

    it('returns 403 without X-Operator-Key header', async () => {
      const res = await app.request('/api/v1/admin/servers', { method: 'GET' })
      expect(res.status).toBe(403)
      const body = (await res.json()) as Record<string, string>
      expect(body.code).toBe('UNAUTHORIZED')
    })

    it('returns 403 with wrong operator key', async () => {
      const res = await app.request('/api/v1/admin/servers', {
        method: 'GET',
        headers: { 'X-Operator-Key': 'wrong-operator-key-wrong' }, // same length as OPERATOR_KEY, different value
      })
      expect(res.status).toBe(403)
      const body = (await res.json()) as Record<string, string>
      expect(body.code).toBe('UNAUTHORIZED')
    })

    it('returns 503 when operator key not configured', async () => {
      const appNoKey = createApp({
        redis: makeRedis(),
        encryptionKey: ENCRYPTION_KEY,
        relayUrl: 'https://relay.example.com',
        testnetRelayUrl: 'https://x402-relay.aibtc.dev',
        tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
        // no operatorKey
      })
      const res = await appNoKey.request('/api/v1/admin/servers', {
        method: 'GET',
        headers: { 'X-Operator-Key': 'anything' },
      })
      expect(res.status).toBe(503)
      const body = (await res.json()) as Record<string, string>
      expect(body.code).toBe('NOT_CONFIGURED')
    })
  })

  describe('GET /api/v1/admin/servers', () => {
    it('returns server list with metrics', async () => {
      const today = todayStr()
      const redis = makeRedis({
        [`server:${SERVER_ID}:config`]: JSON.stringify({ name: 'Test Server', status: 'active' }),
        [`analytics:${SERVER_ID}:${today}:calls`]: '100',
        [`analytics:${SERVER_ID}:${today}:errors`]: '5',
        [`server:${SERVER_ID}:lastSeen`]: '2026-03-09T12:00:00.000Z',
      })

      const app = createApp({
        redis,
        encryptionKey: ENCRYPTION_KEY,
        relayUrl: 'https://relay.example.com',
        testnetRelayUrl: 'https://x402-relay.aibtc.dev',
        tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
        operatorKey: OPERATOR_KEY,
      })

      const res = await app.request('/api/v1/admin/servers', {
        method: 'GET',
        headers: { 'X-Operator-Key': OPERATOR_KEY },
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as { servers: Array<Record<string, unknown>> }
      expect(body.servers).toHaveLength(1)
      expect(body.servers[0].serverId).toBe(SERVER_ID)
      expect(body.servers[0].name).toBe('Test Server')
      expect(body.servers[0].callsToday).toBe(100)
      expect(body.servers[0].errorRatePercent).toBe(5)
      expect(body.servers[0].lastSeenAt).toBe('2026-03-09T12:00:00.000Z')
      expect(body.servers[0].status).toBe('active')
    })

    it('returns zeros when no analytics data exists', async () => {
      const redis = makeRedis({
        [`server:${SERVER_ID}:config`]: JSON.stringify({ name: 'Empty Server' }),
      })

      const app = createApp({
        redis,
        encryptionKey: ENCRYPTION_KEY,
        relayUrl: 'https://relay.example.com',
        testnetRelayUrl: 'https://x402-relay.aibtc.dev',
        tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
        operatorKey: OPERATOR_KEY,
      })

      const res = await app.request('/api/v1/admin/servers', {
        method: 'GET',
        headers: { 'X-Operator-Key': OPERATOR_KEY },
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as { servers: Array<Record<string, unknown>> }
      expect(body.servers[0].callsToday).toBe(0)
      expect(body.servers[0].errorRatePercent).toBe(0)
      expect(body.servers[0].lastSeenAt).toBeNull()
      expect(body.servers[0].status).toBe('active') // default when not set
    })

    it('returns empty list when no servers registered', async () => {
      const app = createApp({
        redis: makeRedis(),
        encryptionKey: ENCRYPTION_KEY,
        relayUrl: 'https://relay.example.com',
        testnetRelayUrl: 'https://x402-relay.aibtc.dev',
        tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
        operatorKey: OPERATOR_KEY,
      })

      const res = await app.request('/api/v1/admin/servers', {
        method: 'GET',
        headers: { 'X-Operator-Key': OPERATOR_KEY },
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { servers: unknown[] }
      expect(body.servers).toHaveLength(0)
    })
  })

  describe('PATCH /api/v1/admin/servers/:serverId', () => {
    it('disables a server', async () => {
      const redis = makeRedis({
        [`server:${SERVER_ID}:config`]: JSON.stringify({ name: 'Test', status: 'active' }),
      })

      const app = createApp({
        redis,
        encryptionKey: ENCRYPTION_KEY,
        relayUrl: 'https://relay.example.com',
        testnetRelayUrl: 'https://x402-relay.aibtc.dev',
        tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
        operatorKey: OPERATOR_KEY,
      })

      const res = await app.request(`/api/v1/admin/servers/${SERVER_ID}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Operator-Key': OPERATOR_KEY,
        },
        body: JSON.stringify({ status: 'disabled' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, string>
      expect(body.status).toBe('disabled')

      // Verify config was updated in Redis
      const updated = JSON.parse(redis._store.get(`server:${SERVER_ID}:config`)!)
      expect(updated.status).toBe('disabled')
    })

    it('re-enables a server', async () => {
      const redis = makeRedis({
        [`server:${SERVER_ID}:config`]: JSON.stringify({ name: 'Test', status: 'disabled' }),
      })

      const app = createApp({
        redis,
        encryptionKey: ENCRYPTION_KEY,
        relayUrl: 'https://relay.example.com',
        testnetRelayUrl: 'https://x402-relay.aibtc.dev',
        tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
        operatorKey: OPERATOR_KEY,
      })

      const res = await app.request(`/api/v1/admin/servers/${SERVER_ID}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Operator-Key': OPERATOR_KEY,
        },
        body: JSON.stringify({ status: 'active' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, string>
      expect(body.status).toBe('active')
    })

    it('returns 400 for invalid status value', async () => {
      const app = createApp({
        redis: makeRedis({
          [`server:${SERVER_ID}:config`]: JSON.stringify({ name: 'Test' }),
        }),
        encryptionKey: ENCRYPTION_KEY,
        relayUrl: 'https://relay.example.com',
        testnetRelayUrl: 'https://x402-relay.aibtc.dev',
        tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
        operatorKey: OPERATOR_KEY,
      })

      const res = await app.request(`/api/v1/admin/servers/${SERVER_ID}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Operator-Key': OPERATOR_KEY,
        },
        body: JSON.stringify({ status: 'invalid' }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 404 for nonexistent server', async () => {
      const app = createApp({
        redis: makeRedis(),
        encryptionKey: ENCRYPTION_KEY,
        relayUrl: 'https://relay.example.com',
        testnetRelayUrl: 'https://x402-relay.aibtc.dev',
        tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
        operatorKey: OPERATOR_KEY,
      })

      const res = await app.request(`/api/v1/admin/servers/${SERVER_ID}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Operator-Key': OPERATOR_KEY,
        },
        body: JSON.stringify({ status: 'disabled' }),
      })
      expect(res.status).toBe(404)
    })

    it('returns 400 for invalid UUID', async () => {
      const app = createApp({
        redis: makeRedis(),
        encryptionKey: ENCRYPTION_KEY,
        relayUrl: 'https://relay.example.com',
        testnetRelayUrl: 'https://x402-relay.aibtc.dev',
        tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
        operatorKey: OPERATOR_KEY,
      })

      const res = await app.request('/api/v1/admin/servers/not-a-uuid', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Operator-Key': OPERATOR_KEY,
        },
        body: JSON.stringify({ status: 'disabled' }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('Proxy disabled endpoint (integration)', () => {
    it('returns 503 when endpoint is disabled', async () => {
      const redis = makeRedis({
        [`server:${SERVER_ID}:config`]: JSON.stringify({
          name: 'Disabled Server',
          url: 'https://mcp.example.com',
          recipientAddress: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
          acceptedTokens: ['STX'],
          status: 'disabled',
        }),
        [`server:${SERVER_ID}:tools`]: JSON.stringify([
          { name: 'test_tool', description: 'A test tool', price: 0 },
        ]),
      })

      const app = createApp({
        redis,
        encryptionKey: ENCRYPTION_KEY,
        relayUrl: 'https://relay.example.com',
        testnetRelayUrl: 'https://x402-relay.aibtc.dev',
        tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
        operatorKey: OPERATOR_KEY,
      })

      const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'test_tool', id: 1 }),
      })
      expect(res.status).toBe(503)
      const body = (await res.json()) as Record<string, string>
      expect(body.code).toBe('ENDPOINT_DISABLED')
    })

    it('does NOT update lastSeen for disabled endpoints', async () => {
      const redis = makeRedis({
        [`server:${SERVER_ID}:config`]: JSON.stringify({
          name: 'Disabled Server',
          url: 'https://mcp.example.com',
          recipientAddress: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
          acceptedTokens: ['STX'],
          status: 'disabled',
        }),
        [`server:${SERVER_ID}:tools`]: JSON.stringify([]),
      })

      const app = createApp({
        redis,
        encryptionKey: ENCRYPTION_KEY,
        relayUrl: 'https://relay.example.com',
        testnetRelayUrl: 'https://x402-relay.aibtc.dev',
        tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
        operatorKey: OPERATOR_KEY,
      })

      await app.request(`/api/v1/proxy/${SERVER_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'any_tool', id: 1 }),
      })

      // lastSeen must NOT be written when endpoint is disabled
      const lastSeenSetCall = redis.set.mock.calls.find(
        (args: unknown[]) => typeof args[0] === 'string' && args[0].includes(':lastSeen'),
      )
      expect(lastSeenSetCall).toBeUndefined()
    })
  })
})
