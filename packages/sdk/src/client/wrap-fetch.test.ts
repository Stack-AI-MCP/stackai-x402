import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { randomPrivateKey, getAddressFromPrivateKey } from '@stacks/transactions'
import { wrapFetch, wrapAxios } from './wrap-fetch.js'
import type { AxiosLike, WrapFetchOptions } from './wrap-fetch.js'
import type { PaymentRequiredV2 } from './with-x402-client.js'

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const senderKey = randomPrivateKey()
const senderAddress = getAddressFromPrivateKey(senderKey, 'testnet')
const recipientAddress = getAddressFromPrivateKey(randomPrivateKey(), 'testnet')

// ── Mock globalThis.fetch for Stacks SDK nonce/fee fetches ──────────────────
// buildPaymentTransaction → makeSTXTokenTransfer → fetchNonce uses
// globalThis.fetch to reach the Stacks API. We mock it to avoid network access.

const NONCE_RESPONSE = { possible_next_nonce: '0', last_executed_tx_nonce: '0' }
const NONCE_RESPONSE_FALLBACK = { nonce: '0', balance: '0x0' }
let originalFetch: typeof globalThis.fetch

beforeAll(() => {
  originalFetch = globalThis.fetch
  // Only intercept Stacks API nonce/fee calls; other calls pass through
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url.includes('/extended/v1/address/') && url.includes('/nonces')) {
      return new Response(JSON.stringify(NONCE_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('/v2/accounts/')) {
      return new Response(JSON.stringify(NONCE_RESPONSE_FALLBACK), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('/v2/fees/')) {
      return new Response('1000', {
        status: 200,
        headers: { 'Content-Type': 'application/text' },
      })
    }

    return originalFetch(input, init)
  }) as typeof globalThis.fetch
})

afterAll(() => {
  globalThis.fetch = originalFetch
})

const paymentRequired: PaymentRequiredV2 = {
  version: 2,
  network: 'stacks:testnet',
  payTo: recipientAddress,
  price: { STX: '500000' },
  paymentIdentifier: 'wrap-test-pid-001',
}
const paymentRequiredB64 = Buffer.from(
  JSON.stringify(paymentRequired),
).toString('base64')

const wrapOptions: WrapFetchOptions = {
  signingCredentials: { privateKey: senderKey, address: senderAddress },
  network: 'testnet',
}

// ─── wrapFetch tests ─────────────────────────────────────────────────────────

describe('wrapFetch', () => {
  it('passes through non-402 responses unchanged', async () => {
    const body = JSON.stringify({ ok: true })
    const innerFetch = vi.fn().mockResolvedValue(
      new Response(body, { status: 200 }),
    )

    const wrappedFetch = wrapFetch(innerFetch, wrapOptions)
    const res = await wrappedFetch('https://api.example.com/data')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(innerFetch).toHaveBeenCalledTimes(1)
  })

  it('passes through 402 without payment-required header', async () => {
    const innerFetch = vi.fn().mockResolvedValue(
      new Response('Pay up', { status: 402 }),
    )

    const wrappedFetch = wrapFetch(innerFetch, wrapOptions)
    const res = await wrappedFetch('https://api.example.com/data')

    expect(res.status).toBe(402)
    expect(innerFetch).toHaveBeenCalledTimes(1) // No retry
  })

  it('passes through 402 with undecodable payment-required header', async () => {
    const innerFetch = vi.fn().mockResolvedValue(
      new Response('Pay up', {
        status: 402,
        headers: { 'payment-required': '!!!not-base64!!!' },
      }),
    )

    const wrappedFetch = wrapFetch(innerFetch, wrapOptions)
    const res = await wrappedFetch('https://api.example.com/data')

    expect(res.status).toBe(402)
    expect(innerFetch).toHaveBeenCalledTimes(1)
  })

  it('handles 402 → payment → retry with correct headers', async () => {
    let callCount = 0
    const innerFetch = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return new Response('', {
          status: 402,
          headers: { 'payment-required': paymentRequiredB64 },
        })
      }
      return new Response(JSON.stringify({ paid: true }), { status: 200 })
    })

    const wrappedFetch = wrapFetch(innerFetch, wrapOptions)
    const res = await wrappedFetch('https://api.example.com/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ paid: true })
    expect(innerFetch).toHaveBeenCalledTimes(2)

    // Verify retry has payment headers
    const retryInit = innerFetch.mock.calls[1][1] as RequestInit
    const retryHeaders = new Headers(retryInit.headers)
    expect(retryHeaders.get('payment-signature')).toBeTruthy()
    expect(retryHeaders.get('payment-id')).toBe('wrap-test-pid-001')
    // Original Content-Type preserved
    expect(retryHeaders.get('Content-Type')).toBe('application/json')
  })

  it('respects tokenPreference', async () => {
    const multiTokenPayment: PaymentRequiredV2 = {
      ...paymentRequired,
      price: { STX: '1000000', sBTC: '1000' },
    }
    const b64 = Buffer.from(JSON.stringify(multiTokenPayment)).toString('base64')

    let callCount = 0
    const innerFetch = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return new Response('', {
          status: 402,
          headers: { 'payment-required': b64 },
        })
      }
      return new Response('{}', { status: 200 })
    })

    const wrappedFetch = wrapFetch(innerFetch, {
      ...wrapOptions,
      tokenPreference: 'sBTC',
    })

    await wrappedFetch('https://api.example.com/data')
    expect(innerFetch).toHaveBeenCalledTimes(2)
  })

  it('does not loop when retry also returns 402', async () => {
    // Both initial and retry return 402
    const innerFetch = vi.fn().mockResolvedValue(
      new Response('', {
        status: 402,
        headers: { 'payment-required': paymentRequiredB64 },
      }),
    )

    const wrappedFetch = wrapFetch(innerFetch, wrapOptions)
    const res = await wrappedFetch('https://api.example.com/data')

    // Returns the retry 402 response, does NOT loop
    expect(res.status).toBe(402)
    expect(innerFetch).toHaveBeenCalledTimes(2) // initial + one retry, no more
  })

  it('passes through 402 when buildPaymentTransaction fails', async () => {
    // Valid 402 header but with an invalid recipient that will cause
    // buildPaymentTransaction to throw
    const badRecipientPayment: PaymentRequiredV2 = {
      ...paymentRequired,
      payTo: '0xINVALID_NOT_A_STACKS_ADDRESS',
    }
    const b64 = Buffer.from(JSON.stringify(badRecipientPayment)).toString('base64')

    const innerFetch = vi.fn().mockResolvedValue(
      new Response('', {
        status: 402,
        headers: { 'payment-required': b64 },
      }),
    )

    const wrappedFetch = wrapFetch(innerFetch, wrapOptions)
    const res = await wrappedFetch('https://api.example.com/data')

    // Should pass through the original 402, not throw
    expect(res.status).toBe(402)
    expect(innerFetch).toHaveBeenCalledTimes(1) // No retry attempted
  })

  it('passes through 402 when no supported tokens available', async () => {
    const unsupportedPayment: PaymentRequiredV2 = {
      ...paymentRequired,
      price: { DOGE: '999999' },
    }
    const b64 = Buffer.from(JSON.stringify(unsupportedPayment)).toString('base64')

    const innerFetch = vi.fn().mockResolvedValue(
      new Response('', {
        status: 402,
        headers: { 'payment-required': b64 },
      }),
    )

    const wrappedFetch = wrapFetch(innerFetch, wrapOptions)
    const res = await wrappedFetch('https://api.example.com/data')

    expect(res.status).toBe(402)
    expect(innerFetch).toHaveBeenCalledTimes(1) // No retry — selectToken threw
  })
})

