import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomPrivateKey, getAddressFromPrivateKey } from '@stacks/transactions'
import { selectToken, createAgentClient } from './with-x402-client.js'
import type { PaymentRequiredV2 } from './with-x402-client.js'

// ─── selectToken tests ───────────────────────────────────────────────────────

describe('selectToken', () => {
  it('returns the preferred token when available', () => {
    expect(selectToken(['STX', 'sBTC'], 'sBTC')).toBe('sBTC')
  })

  it('falls back to priority order when preference is unavailable', () => {
    expect(selectToken(['sBTC', 'USDCx'], 'STX')).toBe('sBTC')
  })

  it('falls back to priority order when no preference given', () => {
    expect(selectToken(['USDCx', 'sBTC'])).toBe('sBTC')
  })

  it('selects STX first in priority order', () => {
    expect(selectToken(['USDCx', 'STX', 'sBTC'])).toBe('STX')
  })

  it('throws when no supported tokens are available', () => {
    expect(() => selectToken(['DOGE', 'SHIB'])).toThrow(
      'No supported payment token',
    )
  })
})

// ─── createAgentClient tests ─────────────────────────────────────────────────

describe('createAgentClient', () => {
  const senderKey = randomPrivateKey()
  const senderAddress = getAddressFromPrivateKey(senderKey, 'testnet')

  const GATEWAY_URL = 'https://gateway.example.com'

  // Build a valid payment-required header
  const paymentRequired: PaymentRequiredV2 = {
    version: 2,
    network: 'stacks:testnet',
    payTo: getAddressFromPrivateKey(randomPrivateKey(), 'testnet'),
    price: { STX: '1000000' },
    paymentIdentifier: 'test-payment-id-001',
  }
  const paymentRequiredB64 = Buffer.from(
    JSON.stringify(paymentRequired),
  ).toString('base64')

  let originalFetch: typeof globalThis.fetch

  beforeAll(() => {
    originalFetch = globalThis.fetch
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  // ── Helper: URL-aware mock fetch ──────────────────────────────────────────
  // @stacks/transactions internally calls fetchNonce via globalThis.fetch to
  // get the sender nonce from the Stacks API. We need to route those calls to
  // a valid nonce response while intercepting gateway calls for 402 testing.

  /** Valid Stacks API nonce responses */
  const NONCE_RESPONSE = { possible_next_nonce: '0', last_executed_tx_nonce: '0' }
  const NONCE_RESPONSE_FALLBACK = { nonce: '0', balance: '0x0' }

  /**
   * Creates a fetch mock that routes by URL:
   * - Stacks API nonce endpoints → valid nonce response
   * - Gateway URLs → handled by `gatewayHandler`
   */
  function createRoutingFetch(
    gatewayHandler: (url: string, init?: RequestInit) => Promise<Response>,
  ): typeof globalThis.fetch {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString()

      // Stacks API nonce fetch — /extended/v1/address/.../nonces
      if (url.includes('/extended/v1/address/') && url.includes('/nonces')) {
        return new Response(JSON.stringify(NONCE_RESPONSE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Stacks API nonce fallback — /v2/accounts/...
      if (url.includes('/v2/accounts/')) {
        return new Response(JSON.stringify(NONCE_RESPONSE_FALLBACK), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Stacks API fee estimate
      if (url.includes('/v2/fees/')) {
        return new Response('1000', {
          status: 200,
          headers: { 'Content-Type': 'application/text' },
        })
      }

      // Gateway calls
      return gatewayHandler(url, init)
    }) as typeof globalThis.fetch
  }

  it('returns JSON on non-402 success response', async () => {
    const mockResult = { jsonrpc: '2.0', id: 1, result: { ok: true } }

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockResult), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const client = createAgentClient({
      signingCredentials: { privateKey: senderKey, address: senderAddress },
      gatewayBaseUrl: GATEWAY_URL,
      network: 'testnet',
    })

    const result = await client.callTool('server-1', 'tools/call')
    expect(result).toEqual(mockResult)
    // Only gateway call, no nonce fetch needed (no 402 → no payment build)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('throws on non-402 error response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    )

    const client = createAgentClient({
      signingCredentials: { privateKey: senderKey, address: senderAddress },
      gatewayBaseUrl: GATEWAY_URL,
      network: 'testnet',
    })

    await expect(client.callTool('server-1', 'tools/call')).rejects.toThrow(
      'HTTP 500',
    )
  })

  it('throws on 402 without payment-required header', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Payment Required', { status: 402 }),
    )

    const client = createAgentClient({
      signingCredentials: { privateKey: senderKey, address: senderAddress },
      gatewayBaseUrl: GATEWAY_URL,
      network: 'testnet',
    })

    await expect(client.callTool('server-1', 'tools/call')).rejects.toThrow(
      'no payment-required header',
    )
  })

  it('handles 402 → builds payment → retries successfully', async () => {
    const mockResult = { jsonrpc: '2.0', id: 1, result: { paid: true } }

    let gatewayCallCount = 0
    globalThis.fetch = createRoutingFetch(async () => {
      gatewayCallCount++
      if (gatewayCallCount === 1) {
        return new Response('Payment Required', {
          status: 402,
          headers: { 'payment-required': paymentRequiredB64 },
        })
      }
      return new Response(JSON.stringify(mockResult), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const client = createAgentClient({
      signingCredentials: { privateKey: senderKey, address: senderAddress },
      gatewayBaseUrl: GATEWAY_URL + '/',
      network: 'testnet',
    })

    const result = await client.callTool('server-1', 'tools/call', { q: 'hi' })
    expect(result).toEqual(mockResult)
    expect(gatewayCallCount).toBe(2)

    // Verify the retry request has payment headers by inspecting all fetch calls
    const allCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
    const gatewayCalls = allCalls.filter(
      (call) => (call[0] as string).includes('gateway.example.com'),
    )
    expect(gatewayCalls).toHaveLength(2)

    const retryInit = gatewayCalls[1][1] as RequestInit
    const retryHeaders = retryInit.headers as Record<string, string>
    expect(retryHeaders['payment-signature']).toBeDefined()
    expect(retryHeaders['payment-signature'].length).toBeGreaterThan(0)
    expect(retryHeaders['payment-id']).toBe('test-payment-id-001')
  })

  it('sends correct JSON-RPC body on both gateway calls', async () => {
    let gatewayCallCount = 0
    globalThis.fetch = createRoutingFetch(async () => {
      gatewayCallCount++
      if (gatewayCallCount === 1) {
        return new Response('Payment Required', {
          status: 402,
          headers: { 'payment-required': paymentRequiredB64 },
        })
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
        status: 200,
      })
    })

    const client = createAgentClient({
      signingCredentials: { privateKey: senderKey, address: senderAddress },
      gatewayBaseUrl: GATEWAY_URL,
      network: 'testnet',
    })

    await client.callTool('my-server', 'tools/call', { prompt: 'hello' })

    // Check only gateway calls (not nonce/fee fetches)
    const allCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
    const gatewayCalls = allCalls.filter(
      (call) => (call[0] as string).includes('gateway.example.com'),
    )

    expect(gatewayCalls).toHaveLength(2)
    for (const call of gatewayCalls) {
      expect(call[0]).toBe(`${GATEWAY_URL}/api/v1/proxy/my-server`)
      const body = JSON.parse((call[1] as RequestInit).body as string)
      expect(body.jsonrpc).toBe('2.0')
      expect(body.method).toBe('tools/call')
      expect(body.params).toEqual({ prompt: 'hello' })
    }
  })

  it('strips trailing slashes from gatewayBaseUrl', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: 'ok' }), { status: 200 }),
    )

    const client = createAgentClient({
      signingCredentials: { privateKey: senderKey, address: senderAddress },
      gatewayBaseUrl: 'https://gateway.example.com///',
      network: 'testnet',
    })

    await client.callTool('srv', 'tools/call')
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(url).toBe('https://gateway.example.com/api/v1/proxy/srv')
  })

  it('payment-signature header is valid base64 of a Stacks tx', async () => {
    let gatewayCallCount = 0
    globalThis.fetch = createRoutingFetch(async () => {
      gatewayCallCount++
      if (gatewayCallCount === 1) {
        return new Response('Payment Required', {
          status: 402,
          headers: { 'payment-required': paymentRequiredB64 },
        })
      }
      return new Response(JSON.stringify({ result: 'ok' }), { status: 200 })
    })

    const client = createAgentClient({
      signingCredentials: { privateKey: senderKey, address: senderAddress },
      gatewayBaseUrl: GATEWAY_URL,
      network: 'testnet',
    })

    await client.callTool('srv', 'tools/call')

    // Find the retry gateway call (second one)
    const allCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
    const gatewayCalls = allCalls.filter(
      (call) => (call[0] as string).includes('gateway.example.com'),
    )
    const retryInit = gatewayCalls[1][1] as RequestInit
    const sig = (retryInit.headers as Record<string, string>)['payment-signature']

    // Decode base64 → hex → verify it's a valid hex string (serialized Stacks tx)
    const txHex = Buffer.from(sig, 'base64').toString('hex')
    expect(txHex).toMatch(/^[0-9a-f]+$/)
    expect(txHex.length).toBeGreaterThan(100)
  })
})
