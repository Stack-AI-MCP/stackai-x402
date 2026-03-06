import {
  deserializeTransaction,
  PayloadType,
} from '@stacks/transactions'
import type {
  StacksTransactionWire,
  TokenTransferPayloadWire,
  ContractCallPayload,
} from '@stacks/transactions'
import type { StandardPrincipalCV, ContractPrincipalCV, UIntCV } from '@stacks/transactions'
import { ClarityType } from '@stacks/transactions'
import { networkToCAIP2 } from './caip2.js'
import { broadcastTransaction } from './relay-client.js'

// ─── Error types ──────────────────────────────────────────────────────────────

export type VerificationErrorCode =
  | 'DECODE_FAILED'
  | 'DESERIALIZE_FAILED'
  | 'AMOUNT_MISMATCH'
  | 'RECIPIENT_MISMATCH'
  | 'NETWORK_MISMATCH'
  | 'REPLAY_DETECTED'
  | 'RELAY_FAILED'

export class PaymentVerificationError extends Error {
  constructor(
    public readonly code: VerificationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PaymentVerificationError'
  }
}

// ─── Duck-typed Redis interface (avoids ioredis import in SDK) ────────────────

export interface RedisLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set(key: string, value: string, ...args: any[]): Promise<string | null>
  get(key: string): Promise<string | null>
  del(key: string): Promise<number>
}

// ─── Parameters ───────────────────────────────────────────────────────────────

export interface VerifyPaymentParams {
  /** Base64-encoded serialized signed Stacks transaction (the `payment-signature` header value) */
  header: string
  /** Minimum acceptable payment amount in the token's smallest unit */
  expectedAmount: bigint
  /** Expected recipient Stacks address (case-insensitive) */
  expectedRecipient: string
  expectedNetwork: 'mainnet' | 'testnet'
  /** Unique identifier for idempotency — used as the Redis dedup key */
  paymentId: string
  redis: RedisLike
  /** Full URL of the relay broadcast endpoint (e.g. https://x402-relay.aibtc.com/broadcast) */
  relayUrl: string
}

// Standard base64 alphabet + padding — Buffer.from('base64') is lenient so we validate explicitly
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

