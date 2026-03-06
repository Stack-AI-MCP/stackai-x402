import { buildPaymentTransaction } from '../internal/payment-builder.js'
import type { TokenType } from '../internal/token-registry.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SigningCredentials {
  /** Hex-encoded Stacks private key (32 or 33 bytes). NEVER sent over the wire. */
  privateKey: string
  /** Stacks address (SP/ST prefix) — used for display / future validation */
  address: string
}

export interface AgentClientOptions {
  signingCredentials: SigningCredentials
  gatewayBaseUrl: string
  network: 'mainnet' | 'testnet'
  /** Preferred token for payments. Falls back to priority order (STX > sBTC > USDCx) if unavailable. */
  tokenPreference?: TokenType
}

export interface AgentClient {
  callTool(serverId: string, toolName: string, params?: unknown): Promise<unknown>
}

/** The base64-decoded JSON shape of the `payment-required` response header. */
export interface PaymentRequiredV2 {
  version: number
  network: string
  payTo: string
  /** Token → amount in smallest unit (as string, to avoid bigint JSON issues). */
  price: Record<string, string>
  paymentIdentifier: string
}

// ─── Token selection ──────────────────────────────────────────────────────────

const TOKEN_PRIORITY: TokenType[] = ['STX', 'sBTC', 'USDCx']

/**
 * Picks the token to pay with.
 * Uses `preference` if it appears in `availableTokens`;
 * otherwise falls back to STX > sBTC > USDCx priority order.
 */
export function selectToken(
  availableTokens: string[],
  preference?: TokenType,
): TokenType {
  if (preference && availableTokens.includes(preference)) {
    return preference
  }
  const found = TOKEN_PRIORITY.find((t) => availableTokens.includes(t))
  if (!found) {
    throw new Error(
      `No supported payment token in endpoint requirements: ${availableTokens.join(', ')}`,
    )
  }
  return found
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates an autonomous x402 agent client that automatically handles
 * 402 Payment Required flows without human intervention.
 *
 * The private key is used to sign transactions locally — it is NEVER
 * sent to the gateway or any remote service.
 */
export function createAgentClient(options: AgentClientOptions): AgentClient {
  const { signingCredentials, gatewayBaseUrl, network, tokenPreference } = options

  // Strip trailing slash from base URL
  const baseUrl = gatewayBaseUrl.replace(/\/+$/, '')

  return {
    async callTool(serverId: string, toolName: string, params?: unknown): Promise<unknown> {
      const url = `${baseUrl}/api/v1/proxy/${serverId}`

      const jsonRpcBody = {
        jsonrpc: '2.0',
        id: 1,
        method: toolName,
        params: params ?? {},
      }

      const requestInit: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonRpcBody),
      }

      // ── First attempt — may return 402 ──────────────────────────────
      const firstRes = await fetch(url, requestInit)

      if (firstRes.status !== 402) {
        if (!firstRes.ok) {
          const body = await firstRes.text().catch(() => '(no body)')
          throw new Error(`Tool call failed with HTTP ${firstRes.status}: ${body}`)
        }
        return firstRes.json()
      }

      // ── 402 — decode payment requirements ───────────────────────────
      const paymentRequiredHeader = firstRes.headers.get('payment-required')
      if (!paymentRequiredHeader) {
        throw new Error('Received 402 but no payment-required header present')
      }

      let paymentRequired: PaymentRequiredV2
      try {
        const decoded = Buffer.from(paymentRequiredHeader, 'base64').toString('utf-8')
        paymentRequired = JSON.parse(decoded) as PaymentRequiredV2
      } catch {
        throw new Error('Failed to decode payment-required header as base64 JSON')
      }

      // ── Select token ────────────────────────────────────────────────
      const availableTokens = Object.keys(paymentRequired.price)
      const selectedToken = selectToken(availableTokens, tokenPreference)
      const amount = BigInt(paymentRequired.price[selectedToken])

      // ── Build + sign payment transaction locally ────────────────────
      const txHex = await buildPaymentTransaction({
        senderKey: signingCredentials.privateKey,
        recipient: paymentRequired.payTo,
        amount,
        tokenType: selectedToken,
        network,
      })

      // ── Retry with payment headers ──────────────────────────────────
      const paymentSignature = Buffer.from(txHex, 'hex').toString('base64')

      const retryRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'payment-signature': paymentSignature,
          'payment-id': paymentRequired.paymentIdentifier,
        },
        body: JSON.stringify(jsonRpcBody),
      })

      if (!retryRes.ok) {
        const body = await retryRes.text().catch(() => '(no body)')
        throw new Error(`Paid tool call failed with HTTP ${retryRes.status}: ${body}`)
      }

      return retryRes.json()
    },
  }
}
