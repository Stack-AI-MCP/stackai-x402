import {
  verifyPayment,
  PaymentVerificationError,
  detectPaymentToken,
  usdToMicro,
} from 'stackai-x402/internal'
import type { RedisLike, TokenType } from 'stackai-x402/internal'
import type { ServerConfig, IntrospectedTool } from './registration.service.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaymentResult {
  txid: string
  explorerUrl: string
}

export interface ProcessPaymentParams {
  /** Raw value of the `payment-signature` header (base64-encoded signed tx) */
  paymentSignature: string
  /** Value of the `payment-id` header — the paymentIdentifier from the 402 response */
  paymentId: string
  tool: IntrospectedTool
  config: ServerConfig
  network: 'mainnet' | 'testnet'
  tokenPrices: Record<TokenType, number>
  redis: RedisLike
  /** Full URL of the relay broadcast endpoint (from RELAY_URL env-var) */
  relayUrl: string
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Runs the 6-step payment verification engine and, on success, returns the
 * transaction ID and explorer URL.
 *
 * Error handling:
 *  - `RELAY_FAILED` → caller should return 503 RELAY_UNAVAILABLE
 *  - Any other `PaymentVerificationError` → caller should return 402 with the code
 *  - Raw Error (Redis infra failure) → propagates; caller's global error handler returns 500
 */
export async function processPayment(params: ProcessPaymentParams): Promise<PaymentResult> {
  const { paymentSignature, paymentId, tool, config, network, tokenPrices, redis, relayUrl } = params

  // Detect which token was used so we can compute the correct expectedAmount.
  // Decoding here is duplicated inside verifyPayment (step 1), but it avoids
  // adding @stacks/transactions as a direct gateway dep.
  const txHex = Buffer.from(paymentSignature, 'base64').toString('hex')
  const tokenType = detectPaymentToken(txHex, network)
  const expectedAmount = usdToMicro(tool.price, tokenType, tokenPrices[tokenType])

  const { txid } = await verifyPayment({
    header: paymentSignature,
    expectedAmount,
    expectedRecipient: config.recipientAddress,
    expectedNetwork: network,
    paymentId,
    redis,
    relayUrl,
  })

  // Build Hiro explorer URL for the confirmed transaction
  const chain = network === 'mainnet' ? 'mainnet' : 'testnet'
  const explorerUrl = `https://explorer.hiro.so/txid/${txid}?chain=${chain}`

  return { txid, explorerUrl }
}
