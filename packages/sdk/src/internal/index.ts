// Internal aggregator — NOT re-exported from src/index.ts
// All exports here are for SDK-internal use only.

// ─── Kept internal utilities ──────────────────────────────────────────────────
export { encrypt, decrypt } from './crypto.js'
export { usdToMicro } from './price-converter.js'

// ─── Re-exports from x402-stacks ──────────────────────────────────────────────
export {
  networkToCAIP2,
  STXtoMicroSTX,
  BTCtoSats,
  USDCxToMicroUSDCx,
  getTokenDecimals,
  getDefaultSBTCContract,
  getDefaultUSDCxContract,
  X402PaymentVerifier,
  privateKeyToAccount,
} from 'x402-stacks'

export type {
  TokenType,
  PaymentRequiredV2,
  PaymentPayloadV2,
  PaymentRequirementsV2,
  SettlementResponseV2,
} from 'x402-stacks'

// ─── RedisLike — duck-typed Redis interface (avoids ioredis import in SDK) ────
export interface RedisLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set(key: string, value: string, ...args: any[]): Promise<string | null>
  get(key: string): Promise<string | null>
  del(key: string): Promise<number>
  /** Cursor-based key iteration — safe for production (non-blocking). */
  scan(cursor: string, ...args: string[]): Promise<[string, string[]]>
  /** Fetch multiple keys in one round-trip. */
  mget(...keys: string[]): Promise<(string | null)[]>
  /** Increment a key by 1. */
  incr(key: string): Promise<number>
  /** Increment a key by a specific amount. */
  incrby(key: string, amount: number | string): Promise<number>
  /** HyperLogLog add — probabilistic unique count. */
  pfadd(key: string, ...elements: string[]): Promise<number>
  /** HyperLogLog count — approximate unique element count. */
  pfcount(key: string): Promise<number>
  /** Sorted set — add member with score. */
  zadd(key: string, score: number, member: string): Promise<number>
  /** Sorted set — get members in reverse score order (newest first). */
  zrevrange(key: string, start: number, stop: number): Promise<string[]>
  /** Sorted set — count all members. */
  zcard(key: string): Promise<number>
  /** Sorted set — remove a member. */
  zrem(key: string, member: string): Promise<number>
}
