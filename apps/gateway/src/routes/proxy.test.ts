import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest'
import type { RequestContext } from 'stackai-x402/hooks'
import { createApp } from '../app.js'
import type { ServerConfig, IntrospectedTool } from '../services/registration.service.js'
import { buildPaymentTransaction, encrypt } from 'stackai-x402/internal'
import { randomPrivateKey } from '@stacks/transactions'

// ─── Constants ────────────────────────────────────────────────────────────────

const ENCRYPTION_KEY = 'a'.repeat(64)
const SERVER_ID = 'test-server-id'
const RECIPIENT = 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159'
const RELAY_URL = 'https://x402-relay.aibtc.com/broadcast'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRedis(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    // Implement NX semantics: if 'NX' option is present and key exists, return null (no-op)
    set: vi.fn(async (key: string, value: string, ...args: string[]) => {
      const isNX = args.includes('NX')
      if (isNX && store.has(key)) return null
      store.set(key, value)
      return 'OK' as string | null
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      store.delete(key)
      return 1
    }),
    scan: vi.fn(async () => ['0', []] as [string, string[]]),
    mget: vi.fn(async () => [] as (string | null)[]),
    incr: vi.fn(async () => 1),
    incrby: vi.fn(async () => 1),
    pfadd: vi.fn(async () => 1),
    pfcount: vi.fn(async () => 0),
    _store: store,
  }
}

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    serverId: SERVER_ID,
    name: 'Test Server',
    description: 'A test MCP server',
    url: 'https://mcp.example.com',
    recipientAddress: RECIPIENT,
    acceptedTokens: ['STX', 'sBTC', 'USDCx'],
    toolPricing: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeTools(
  tools: Array<{ name: string; price: number }>,
): IntrospectedTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: `Tool: ${t.name}`,
    price: t.price,
    acceptedTokens: ['STX', 'sBTC', 'USDCx'],
  }))
}

