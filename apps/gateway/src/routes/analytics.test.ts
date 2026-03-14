import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp } from '../app.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const ENCRYPTION_KEY = 'a'.repeat(64)
const SERVER_ID = '11111111-1111-1111-1111-111111111111'
const OWNER_KEY = 'test-owner-key-abc123'

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
    scan: vi.fn(async () => ['0', []] as [string, string[]]),
    mget: vi.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
    incr: vi.fn(async () => 1),
    incrby: vi.fn(async () => 1),
    pfadd: vi.fn(async () => 1),
    pfcount: vi.fn(async () => 42),
    _store: store,
  }
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/v1/servers/:serverId/analytics', () => {
  let redis: ReturnType<typeof makeRedis>
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    const today = todayStr()
    redis = makeRedis({
      [`server:${SERVER_ID}:ownerKey`]: OWNER_KEY,
      [`analytics:${SERVER_ID}:${today}:calls`]: '150',
      [`analytics:${SERVER_ID}:${today}:revenue:STX`]: '5000000',
      [`analytics:${SERVER_ID}:${today}:revenue:sBTC`]: '12345',
      [`analytics:${SERVER_ID}:${today}:revenue:USDCx`]: '1000000',
    })

    app = createApp({
      redis,
      encryptionKey: ENCRYPTION_KEY,
      relayUrl: 'https://relay.example.com',
      testnetRelayUrl: 'https://x402-relay.aibtc.dev',
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
    })
  })

  it('returns 403 without X-Owner-Key header', async () => {
    const res = await app.request(`/api/v1/servers/${SERVER_ID}/analytics`, {
      method: 'GET',
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as Record<string, string>
    expect(body.code).toBe('UNAUTHORIZED')
  })

  it('returns 403 with wrong owner key', async () => {
    const res = await app.request(`/api/v1/servers/${SERVER_ID}/analytics`, {
      method: 'GET',
      headers: { 'X-Owner-Key': 'test-owner-key-WRONG1' }, // same length as OWNER_KEY, different value
    })
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid server ID format', async () => {
    const res = await app.request('/api/v1/servers/not-a-uuid/analytics', {
      method: 'GET',
      headers: { 'X-Owner-Key': OWNER_KEY },
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, string>
    expect(body.code).toBe('INVALID_REQUEST')
  })

  it('returns analytics with totalCalls, uniqueCallers, revenue, and daily array', async () => {
    const res = await app.request(`/api/v1/servers/${SERVER_ID}/analytics`, {
      method: 'GET',
      headers: { 'X-Owner-Key': OWNER_KEY },
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      totalCalls: number
      uniqueCallers: number
      revenue: Record<string, string>
      daily: Array<{ date: string; calls: number; revenue: Record<string, string> }>
    }

    expect(body.totalCalls).toBe(150)
    expect(body.uniqueCallers).toBe(42) // from pfcount mock
    expect(body.revenue.STX).toBe('5000000')
    expect(body.revenue.sBTC).toBe('12345')
    expect(body.revenue.USDCx).toBe('1000000')

    // Daily array should have 30 entries
    expect(body.daily).toHaveLength(30)

    // Today's entry should have the data
    const todayEntry = body.daily.find((d) => d.date === todayStr())
    expect(todayEntry).toBeDefined()
    expect(todayEntry!.calls).toBe(150)
    expect(todayEntry!.revenue.STX).toBe('5000000')
  })

  it('uses mget to batch-read call counts', async () => {
    await app.request(`/api/v1/servers/${SERVER_ID}/analytics`, {
      method: 'GET',
      headers: { 'X-Owner-Key': OWNER_KEY },
    })

    // mget called at least twice: once for calls, once for revenue
    expect(redis.mget).toHaveBeenCalled()
  })

  it('calls pfcount for unique callers', async () => {
    await app.request(`/api/v1/servers/${SERVER_ID}/analytics`, {
      method: 'GET',
      headers: { 'X-Owner-Key': OWNER_KEY },
    })

    expect(redis.pfcount).toHaveBeenCalledWith(`analytics:${SERVER_ID}:callers`)
  })

  it('returns zeros when no analytics data exists', async () => {
    const emptyRedis = makeRedis({
      [`server:${SERVER_ID}:ownerKey`]: OWNER_KEY,
    })
    emptyRedis.pfcount.mockResolvedValue(0)

    const emptyApp = createApp({
      redis: emptyRedis,
      encryptionKey: ENCRYPTION_KEY,
      relayUrl: 'https://relay.example.com',
      testnetRelayUrl: 'https://x402-relay.aibtc.dev',
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
    })

    const res = await emptyApp.request(`/api/v1/servers/${SERVER_ID}/analytics`, {
      method: 'GET',
      headers: { 'X-Owner-Key': OWNER_KEY },
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      totalCalls: number
      uniqueCallers: number
      revenue: Record<string, string>
    }
    expect(body.totalCalls).toBe(0)
    expect(body.uniqueCallers).toBe(0)
    expect(body.revenue.STX).toBe('0')
  })
})
