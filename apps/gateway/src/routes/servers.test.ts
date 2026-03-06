import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp } from '../app.js'

const ENCRYPTION_KEY = 'a'.repeat(64)

// ─── In-memory Redis mock ─────────────────────────────────────────────────────

function makeRedis() {
  const store = new Map<string, string>()
  return {
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK' as string | null
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      store.delete(key)
      return 1
    }),
    _store: store,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_BODY = {
  url: 'https://mcp.example.com',
  name: 'Test MCP Server',
  description: 'A test server',
  recipientAddress: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
}

function mockMcpTools(tools: Array<{ name: string; description?: string }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: { tools } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

// ─── Registration: POST /api/v1/servers ──────────────────────────────────────

describe('POST /api/v1/servers', () => {
  let redis: ReturnType<typeof makeRedis>
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    redis = makeRedis()
    app = createApp({
      redis,
      encryptionKey: ENCRYPTION_KEY,
      network: 'mainnet',
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
    })
    vi.unstubAllGlobals()
  })

  it('returns 201 with serverId, gatewayUrl, ownerKey', async () => {
    mockMcpTools([])

    const res = await app.request('/api/v1/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, string>
    expect(body.serverId).toMatch(/^[0-9a-f-]{36}$/) // UUID
    expect(body.gatewayUrl).toBe(`/api/v1/proxy/${body.serverId}`)
    expect(body.ownerKey).toMatch(/^[0-9a-f]{64}$/) // 32-byte hex
  })

  it('stores server:config and server:tools in Redis with EX 2592000', async () => {
    mockMcpTools([{ name: 'get-price', description: 'Gets the price' }])

    const res = await app.request('/api/v1/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    })

    const { serverId } = await res.json() as Record<string, string>

    // Config stored
    const configCall = redis.set.mock.calls.find((c) => c[0] === `server:${serverId}:config`)
    expect(configCall).toBeDefined()
    expect(configCall?.[2]).toBe('EX')
    expect(configCall?.[3]).toBe(2_592_000)

    // Tools stored
    const toolsCall = redis.set.mock.calls.find((c) => c[0] === `server:${serverId}:tools`)
    expect(toolsCall).toBeDefined()
    expect(toolsCall?.[2]).toBe('EX')
    expect(toolsCall?.[3]).toBe(2_592_000)

    // ownerKey stored separately (not inside the config blob)
    const ownerKeyCall = redis.set.mock.calls.find((c) => c[0] === `server:${serverId}:ownerKey`)
    expect(ownerKeyCall).toBeDefined()
    expect(ownerKeyCall?.[2]).toBe('EX')
    expect(ownerKeyCall?.[3]).toBe(2_592_000)
  })

  it('defaults acceptedTokens to all three tokens when omitted', async () => {
    mockMcpTools([])

    await app.request('/api/v1/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    })

    const configJson = [...redis._store.values()].find((v) => {
      try { return JSON.parse(v).name === 'Test MCP Server' } catch { return false }
    })
    const config = JSON.parse(configJson!)
    expect(config.acceptedTokens).toEqual(['STX', 'sBTC', 'USDCx'])
  })

  it('applies toolPricing with default price 0 for unlisted tools', async () => {
    mockMcpTools([
      { name: 'priced-tool', description: 'has a price' },
      { name: 'free-tool', description: 'free' },
    ])

    const res = await app.request('/api/v1/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...VALID_BODY,
        toolPricing: { 'priced-tool': { price: 500 } },
      }),
    })

    const { serverId } = await res.json() as Record<string, string>
    const toolsJson = redis._store.get(`server:${serverId}:tools`)!
    const tools = JSON.parse(toolsJson) as Array<{ name: string; price: number }>

    expect(tools.find((t) => t.name === 'priced-tool')?.price).toBe(500)
    expect(tools.find((t) => t.name === 'free-tool')?.price).toBe(0)
  })

  it('encrypts upstreamAuth and does NOT store plaintext', async () => {
    mockMcpTools([])

    const SECRET = 'super-secret-token'
    await app.request('/api/v1/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, upstreamAuth: SECRET }),
    })

    const configJson = [...redis._store.values()].find((v) => {
      try { return JSON.parse(v).name === 'Test MCP Server' } catch { return false }
    })
    const config = JSON.parse(configJson!)
    expect(config.encryptedAuth).toBeDefined()
    expect(config.encryptedAuth).not.toBe(SECRET)
    expect(JSON.stringify(config)).not.toContain(SECRET)
  })

  it('returns 400 when url is missing', async () => {
    const res = await app.request('/api/v1/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', recipientAddress: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('INVALID_REQUEST')
  })

  it('returns 400 when recipientAddress has invalid prefix', async () => {
    const res = await app.request('/api/v1/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, recipientAddress: '0x1234' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('INVALID_REQUEST')
  })

  it('returns 400 when recipientAddress is valid-prefixed but too short', async () => {
    const res = await app.request('/api/v1/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, recipientAddress: 'SP123' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('INVALID_REQUEST')
  })

  it('returns 500 with REGISTRATION_FAILED when Redis is unavailable', async () => {
    const brokenRedis = {
      set: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379')),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(1),
    }
    const failApp = createApp({
      redis: brokenRedis,
      encryptionKey: ENCRYPTION_KEY,
      network: 'mainnet',
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
    })
    mockMcpTools([])

    const res = await failApp.request('/api/v1/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    })

    expect(res.status).toBe(500)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('REGISTRATION_FAILED')
    // Internal error details must NOT be surfaced to the client
    expect(body.error).not.toContain('ECONNREFUSED')
    expect(body.error).not.toContain('127.0.0.1')
  })
})

// ─── Agent Card: GET /.well-known/agent.json ──────────────────────────────────

describe('GET /.well-known/agent.json', () => {
  let redis: ReturnType<typeof makeRedis>
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    redis = makeRedis()
    app = createApp({
      redis,
      encryptionKey: ENCRYPTION_KEY,
      network: 'mainnet',
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
    })
    vi.unstubAllGlobals()
  })

  it('returns agent card after registration', async () => {
    mockMcpTools([{ name: 'search', description: 'Search the web' }])

    // Register first
    const regRes = await app.request('/api/v1/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...VALID_BODY,
        name: 'Search Server',
        toolPricing: { search: { price: 100 } },
      }),
    })
    const { serverId } = await regRes.json() as Record<string, string>

    // Fetch agent card
    const cardRes = await app.request(`/.well-known/agent.json?server=${serverId}`)
    expect(cardRes.status).toBe(200)

    const card = await cardRes.json() as Record<string, unknown>
    expect(card.name).toBe('Search Server')
    expect(card.version).toBe('1.0')
    expect(card.gatewayUrl).toBe(`/api/v1/proxy/${serverId}`)

    const tools = card.tools as Array<{ name: string; price: number }>
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('search')
    expect(tools[0].price).toBe(100)
  })

  it('does NOT expose ownerKey or encryptedAuth in agent card', async () => {
    mockMcpTools([])

    const regRes = await app.request('/api/v1/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, upstreamAuth: 'secret' }),
    })
    const { serverId, ownerKey } = await regRes.json() as Record<string, string>

    const cardRes = await app.request(`/.well-known/agent.json?server=${serverId}`)
    const card = JSON.stringify(await cardRes.json())
    expect(card).not.toContain(ownerKey)
    expect(card).not.toContain('encryptedAuth')
    expect(card).not.toContain('secret')
  })

  it('returns 500 with INTERNAL_ERROR when stored config is corrupted', async () => {
    // Plant corrupt JSON directly into the store before the request
    redis._store.set('server:bad-id:config', 'not-valid-json')

    const res = await app.request('/.well-known/agent.json?server=bad-id')
    expect(res.status).toBe(500)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('INTERNAL_ERROR')
  })

  it('returns 404 for unknown serverId', async () => {
    const res = await app.request('/.well-known/agent.json?server=nonexistent')
    expect(res.status).toBe(404)
  })

  it('returns 400 when server param is missing', async () => {
    const res = await app.request('/.well-known/agent.json')
    expect(res.status).toBe(400)
  })
})