function mockUpstream(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/proxy/:serverId', () => {
  let redis: ReturnType<typeof makeRedis>
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    const config = makeConfig()
    const tools = makeTools([
      { name: 'priced-tool', price: 1.0 }, // $1.00 USD
      { name: 'free-tool', price: 0 },
    ])

    redis = makeRedis({
      [`server:${SERVER_ID}:config`]: JSON.stringify(config),
      [`server:${SERVER_ID}:tools`]: JSON.stringify(tools),
    })

    app = createApp({
      redis,
      encryptionKey: ENCRYPTION_KEY,
      network: 'mainnet',
      relayUrl: RELAY_URL,
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
    })

    vi.unstubAllGlobals()
  })

  // ── 404 for unknown server ────────────────────────────────────────────────

  it('returns 404 for unknown serverId', async () => {
    const res = await app.request('/api/v1/proxy/nonexistent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })
    expect(res.status).toBe(404)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('SERVER_NOT_FOUND')
  })

  it('returns 404 for unknown tool name', async () => {
    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'nonexistent-tool' }),
    })
    expect(res.status).toBe(404)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('TOOL_NOT_FOUND')
  })

  // ── 402 gate ──────────────────────────────────────────────────────────────

  it('returns 402 for priced tool without payment-signature', async () => {
    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })

    expect(res.status).toBe(402)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('PAYMENT_REQUIRED')
    expect(body.error).toBe('Payment required')

    // payment-required header must be present and valid base64-JSON
    const raw = res.headers.get('payment-required')
    expect(raw).not.toBeNull()
    const decoded = JSON.parse(Buffer.from(raw!, 'base64').toString('utf8'))

    expect(decoded.version).toBe(2)
    expect(decoded.network).toBe('stacks:1') // mainnet CAIP-2
    expect(decoded.payTo).toBe(RECIPIENT)
    expect(decoded.paymentIdentifier).toMatch(/^[0-9a-f-]{36}$/) // UUID v4

    // Price for $1 at $3/STX = (1/3)*1e6 ≈ 333333 microSTX
    expect(decoded.price).toHaveProperty('STX', '333333')
    expect(decoded.price).toHaveProperty('sBTC')
    expect(decoded.price).toHaveProperty('USDCx')
  })

  it('generates a unique paymentIdentifier per request', async () => {
    const makeRequest = () =>
      app.request(`/api/v1/proxy/${SERVER_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
      })

    const [r1, r2] = await Promise.all([makeRequest(), makeRequest()])

    const decode = (r: Response) => {
      const raw = r.headers.get('payment-required')!
      return JSON.parse(Buffer.from(raw, 'base64').toString()).paymentIdentifier as string
    }

    expect(decode(r1)).not.toBe(decode(r2))
  })

  it('uses testnet CAIP-2 when network is testnet', async () => {
    const testApp = createApp({
      redis,
      encryptionKey: ENCRYPTION_KEY,
      network: 'testnet',
      relayUrl: RELAY_URL,
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
    })

    const res = await testApp.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })

    expect(res.status).toBe(402)
    const raw = res.headers.get('payment-required')!
    const decoded = JSON.parse(Buffer.from(raw, 'base64').toString())
    expect(decoded.network).toBe('stacks:2147483648')
  })

  it('only includes accepted tokens in payment-required price', async () => {
    const stxConfig = makeConfig({ acceptedTokens: ['STX'], serverId: 'stx-only' })
    const tools = makeTools([{ name: 'priced-tool', price: 1.0 }])

    const stxRedis = makeRedis({
      'server:stx-only:config': JSON.stringify(stxConfig),
      'server:stx-only:tools': JSON.stringify(tools),
    })
    const stxApp = createApp({
      redis: stxRedis,
      encryptionKey: ENCRYPTION_KEY,
      network: 'mainnet',
      relayUrl: RELAY_URL,
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
    })

    const res = await stxApp.request('/api/v1/proxy/stx-only', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })

    expect(res.status).toBe(402)
    const decoded = JSON.parse(Buffer.from(res.headers.get('payment-required')!, 'base64').toString())
    expect(Object.keys(decoded.price)).toEqual(['STX'])
  })

  // ── Free tool passthrough ─────────────────────────────────────────────────

  it('forwards free tool to upstream without issuing 402', async () => {
    mockUpstream({ jsonrpc: '2.0', id: 1, result: { value: 42 } })

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'free-tool' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('payment-required')).toBeNull()
    const body = await res.json()
    expect(body).toMatchObject({ result: { value: 42 } })
  })

  // ── Upstream errors ───────────────────────────────────────────────────────

  it('returns 502 when upstream is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'free-tool' }),
    })

    expect(res.status).toBe(502)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('UPSTREAM_ERROR')
  })
})

// ─── Story 1-7: Payment verification integration tests ────────────────────────

describe('POST /api/v1/proxy/:serverId — payment verification (Story 1-7)', () => {
  const MOCK_TXID = 'aabbcc0011223344556677889900aabbcc0011223344556677889900aabbcc00'
  const PAYMENT_ID = 'test-payment-id-001'
  // STX price: $1 tool at $3/STX = 333333 microSTX
  const PAYMENT_AMOUNT = 333333n

  let redis: ReturnType<typeof makeRedis>
  let app: ReturnType<typeof createApp>
  let validPaymentSig: string

  beforeAll(async () => {
    // Clear any fetch stubs from prior describe blocks (e.g. the ECONNREFUSED stub in the
    // outer describe) so buildPaymentTransaction can reach the nonce endpoint.
    vi.unstubAllGlobals()
    const senderKey = randomPrivateKey()
    const txHex = await buildPaymentTransaction({
      senderKey,
      recipient: RECIPIENT,
      amount: PAYMENT_AMOUNT,
      tokenType: 'STX',
      network: 'mainnet',
    })
    validPaymentSig = Buffer.from(txHex, 'hex').toString('base64')
  })

  beforeEach(() => {
    const config = makeConfig()
    const tools = makeTools([
      { name: 'priced-tool', price: 1.0 }, // $1.00 USD
      { name: 'free-tool', price: 0 },
    ])

    redis = makeRedis({
      [`server:${SERVER_ID}:config`]: JSON.stringify(config),
      [`server:${SERVER_ID}:tools`]: JSON.stringify(tools),
    })

    app = createApp({
      redis,
      encryptionKey: ENCRYPTION_KEY,
      network: 'mainnet',
      relayUrl: RELAY_URL,
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
    })

    vi.unstubAllGlobals()
  })

  // Helper: mock both relay and upstream fetch calls by URL
  function mockFetchByUrl(relayBody: unknown, relayStatus: number, upstreamBody: unknown, upstreamStatus: number) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if ((url as string).includes('x402-relay')) {
          return new Response(JSON.stringify(relayBody), {
            status: relayStatus,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify(upstreamBody), {
          status: upstreamStatus,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
  }

  // ── Success flow (AC 9) ──────────────────────────────────────────────────

  it('success: verifies payment, forwards to upstream, returns tool result + payment-response header', async () => {
    const upstreamResult = { jsonrpc: '2.0', id: 1, result: { answer: 42 } }
    mockFetchByUrl({ txid: MOCK_TXID }, 200, upstreamResult, 200)

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': validPaymentSig,
        'payment-id': PAYMENT_ID,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })

    expect(res.status).toBe(200)

    // AC 8: payment-response header present and correctly encoded
    const paymentResponseHeader = res.headers.get('payment-response')
    expect(paymentResponseHeader).not.toBeNull()
    const decoded = JSON.parse(Buffer.from(paymentResponseHeader!, 'base64').toString('utf8'))
    expect(decoded.txid).toBe(MOCK_TXID)
    expect(decoded.explorerUrl).toContain(MOCK_TXID)
    expect(decoded.explorerUrl).toContain('explorer.hiro.so')

    // Tool result forwarded unchanged
    const body = await res.json()
    expect(body).toMatchObject({ result: { answer: 42 } })

    // No 402 / payment-required header
    expect(res.headers.get('payment-required')).toBeNull()
  })

  // ── Relay failure (AC 9) ─────────────────────────────────────────────────

  it('relay failure: returns 503 RELAY_UNAVAILABLE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if ((url as string).includes('x402-relay')) {
          return new Response('service unavailable', { status: 503 })
        }
        return new Response('{}', { status: 200 })
      }),
    )

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': validPaymentSig,
        'payment-id': PAYMENT_ID,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })

    expect(res.status).toBe(503)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('RELAY_UNAVAILABLE')
  })

  // ── Upstream failure after payment (AC 9) ────────────────────────────────

  it('upstream failure after payment: returns 502 with txid in body', async () => {
    mockFetchByUrl({ txid: MOCK_TXID }, 200, { error: 'tool crashed' }, 500)

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': validPaymentSig,
        'payment-id': PAYMENT_ID + '-upstream-fail',  // unique paymentId to avoid replay
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })

    expect(res.status).toBe(502)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('UPSTREAM_ERROR')
    expect(body.txid).toBe(MOCK_TXID)
    expect(typeof body.explorerUrl).toBe('string')
  })

  // ── Missing payment-id ───────────────────────────────────────────────────

  it('returns 400 when payment-signature is present but payment-id header is missing', async () => {
    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': validPaymentSig,
        // No payment-id
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('INVALID_REQUEST')
  })

  // ── explorerUrl reflects network ─────────────────────────────────────────

  it('explorerUrl contains correct chain for mainnet', async () => {
    mockFetchByUrl({ txid: MOCK_TXID }, 200, { jsonrpc: '2.0', id: 1, result: {} }, 200)

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': validPaymentSig,
        'payment-id': PAYMENT_ID + '-explorer-test',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })

    const paymentResponseHeader = res.headers.get('payment-response')!
    const decoded = JSON.parse(Buffer.from(paymentResponseHeader, 'base64').toString())
    expect(decoded.explorerUrl).toContain('chain=mainnet')
  })
})

// ─── AC4: upstream auth forwarding ───────────────────────────────────────────

describe('POST /api/v1/proxy/:serverId — upstream auth (AC4)', () => {
  const UPSTREAM_TOKEN = 'supersecret-upstream-api-key'

  it('forwards decrypted auth as Authorization Bearer header to upstream', async () => {
    const encryptedAuth = encrypt(UPSTREAM_TOKEN, ENCRYPTION_KEY)
    const config = makeConfig({ encryptedAuth })
    const tools = makeTools([{ name: 'free-tool', price: 0 }])

    const redis = makeRedis({
      [`server:${SERVER_ID}:config`]: JSON.stringify(config),
      [`server:${SERVER_ID}:tools`]: JSON.stringify(tools),
    })
    const app = createApp({
      redis,
      encryptionKey: ENCRYPTION_KEY,
      network: 'mainnet',
      relayUrl: RELAY_URL,
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
    })

    let capturedAuthHeader: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedAuthHeader = (init.headers as Record<string, string>)['Authorization']
        return new Response(JSON.stringify({ result: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'free-tool' }),
    })

    expect(res.status).toBe(200)
    expect(capturedAuthHeader).toBe(`Bearer ${UPSTREAM_TOKEN}`)
  })

  it('returns 500 when encryptedAuth cannot be decrypted (wrong key / tampered)', async () => {
    // Encrypt with a DIFFERENT key so decryption with ENCRYPTION_KEY fails
    const otherKey = 'b'.repeat(64)
    const encryptedAuth = encrypt(UPSTREAM_TOKEN, otherKey)
    const config = makeConfig({ encryptedAuth })
    const tools = makeTools([{ name: 'free-tool', price: 0 }])

    const redis = makeRedis({
      [`server:${SERVER_ID}:config`]: JSON.stringify(config),
      [`server:${SERVER_ID}:tools`]: JSON.stringify(tools),
    })
    const app = createApp({
      redis,
      encryptionKey: ENCRYPTION_KEY,
      network: 'mainnet',
      relayUrl: RELAY_URL,
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
    })

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'free-tool' }),
    })

    expect(res.status).toBe(500)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('INTERNAL_ERROR')
  })
})

// ─── Hook integration: fireHooks wiring ──────────────────────────────────────

/** Drain setImmediate callbacks and their promise chains. */
function flushImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(() => setTimeout(resolve, 10)))
}

describe('POST /api/v1/proxy/:serverId — hook integration (Story 3-1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fires hooks with success:true after a free tool call', async () => {
    const captured: RequestContext[] = []
    const hook = { onRequest: vi.fn(async (ctx: RequestContext) => { captured.push(ctx) }) }

    const config = makeConfig()
    const tools = makeTools([{ name: 'free-tool', price: 0 }])
    const redis = makeRedis({
      [`server:${SERVER_ID}:config`]: JSON.stringify(config),
      [`server:${SERVER_ID}:tools`]: JSON.stringify(tools),
    })

    const app = createApp({
      redis,
      encryptionKey: ENCRYPTION_KEY,
      network: 'mainnet',
      relayUrl: RELAY_URL,
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
      hooks: [hook],
    })

    mockUpstream({ jsonrpc: '2.0', id: 1, result: {} })

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'free-tool' }),
    })
    await flushImmediate()

    expect(res.status).toBe(200)
    expect(hook.onRequest).toHaveBeenCalledOnce()
    expect(captured[0]).toMatchObject({
      serverId: SERVER_ID,
      toolName: 'free-tool',
      success: true,
    })
    expect(captured[0].durationMs).toBeGreaterThanOrEqual(0)
  })

  it('fires hooks with success:false when free tool upstream fails', async () => {
    const captured: RequestContext[] = []
    const hook = { onRequest: vi.fn(async (ctx: RequestContext) => { captured.push(ctx) }) }

    const config = makeConfig()
    const tools = makeTools([{ name: 'free-tool', price: 0 }])
    const redis = makeRedis({
      [`server:${SERVER_ID}:config`]: JSON.stringify(config),
      [`server:${SERVER_ID}:tools`]: JSON.stringify(tools),
    })

    const app = createApp({
      redis,
      encryptionKey: ENCRYPTION_KEY,
      network: 'mainnet',
      relayUrl: RELAY_URL,
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
      hooks: [hook],
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'free-tool' }),
    })
    await flushImmediate()

    expect(res.status).toBe(502)
    expect(hook.onRequest).toHaveBeenCalledOnce()
    expect(captured[0]).toMatchObject({
      serverId: SERVER_ID,
      toolName: 'free-tool',
      success: false,
    })
  })

  it('hook errors do not affect the gateway response', async () => {
    const hook = {
      onRequest: vi.fn(async () => { throw new Error('hook exploded') }),
    }

    const config = makeConfig()
    const tools = makeTools([{ name: 'free-tool', price: 0 }])
    const redis = makeRedis({
      [`server:${SERVER_ID}:config`]: JSON.stringify(config),
      [`server:${SERVER_ID}:tools`]: JSON.stringify(tools),
    })

    const app = createApp({
      redis,
      encryptionKey: ENCRYPTION_KEY,
      network: 'mainnet',
      relayUrl: RELAY_URL,
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
      hooks: [hook],
    })

    mockUpstream({ jsonrpc: '2.0', id: 1, result: {} })

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'free-tool' }),
    })
    await flushImmediate()

    // Hook threw, but response must still be 200
    expect(res.status).toBe(200)
  })
})
