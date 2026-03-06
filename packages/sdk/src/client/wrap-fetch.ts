import { buildPaymentTransaction } from '../internal/payment-builder.js'
import type { TokenType } from '../internal/token-registry.js'
import type { SigningCredentials, PaymentRequiredV2 } from './with-x402-client.js'
import { selectToken } from './with-x402-client.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WrapFetchOptions {
  signingCredentials: SigningCredentials
  network: 'mainnet' | 'testnet'
  tokenPreference?: TokenType
}

type FetchFn = typeof globalThis.fetch

/**
 * Duck-typed axios instance — avoids importing axios as a dependency.
 * Only the subset of the axios API needed for the 402 interceptor.
 */
export interface AxiosLike {
  interceptors: {
    response: {
      use(
        onFulfilled: ((res: unknown) => unknown) | null,
        onRejected?: (err: unknown) => unknown,
      ): number
    }
  }
  request(config: unknown): Promise<unknown>
}

// ─── wrapFetch ────────────────────────────────────────────────────────────────

/**
 * Wraps a `fetch` function to automatically handle x402 payment flows.
 * When a 402 response is received with a `payment-required` header,
 * the wrapper builds and signs a payment transaction locally, then
 * retries the request with the `payment-signature` and `payment-id` headers.
 *
 * @returns A new fetch function with the same signature as the original.
 */
export function wrapFetch(fetchFn: FetchFn, options: WrapFetchOptions): FetchFn {
  const { signingCredentials, network, tokenPreference } = options

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await fetchFn(input, init)

    if (res.status !== 402) return res

    const paymentRequiredHeader = res.headers.get('payment-required')
    if (!paymentRequiredHeader) return res

    let paymentRequired: PaymentRequiredV2
    try {
      const decoded = Buffer.from(paymentRequiredHeader, 'base64').toString('utf-8')
      paymentRequired = JSON.parse(decoded) as PaymentRequiredV2
    } catch {
      return res // Can't decode — pass through the original 402 response
    }

    const availableTokens = Object.keys(paymentRequired.price)

    let selectedToken: TokenType
    try {
      selectedToken = selectToken(availableTokens, tokenPreference)
    } catch {
      return res // No supported token — pass through
    }

    const amount = BigInt(paymentRequired.price[selectedToken])

    const txHex = await buildPaymentTransaction({
      senderKey: signingCredentials.privateKey,
      recipient: paymentRequired.payTo,
      amount,
      tokenType: selectedToken,
      network,
    })

    const paymentSignature = Buffer.from(txHex, 'hex').toString('base64')

    // Merge payment headers into the original request headers
    const newHeaders = new Headers(init?.headers)
    newHeaders.set('payment-signature', paymentSignature)
    newHeaders.set('payment-id', paymentRequired.paymentIdentifier)

    return fetchFn(input, { ...init, headers: newHeaders })
  }
}

// ─── wrapAxios ────────────────────────────────────────────────────────────────

/**
 * Adds an x402 response interceptor to an axios-like instance.
 * On 402 responses with a `payment-required` header, the interceptor
 * builds a payment transaction and retries the request automatically.
 *
 * Note: axios treats 4xx as errors by default, so the interceptor
 * hooks into the rejection handler.
 */
export function wrapAxios(instance: AxiosLike, options: WrapFetchOptions): void {
  const { signingCredentials, network, tokenPreference } = options

  instance.interceptors.response.use(null, async (error: unknown) => {
    // Duck-type the axios error shape
    const axiosError = error as {
      response?: { status: number; headers: Record<string, string> }
      config?: { headers: Record<string, string>; [key: string]: unknown }
    }

    const response = axiosError?.response
    if (!response || response.status !== 402) throw error

    const paymentRequiredHeader = response.headers?.['payment-required']
    if (!paymentRequiredHeader) throw error

    let paymentRequired: PaymentRequiredV2
    try {
      const decoded = Buffer.from(paymentRequiredHeader, 'base64').toString('utf-8')
      paymentRequired = JSON.parse(decoded) as PaymentRequiredV2
    } catch {
      throw error // Can't decode — propagate original error
    }

    const availableTokens = Object.keys(paymentRequired.price)
    const selectedToken = selectToken(availableTokens, tokenPreference)
    const amount = BigInt(paymentRequired.price[selectedToken])

    const txHex = await buildPaymentTransaction({
      senderKey: signingCredentials.privateKey,
      recipient: paymentRequired.payTo,
      amount,
      tokenType: selectedToken,
      network,
    })

    const paymentSignature = Buffer.from(txHex, 'hex').toString('base64')

    // Retry with payment headers merged into the original request config
    const retryConfig = {
      ...axiosError.config,
      headers: {
        ...axiosError.config?.headers,
        'payment-signature': paymentSignature,
        'payment-id': paymentRequired.paymentIdentifier,
      },
    }

    return instance.request(retryConfig)
  })
}
