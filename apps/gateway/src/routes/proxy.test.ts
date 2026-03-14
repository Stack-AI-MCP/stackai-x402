import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { RequestContext } from 'stackai-x402/hooks'
import { createApp } from '../app.js'
import type { ServerConfig, IntrospectedTool } from '../services/registration.service.js'
import { encrypt } from 'stackai-x402/internal'
import type { SettleFunction } from './proxy.js'
import type { SettlementResponseV2 } from 'x402-stacks'

// ─── Constants ────────────────────────────────────────────────────────────────

const ENCRYPTION_KEY = 'a'.repeat(64)
const SERVER_ID = 'test-server-id'
const RECIPIENT = 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159'
const RELAY_URL = 'https://x402-relay.aibtc.com'
const MOCK_TXID = 'aabbcc0011223344556677889900aabbcc0011223344556677889900aabbcc00'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRedis(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  return {
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
    network: 'mainnet',
    acceptedTokens: ['STX', 'sBTC', 'USDCx'],
    toolPricing: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeTools(tools: Array<{ name: string; price: number }>): IntrospectedTool[] {
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

/** Builds a valid PaymentPayloadV2 base64 header (no real signing needed — settle is mocked). */
function makePaymentSig(overrides: Record<string, unknown> = {}): string {
  const payload = {
    x402Version: 2,
    accepted: {
      scheme: 'exact',
      network: 'stacks:1',
      amount: '333333',
      asset: 'STX',
      payTo: RECIPIENT,
      maxTimeoutSeconds: 300,
    },
    payload: { transaction: 'deadbeef' }, // real tx not needed — settle is mocked
    ...overrides,
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64')
}

/** Default successful settle mock */
function makeSettle(overrides: Partial<SettlementResponseV2> = {}): SettleFunction {
  return vi.fn().mockResolvedValue({
    success: true,
    transaction: MOCK_TXID,
    network: 'stacks:1' as const,
    payer: 'SP1SENDER',
    ...overrides,
  } satisfies SettlementResponseV2)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/proxy/:serverId', () => {
  let redis: ReturnType<typeof makeRedis>
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    const config = makeConfig()
    const tools = makeTools([
      { name: 'priced-tool', price: 1.0 },
      { name: 'free-tool', price: 0 },
    ])

    redis = makeRedis({
      [`server:${SERVER_ID}:config`]: JSON.stringify(config),
      [`server:${SERVER_ID}:tools`]: JSON.stringify(tools),
    })

    app = createApp({
      redis,
      encryptionKey: ENCRYPTION_KEY,
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev',
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

  // ── 402 gate — V2 Coinbase-compatible format ──────────────────────────────

  it('returns 402 for priced tool without payment-signature', async () => {
    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })

    expect(res.status).toBe(402)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('PAYMENT_REQUIRED')

    // payment-required header must be present and valid base64-JSON (V2 format)
    const raw = res.headers.get('payment-required')
    expect(raw).not.toBeNull()
    const decoded = JSON.parse(Buffer.from(raw!, 'base64').toString('utf8'))

    expect(decoded.x402Version).toBe(2)
    expect(decoded.resource).toBeDefined()
    expect(Array.isArray(decoded.accepts)).toBe(true)
    expect(decoded.accepts.length).toBe(3) // STX + sBTC + USDCx

    // Find STX entry: $1 at $3/STX = 333333 microSTX
    const stxEntry = decoded.accepts.find((a: any) => a.asset === 'STX')
    expect(stxEntry).toBeDefined()
    expect(stxEntry.amount).toBe('333333')
    expect(stxEntry.payTo).toBe(RECIPIENT)
    expect(stxEntry.scheme).toBe('exact')
    expect(stxEntry.network).toBe('stacks:1')
    expect(stxEntry.maxTimeoutSeconds).toBe(300)
  })

  it('uses testnet CAIP-2 when server config network is testnet', async () => {
    const testnetConfig = makeConfig({ network: 'testnet' })
    const testnetTools = makeTools([{ name: 'priced-tool', price: 1.0 }])
    const testnetRedis = makeRedis({
      [`server:${SERVER_ID}:config`]: JSON.stringify(testnetConfig),
      [`server:${SERVER_ID}:tools`]: JSON.stringify(testnetTools),
    })
    const testApp = createApp({
      redis: testnetRedis,
      encryptionKey: ENCRYPTION_KEY,
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev',
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
    expect(decoded.accepts[0].network).toBe('stacks:2147483648')
  })

  it('only includes accepted tokens in payment-required accepts array', async () => {
    const stxConfig = makeConfig({ acceptedTokens: ['STX'], serverId: 'stx-only' })
    const tools = makeTools([{ name: 'priced-tool', price: 1.0 }])
    const stxRedis = makeRedis({
      'server:stx-only:config': JSON.stringify(stxConfig),
      'server:stx-only:tools': JSON.stringify(tools),
    })
    const stxApp = createApp({
      redis: stxRedis,
      encryptionKey: ENCRYPTION_KEY,
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev',
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
    })

    const res = await stxApp.request('/api/v1/proxy/stx-only', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })

    expect(res.status).toBe(402)
    const decoded = JSON.parse(Buffer.from(res.headers.get('payment-required')!, 'base64').toString())
    expect(decoded.accepts).toHaveLength(1)
    expect(decoded.accepts[0].asset).toBe('STX')
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

// ─── Payment verification integration tests ───────────────────────────────────

describe('POST /api/v1/proxy/:serverId — payment verification (V2 protocol)', () => {
  let redis: ReturnType<typeof makeRedis>
  let app: ReturnType<typeof createApp>
  let mockSettle: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const config = makeConfig()
    const tools = makeTools([
      { name: 'priced-tool', price: 1.0 },
      { name: 'free-tool', price: 0 },
    ])

    redis = makeRedis({
      [`server:${SERVER_ID}:config`]: JSON.stringify(config),
      [`server:${SERVER_ID}:tools`]: JSON.stringify(tools),
    })

    mockSettle = vi.fn().mockResolvedValue({
      success: true,
      transaction: MOCK_TXID,
      network: 'stacks:1' as const,
      payer: 'SP1SENDER',
    } satisfies SettlementResponseV2)

    app = createApp({
      redis,
      encryptionKey: ENCRYPTION_KEY,
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev',
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
      settlePayment: mockSettle as SettleFunction,
    })

    vi.unstubAllGlobals()
  })

  // ── Success flow ──────────────────────────────────────────────────────────

  it('success: verifies payment, forwards to upstream, returns tool result + payment-response header', async () => {
    const upstreamResult = { jsonrpc: '2.0', id: 1, result: { answer: 42 } }
    mockUpstream(upstreamResult)

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': makePaymentSig(),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })

    expect(res.status).toBe(200)
    expect(mockSettle).toHaveBeenCalledOnce()

    // payment-response header present and correctly encoded
    const paymentResponseHeader = res.headers.get('payment-response')
    expect(paymentResponseHeader).not.toBeNull()
    const decoded = JSON.parse(Buffer.from(paymentResponseHeader!, 'base64').toString('utf8'))
    expect(decoded.txid).toBe(MOCK_TXID)
    expect(decoded.explorerUrl).toContain(MOCK_TXID)
    expect(decoded.explorerUrl).toContain('explorer.hiro.so')

    const body = await res.json()
    expect(body).toMatchObject({ result: { answer: 42 } })
    expect(res.headers.get('payment-required')).toBeNull()
  })

  // ── Replay detection ──────────────────────────────────────────────────────

  it('replay: returns 402 REPLAY_DETECTED when txid already processed', async () => {
    // Pre-seed the txid as already used
    redis._store.set(`payment:${MOCK_TXID}`, 'used')
    mockUpstream({ result: {} })

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': makePaymentSig(),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })

    expect(res.status).toBe(402)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('REPLAY_DETECTED')
  })

  // ── Settlement failure ────────────────────────────────────────────────────

  it('settle returns success:false → 402 PAYMENT_FAILED', async () => {
    mockSettle.mockResolvedValueOnce({
      success: false,
      errorReason: 'insufficient_funds',
      transaction: '',
      network: 'stacks:1' as const,
    } satisfies SettlementResponseV2)

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': makePaymentSig(),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })

    expect(res.status).toBe(402)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('PAYMENT_FAILED')
    expect(body.error).toContain('insufficient_funds')
  })

  // ── Relay failure ─────────────────────────────────────────────────────────

  it('relay failure: returns 503 RELAY_UNAVAILABLE when settle throws', async () => {
    mockSettle.mockRejectedValueOnce(new Error('network timeout'))

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': makePaymentSig(),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })

    expect(res.status).toBe(503)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('RELAY_UNAVAILABLE')
  })

  // ── Invalid payment-signature ─────────────────────────────────────────────

  it('returns 400 when payment-signature is not valid base64 JSON', async () => {
    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': '!!!NOT_BASE64!!!',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })

    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, string>
    expect(body.code).toBe('INVALID_REQUEST')
  })

  // ── Upstream failure after payment ────────────────────────────────────────

  it('upstream failure after payment: returns 502 with txid in body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"error":"tool crashed"}', {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': makePaymentSig({ payload: { transaction: 'tx-upstream-fail' } }),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'priced-tool' }),
    })

    expect(res.status).toBe(502)
    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('UPSTREAM_ERROR')
    expect(body.txid).toBe(MOCK_TXID)
    expect(typeof body.explorerUrl).toBe('string')
  })

  // ── explorerUrl reflects network ──────────────────────────────────────────

  it('explorerUrl contains correct chain for mainnet', async () => {
    mockUpstream({ jsonrpc: '2.0', id: 1, result: {} })

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': makePaymentSig({ payload: { transaction: 'tx-mainnet-check' } }),
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
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev',
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
    vi.unstubAllGlobals()
  })

  it('returns 500 when encryptedAuth cannot be decrypted', async () => {
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
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev',
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

// ─── Hook integration ─────────────────────────────────────────────────────────

function flushImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(() => setTimeout(resolve, 10)))
}

describe('POST /api/v1/proxy/:serverId — hook integration', () => {
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
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev',
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
      hooks: [hook],
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

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
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev',
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
    expect(captured[0]).toMatchObject({ success: false })
  })

  it('hook errors do not affect the gateway response', async () => {
    const hook = { onRequest: vi.fn(async () => { throw new Error('hook exploded') }) }

    const config = makeConfig()
    const tools = makeTools([{ name: 'free-tool', price: 0 }])
    const redis = makeRedis({
      [`server:${SERVER_ID}:config`]: JSON.stringify(config),
      [`server:${SERVER_ID}:tools`]: JSON.stringify(tools),
    })

    const app = createApp({
      redis,
      encryptionKey: ENCRYPTION_KEY,
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev',
      tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
      hooks: [hook],
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'free-tool' }),
    })
    await flushImmediate()

    expect(res.status).toBe(200)
  })
})
