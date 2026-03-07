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
    // SCAN: returns cursor '0' (complete) with all matching keys in one batch
    scan: vi.fn(async (_cursor: string, _matchArg: string, pattern: string) => {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
      const matching = Array.from(store.keys()).filter((k) => regex.test(k))
      return ['0', matching] as [string, string[]]
    }),
    // MGET: fetch multiple keys in one call
    mget: vi.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
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

// ─── Update: PATCH /api/v1/servers/:serverId ─────────────────────────────────

describe('PATCH /api/v1/servers/:serverId', () => {
  let redis: ReturnType<typeof makeRedis>
  let app: ReturnType<typeof createApp>
  let serverId: string
  let ownerKey: string

  beforeEach(async () => {
    redis = makeRedis()
    app = createApp({
      redis,
      encryptionKey: ENCRYPTION_KEY,
      network: 'mainnet',
      relayUrl: 'https://relay.example.com/broadcast',
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
    })
    vi.unstubAllGlobals()

    // Register a test server for each test to mutate
    mockMcpTools([])
    const regRes = await app.request('/api/v1/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    })
    const regBody = await regRes.json() as Record<string, string>
    serverId = regBody.serverId
    ownerKey = regBody.ownerKey
    vi.unstubAllGlobals()
  })

  it('partial update: changing toolPricing does not affect other fields', async () => {
    const newPricing = { 'my-tool': { price: 999 } }

    const patchRes = await app.request(`/api/v1/servers/${serverId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Key': ownerKey },
      body: JSON.stringify({ toolPricing: newPricing }),
    })

    expect(patchRes.status).toBe(200)
    const body = await patchRes.json() as Record<string, unknown>
    expect(body.toolPricing).toEqual(newPricing)
    expect(body.recipientAddress).toBe(VALID_BODY.recipientAddress)
    expect(body).not.toHaveProperty('encryptedAuth')
    expect(body).not.toHaveProperty('ownerKey')
  })

  it('returns 403 UNAUTHORIZED when X-Owner-Key does not match', async () => {
    const patchRes = await app.request(`/api/v1/servers/${serverId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Key': 'a'.repeat(64) },
      body: JSON.stringify({ toolPricing: {} }),
    })

    expect(patchRes.status).toBe(403)
    const body = await patchRes.json() as Record<string, string>
    expect(body.code).toBe('UNAUTHORIZED')
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 403 UNAUTHORIZED when X-Owner-Key header is missing', async () => {
    const patchRes = await app.request(`/api/v1/servers/${serverId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolPricing: {} }),
    })

    expect(patchRes.status).toBe(403)
    const body = await patchRes.json() as Record<string, string>
    expect(body.code).toBe('UNAUTHORIZED')
  })

  it('re-encrypts upstreamAuth when included in PATCH — plaintext never stored', async () => {
    const NEW_SECRET = 'new-bearer-token-xyz'

    await app.request(`/api/v1/servers/${serverId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Key': ownerKey },
      body: JSON.stringify({ upstreamAuth: NEW_SECRET }),
    })

    const configJson = redis._store.get(`server:${serverId}:config`)!
    const config = JSON.parse(configJson)
    expect(config.encryptedAuth).toBeDefined()
    expect(config.encryptedAuth).not.toBe(NEW_SECRET)
    expect(JSON.stringify(config)).not.toContain(NEW_SECRET)
  })

  it('saves updated config with KEEPTTL to preserve original TTL', async () => {
    const callsBefore = redis.set.mock.calls.length

    await app.request(`/api/v1/servers/${serverId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Key': ownerKey },
      body: JSON.stringify({ toolPricing: {} }),
    })

    const patchSetCall = redis.set.mock.calls
      .slice(callsBefore)
      .find((c) => c[0] === `server:${serverId}:config`)
    expect(patchSetCall).toBeDefined()
    expect(patchSetCall?.[2]).toBe('KEEPTTL')
  })

  it('returns 400 when serverId is not a valid UUID', async () => {
    const patchRes = await app.request('/api/v1/servers/not-a-uuid', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Key': ownerKey },
      body: JSON.stringify({ toolPricing: {} }),
    })

    expect(patchRes.status).toBe(400)
    const body = await patchRes.json() as Record<string, string>
    expect(body.code).toBe('INVALID_REQUEST')
  })

  it('returns 400 when body is not valid JSON', async () => {
    const patchRes = await app.request(`/api/v1/servers/${serverId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Key': ownerKey },
      body: 'not-json',
    })

    expect(patchRes.status).toBe(400)
    const body = await patchRes.json() as Record<string, string>
    expect(body.code).toBe('INVALID_REQUEST')
  })

  it('returns 400 when PATCH body contains unknown fields (.strict())', async () => {
    const patchRes = await app.request(`/api/v1/servers/${serverId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Key': ownerKey },
      body: JSON.stringify({ name: 'new name' }),
    })

    expect(patchRes.status).toBe(400)
    const body = await patchRes.json() as Record<string, string>
    expect(body.code).toBe('INVALID_REQUEST')
  })

  it('returns 400 when recipientAddress in PATCH has invalid format', async () => {
    const patchRes = await app.request(`/api/v1/servers/${serverId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Key': ownerKey },
      body: JSON.stringify({ recipientAddress: '0x1234' }),
    })

    expect(patchRes.status).toBe(400)
    const body = await patchRes.json() as Record<string, string>
    expect(body.code).toBe('INVALID_REQUEST')
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

// ─── List: GET /api/v1/servers ────────────────────────────────────────────────

describe('GET /api/v1/servers', () => {
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

  it('returns empty array when no servers are registered', async () => {
    const res = await app.request('/api/v1/servers')
    expect(res.status).toBe(200)
    const body = await res.json() as { servers: unknown[] }
    expect(body.servers).toEqual([])
  })

  it('returns servers with correct toolCount and priceRange', async () => {
    const config = {
      serverId: 'test-id-1',
      name: 'My Server',
      description: 'A test',
      url: 'https://example.com',
      recipientAddress: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
      acceptedTokens: ['STX', 'sBTC'],
      toolPricing: {},
      createdAt: new Date().toISOString(),
    }
    const tools = [
      { name: 'cheap-tool', price: 100, acceptedTokens: ['STX'] },
      { name: 'expensive-tool', price: 500, acceptedTokens: ['STX'] },
      { name: 'free-tool', price: 0, acceptedTokens: ['sBTC'] },
    ]

    redis._store.set('server:test-id-1:config', JSON.stringify(config))
    redis._store.set('server:test-id-1:tools', JSON.stringify(tools))

    const res = await app.request('/api/v1/servers')
    expect(res.status).toBe(200)
    const body = await res.json() as { servers: Record<string, unknown>[] }
    expect(body.servers).toHaveLength(1)

    const server = body.servers[0]
    expect(server.serverId).toBe('test-id-1')
    expect(server.name).toBe('My Server')
    expect(server.toolCount).toBe(3)
    expect(server.priceRange).toEqual({ min: 100, max: 500 })
    expect(server.acceptedTokens).toEqual(['STX', 'sBTC'])
  })

  it('does not expose encryptedAuth in response', async () => {
    const config = {
      serverId: 'secure-id',
      name: 'Secure Server',
      description: '',
      url: 'https://secure.example.com',
      recipientAddress: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
      acceptedTokens: ['STX'],
      toolPricing: {},
      encryptedAuth: 'super-secret-encrypted-value',
      createdAt: new Date().toISOString(),
    }

    redis._store.set('server:secure-id:config', JSON.stringify(config))

    const res = await app.request('/api/v1/servers')
    expect(res.status).toBe(200)
    const body = await res.json() as { servers: Record<string, unknown>[] }
    const server = body.servers[0]
    expect(server.encryptedAuth).toBeUndefined()
  })

  it('skips entries with null configJson (filter(Boolean) path)', async () => {
    // Put a tools key with no matching config — simulates orphaned key
    redis._store.set('server:orphan-id:tools', JSON.stringify([]))
    // Also add a valid server
    const config = {
      serverId: 'valid-id',
      name: 'Valid Server',
      description: '',
      url: 'https://valid.example.com',
      recipientAddress: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
      acceptedTokens: ['USDCx'],
      toolPricing: {},
      createdAt: new Date().toISOString(),
    }
    redis._store.set('server:valid-id:config', JSON.stringify(config))

    const res = await app.request('/api/v1/servers')
    expect(res.status).toBe(200)
    const body = await res.json() as { servers: Record<string, unknown>[] }
    // Only valid-id (which has a config) shows up
    expect(body.servers.every((s) => s.serverId !== 'orphan-id')).toBe(true)
  })

  it('returns priceRange {0,0} when all tools are free', async () => {
    const config = {
      serverId: 'free-id',
      name: 'Free Server',
      description: '',
      url: 'https://free.example.com',
      recipientAddress: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
      acceptedTokens: ['STX'],
      toolPricing: {},
      createdAt: new Date().toISOString(),
    }
    const tools = [{ name: 'free-tool', price: 0, acceptedTokens: ['STX'] }]

    redis._store.set('server:free-id:config', JSON.stringify(config))
    redis._store.set('server:free-id:tools', JSON.stringify(tools))

    const res = await app.request('/api/v1/servers')
    expect(res.status).toBe(200)
    const body = await res.json() as { servers: Record<string, unknown>[] }
    expect(body.servers[0].priceRange).toEqual({ min: 0, max: 0 })
  })

  it('skips corrupt config entry and returns remaining valid servers', async () => {
    // Corrupt config
    redis._store.set('server:corrupt-id:config', 'not-valid-json{{{')
    // Valid server
    const config = {
      serverId: 'ok-id',
      name: 'OK Server',
      description: '',
      url: 'https://ok.example.com',
      recipientAddress: 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159',
      acceptedTokens: ['STX'],
      toolPricing: {},
      createdAt: new Date().toISOString(),
    }
    redis._store.set('server:ok-id:config', JSON.stringify(config))

    const res = await app.request('/api/v1/servers')
    expect(res.status).toBe(200)
    const body = await res.json() as { servers: Record<string, unknown>[] }
    // Corrupt entry is skipped, valid one still returned
    expect(body.servers).toHaveLength(1)
    expect(body.servers[0].serverId).toBe('ok-id')
  })
})

// ─── Introspect: GET /api/v1/servers/introspect ──────────────────────────────

describe('GET /api/v1/servers/introspect', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    app = createApp({
      redis: makeRedis(),
      encryptionKey: ENCRYPTION_KEY,
      network: 'mainnet',
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
    })
    vi.unstubAllGlobals()
  })

  it('returns 400 when url query parameter is missing', async () => {
    const res = await app.request('/api/v1/servers/introspect')
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('INVALID_REQUEST')
  })

  it('returns 400 when url is not a valid URL', async () => {
    const res = await app.request('/api/v1/servers/introspect?url=not-a-url')
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('INVALID_REQUEST')
  })

  it('returns discovered tools from MCP server', async () => {
    mockMcpTools([
      { name: 'search', description: 'Search the web' },
      { name: 'summarize', description: 'Summarize text' },
    ])

    const res = await app.request(
      '/api/v1/servers/introspect?url=https://mcp.example.com',
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { tools: Array<{ name: string; description?: string }> }
    expect(body.tools).toHaveLength(2)
    expect(body.tools[0].name).toBe('search')
    expect(body.tools[1].name).toBe('summarize')
  })

  it('returns empty tools array when MCP server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const res = await app.request(
      '/api/v1/servers/introspect?url=https://unreachable.example.com',
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { tools: unknown[] }
    expect(body.tools).toEqual([])
  })
})
