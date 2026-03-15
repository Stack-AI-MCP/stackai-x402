import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp } from '../app.js'

const ENCRYPTION_KEY = 'a'.repeat(64)

function makeRedis() {
  const store = new Map<string, string>()
  return {
    set: vi.fn(async (key: string, value: string) => { store.set(key, value); return 'OK' as string | null }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => { store.delete(key); return 1 }),
    scan: vi.fn(async (_c: string, _m: string, pattern: string) => {
      const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
      return ['0', Array.from(store.keys()).filter((k) => re.test(k))] as [string, string[]]
    }),
    mget: vi.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
    incr: vi.fn(async () => 1),
    incrby: vi.fn(async () => 1),
    pfadd: vi.fn(async () => 1),
    pfcount: vi.fn(async () => 0),
    zadd: vi.fn(async () => 1),
    zrevrange: vi.fn(async () => []),
    zcard: vi.fn(async () => 0),
    zrem: vi.fn(async () => 1),
    _store: store,
  }
}

const DEPS = { encryptionKey: ENCRYPTION_KEY, relayUrl: 'https://relay.example.com', testnetRelayUrl: 'https://x402-relay.aibtc.dev', tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 } as const }

const VALID_BODY = {
  url: 'https://mcp.example.com',
  name: 'Test MCP Server',
  description: 'A test server',
  recipientAddress: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
  ownerAddress: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
}

function mockMcpTools(tools: Array<{ name: string; description?: string }>) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ result: { tools } }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ))
}

// ─── Registration ─────────────────────────────────────────────────────────────

describe('POST /api/v1/servers', () => {
  let redis: ReturnType<typeof makeRedis>
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    redis = makeRedis()
    app = createApp({ redis, ...DEPS })
    vi.unstubAllGlobals()
  })

  it('returns 201 with serverId, gatewayUrl, ownerAddress', async () => {
    mockMcpTools([])
    const res = await app.request('/api/v1/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(VALID_BODY) })
    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, string>
    expect(body.serverId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.gatewayUrl).toBe(`/api/v1/proxy/${body.serverId}`)
    expect(body.ownerAddress).toBe(VALID_BODY.ownerAddress)
  })

  it('stores config, tools, and ownerAddress in Redis', async () => {
    mockMcpTools([{ name: 'get-price', description: 'Gets the price' }])
    const res = await app.request('/api/v1/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(VALID_BODY) })
    const { serverId } = await res.json() as Record<string, string>
    expect(redis._store.has(`server:${serverId}:config`)).toBe(true)
    expect(redis._store.has(`server:${serverId}:tools`)).toBe(true)
    expect(redis._store.has(`server:${serverId}:ownerAddress`)).toBe(true)
  })

  it('defaults acceptedTokens to all three', async () => {
    mockMcpTools([])
    await app.request('/api/v1/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(VALID_BODY) })
    const cfg = [...redis._store.values()].find((v) => { try { return JSON.parse(v).name === 'Test MCP Server' } catch { return false } })
    expect(JSON.parse(cfg!).acceptedTokens).toEqual(['STX', 'sBTC', 'USDCx'])
  })

  it('returns 400 when ownerAddress missing', async () => {
    const { ownerAddress: _, ...noOwner } = VALID_BODY
    const res = await app.request('/api/v1/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(noOwner) })
    expect(res.status).toBe(400)
  })

  it('encrypts upstreamAuth', async () => {
    mockMcpTools([])
    await app.request('/api/v1/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...VALID_BODY, upstreamAuth: 'secret' }) })
    const cfg = [...redis._store.values()].find((v) => { try { return JSON.parse(v).name === 'Test MCP Server' } catch { return false } })
    const parsed = JSON.parse(cfg!)
    expect(parsed.encryptedAuth).toBeDefined()
    expect(parsed.encryptedAuth).not.toBe('secret')
  })

  it('returns 400 for invalid recipientAddress', async () => {
    const res = await app.request('/api/v1/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...VALID_BODY, recipientAddress: '0x1234' }) })
    expect(res.status).toBe(400)
  })
})

// ─── List ─────────────────────────────────────────────────────────────────────

describe('GET /api/v1/servers', () => {
  let redis: ReturnType<typeof makeRedis>
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    redis = makeRedis()
    app = createApp({ redis, ...DEPS })
  })

  it('returns empty array when no servers registered', async () => {
    const res = await app.request('/api/v1/servers')
    expect(res.status).toBe(200)
    expect((await res.json() as any).servers).toEqual([])
  })

  it('returns servers with toolCount and priceRange', async () => {
    redis._store.set('server:test-id:config', JSON.stringify({ serverId: 'test-id', name: 'My Server', description: '', url: 'https://example.com', recipientAddress: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159', ownerAddress: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159', acceptedTokens: ['STX'], toolPricing: {}, createdAt: new Date().toISOString() }))
    redis._store.set('server:test-id:tools', JSON.stringify([{ name: 'a', price: 100 }, { name: 'b', price: 0 }]))
    const res = await app.request('/api/v1/servers')
    const body = await res.json() as any
    expect(body.servers).toHaveLength(1)
    expect(body.servers[0].toolCount).toBe(2)
    expect(body.servers[0].priceRange).toEqual({ min: 100, max: 100 })
  })

  it('does not expose encryptedAuth', async () => {
    redis._store.set('server:s1:config', JSON.stringify({ serverId: 's1', name: 'S', description: '', url: 'https://a.com', recipientAddress: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159', ownerAddress: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159', acceptedTokens: ['STX'], toolPricing: {}, encryptedAuth: 'secret', createdAt: new Date().toISOString() }))
    const res = await app.request('/api/v1/servers')
    const body = await res.json() as any
    expect(body.servers[0].encryptedAuth).toBeUndefined()
  })
})

// ─── Introspect ───────────────────────────────────────────────────────────────

describe('GET /api/v1/servers/introspect', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp({ redis: makeRedis(), ...DEPS })
    vi.unstubAllGlobals()
  })

  it('returns 400 when url missing', async () => {
    const res = await app.request('/api/v1/servers/introspect')
    expect(res.status).toBe(400)
  })

  it('returns 400 for HTTP url', async () => {
    const res = await app.request('/api/v1/servers/introspect?url=http://mcp.example.com')
    expect(res.status).toBe(400)
  })

  it('returns discovered tools', async () => {
    mockMcpTools([{ name: 'search', description: 'Search' }])
    const res = await app.request('/api/v1/servers/introspect?url=https://mcp.example.com')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.tools).toHaveLength(1)
    expect(body.tools[0].name).toBe('search')
  })
})