function isValidBase64(s: string): boolean {
  return s.length > 0 && s.length % 4 === 0 && BASE64_RE.test(s)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function extractAmount(tx: StacksTransactionWire): bigint {
  if (tx.payload.payloadType === PayloadType.TokenTransfer) {
    return (tx.payload as TokenTransferPayloadWire).amount
  }
  if (tx.payload.payloadType === PayloadType.ContractCall) {
    const amountCV = (tx.payload as ContractCallPayload).functionArgs[0] as UIntCV
    return amountCV.value as bigint
  }
  throw new Error(`Unsupported payload type: ${tx.payload.payloadType}`)
}

function extractRecipient(tx: StacksTransactionWire): string {
  if (tx.payload.payloadType === PayloadType.TokenTransfer) {
    return (tx.payload as TokenTransferPayloadWire).recipient.value
  }
  if (tx.payload.payloadType === PayloadType.ContractCall) {
    const args = (tx.payload as ContractCallPayload).functionArgs
    // SIP-010 transfer: [amount, sender, recipient, memo] — recipient is index 2
    if (args.length < 3) {
      throw new Error(`ContractCall has only ${args.length} args; expected ≥3 for a SIP-010 transfer`)
    }
    const recipientCV = args[2]
    if (recipientCV.type === ClarityType.PrincipalStandard) {
      return (recipientCV as StandardPrincipalCV).value
    }
    if (recipientCV.type === ClarityType.PrincipalContract) {
      // ContractPrincipalCV.value is ContractIdString ("address.contractName")
      return (recipientCV as ContractPrincipalCV).value
    }
    throw new Error(`Unsupported recipient CV type in SIP-010 args: ${recipientCV.type}`)
  }
  throw new Error(`Unsupported payload type: ${tx.payload.payloadType}`)
}

// ─── 6-Step verification engine ───────────────────────────────────────────────

/**
 * Verifies an x402 payment-signature header in 6 strict steps.
 *
 * SECURITY: Steps execute in MANDATORY order — validation (3–5) always
 * precedes the Redis NX write (6). Never reorder.
 *
 * PRIVACY: The raw `header` value is NEVER logged — only the txid after
 * deserialization may appear in logs.
 *
 * NOTE: If `RELAY_FAILED` is thrown, a best-effort `redis.del()` rollback is
 * attempted. If the rollback succeeds the paymentId CAN be retried with the
 * same value. If the rollback itself fails, the paymentId is locked for 30
 * days and the caller must issue a new one.
 *
 * NOTE: If Redis itself throws (connection failure, timeout), the raw error
 * propagates — it is NOT wrapped as `REPLAY_DETECTED`. Callers can distinguish
 * infrastructure failures from payment replays by checking
 * `err instanceof PaymentVerificationError`.
 *
 * @throws PaymentVerificationError with a typed error code on payment failures
 * @throws Error (raw) on Redis infrastructure failures
 */
export async function verifyPayment(params: VerifyPaymentParams): Promise<{ txid: string }> {
  const { header, expectedAmount, expectedRecipient, expectedNetwork, paymentId, redis, relayUrl } = params

  // Step 1: Validate and base64-decode header → hex
  if (!isValidBase64(header)) {
    throw new PaymentVerificationError(
      'DECODE_FAILED',
      'Payment header is not valid base64 (must be non-empty, use standard alphabet, and have correct padding)',
    )
  }
  const txHex = Buffer.from(header, 'base64').toString('hex')

  // Step 2: Deserialize transaction
  let tx: StacksTransactionWire
  try {
    tx = deserializeTransaction(txHex)
  } catch (err) {
    throw new PaymentVerificationError('DESERIALIZE_FAILED', `Failed to deserialize transaction: ${err}`)
  }

  // Step 3: Validate amount >= expectedAmount
  let txAmount: bigint
  try {
    txAmount = extractAmount(tx)
  } catch (err) {
    throw new PaymentVerificationError('AMOUNT_MISMATCH', `Cannot extract amount from transaction: ${err}`)
  }
  if (txAmount < expectedAmount) {
    throw new PaymentVerificationError(
      'AMOUNT_MISMATCH',
      `Transaction amount ${txAmount} is less than required ${expectedAmount}`,
    )
  }

  // Step 4: Validate recipient (case-insensitive Stacks address comparison)
  let txRecipient: string
  try {
    txRecipient = extractRecipient(tx)
  } catch (err) {
    throw new PaymentVerificationError('RECIPIENT_MISMATCH', `Cannot extract recipient from transaction: ${err}`)
  }
  if (txRecipient.toLowerCase() !== expectedRecipient.toLowerCase()) {
    throw new PaymentVerificationError(
      'RECIPIENT_MISMATCH',
      `Transaction recipient ${txRecipient} does not match expected ${expectedRecipient}`,
    )
  }

  // Step 5: Validate CAIP-2 network
  const txCAIP2 = `stacks:${tx.chainId}`
  const expectedCAIP2 = networkToCAIP2(expectedNetwork)
  if (txCAIP2 !== expectedCAIP2) {
    throw new PaymentVerificationError(
      'NETWORK_MISMATCH',
      `Transaction targets network ${txCAIP2} but expected ${expectedCAIP2}`,
    )
  }

  // Step 6: Redis NX replay check (atomic — safe against concurrent replays).
  // Raw Redis errors propagate as-is (not REPLAY_DETECTED) so callers can
  // distinguish "already processed" from "infrastructure unavailable".
  const redisKey = `payment:${paymentId}`
  const setResult = await redis.set(redisKey, 'used', 'NX', 'EX', 2_592_000)
  if (setResult === null) {
    throw new PaymentVerificationError('REPLAY_DETECTED', `Payment ${paymentId} has already been processed`)
  }

  // Relay broadcast — after all 6 steps pass.
  // On failure: rollback the Redis key so the paymentId can be retried.
  let txid: string
  try {
    const result = await broadcastTransaction(txHex, relayUrl)
    txid = result.txid
  } catch (err) {
    await redis.del(redisKey).catch(() => undefined) // best-effort rollback
    throw new PaymentVerificationError('RELAY_FAILED', `Relay broadcast failed: ${err}`)
  }

  return { txid }
}