// ─── wrapAxios tests ─────────────────────────────────────────────────────────

describe('wrapAxios', () => {
  function createMockAxios() {
    type OnFulfilled = ((res: unknown) => unknown) | null
    type OnRejected = (err: unknown) => unknown

    let rejectionHandler: OnRejected | undefined

    const instance: AxiosLike & { _triggerRejection(err: unknown): Promise<unknown> } = {
      interceptors: {
        response: {
          use(onFulfilled: OnFulfilled, onRejected?: OnRejected): number {
            rejectionHandler = onRejected
            return 0
          },
        },
      },
      request: vi.fn(),
      // Test helper to simulate rejection
      async _triggerRejection(err: unknown): Promise<unknown> {
        if (!rejectionHandler) throw new Error('No rejection handler registered')
        return rejectionHandler(err)
      },
    }

    return instance
  }

  it('registers a response interceptor', () => {
    const mock = createMockAxios()
    const useSpy = vi.spyOn(mock.interceptors.response, 'use')

    wrapAxios(mock, wrapOptions)

    expect(useSpy).toHaveBeenCalledTimes(1)
    expect(useSpy).toHaveBeenCalledWith(null, expect.any(Function))
  })

  it('re-throws non-402 errors', async () => {
    const mock = createMockAxios()
    wrapAxios(mock, wrapOptions)

    const error = { response: { status: 500, headers: {} }, config: {} }
    await expect(mock._triggerRejection(error)).rejects.toBe(error)
  })

  it('re-throws errors without response', async () => {
    const mock = createMockAxios()
    wrapAxios(mock, wrapOptions)

    const error = new Error('network error')
    await expect(mock._triggerRejection(error)).rejects.toBe(error)
  })

  it('re-throws 402 without payment-required header', async () => {
    const mock = createMockAxios()
    wrapAxios(mock, wrapOptions)

    const error = { response: { status: 402, headers: {} }, config: { headers: {} } }
    await expect(mock._triggerRejection(error)).rejects.toBe(error)
  })

  it('handles 402 with payment-required → retries via instance.request', async () => {
    const mock = createMockAxios()
    ;(mock.request as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { paid: true } })

    wrapAxios(mock, wrapOptions)

    const error = {
      response: {
        status: 402,
        headers: { 'payment-required': paymentRequiredB64 },
      },
      config: {
        headers: { 'Content-Type': 'application/json' },
        url: 'https://api.example.com/data',
      },
    }

    const result = await mock._triggerRejection(error)

    expect(result).toEqual({ data: { paid: true } })
    expect(mock.request).toHaveBeenCalledTimes(1)

    const retryConfig = (mock.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      headers: Record<string, string>
      url: string
    }
    expect(retryConfig.headers['payment-signature']).toBeTruthy()
    expect(retryConfig.headers['payment-id']).toBe('wrap-test-pid-001')
    expect(retryConfig.url).toBe('https://api.example.com/data')
    // Original Content-Type preserved
    expect(retryConfig.headers['Content-Type']).toBe('application/json')
  })
})
