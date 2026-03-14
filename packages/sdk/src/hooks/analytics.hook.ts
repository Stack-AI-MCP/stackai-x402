import type { Hook, RequestContext } from './hook.interface.js'
import type { RedisLike } from '../internal/index.js'

/** Payload emitted when a server exceeds the error rate threshold. */
export interface ErrorRateAlertPayload {
  serverId: string
  errorRate: number
}

/** Minimal interface for PostgreSQL dual-write (dependency injection). */
export interface AnalyticsDb {
  insertAnalyticsEvent(event: {
    serverId: string
    toolName: string
    payer: string | null
    txid: string | null
    amount: string | null
    token: string | null
    success: boolean
    durationMs: number
    timestamp: string
  }): Promise<void>
}

/**
 * Analytics hook — writes request metrics to Redis and PostgreSQL.
 *
 * All Redis writes are wrapped in `setImmediate` to guarantee they never
 * block the gateway response (NFR3, AC5). Errors are silently swallowed.
 *
 * Redis key schema:
 *   analytics:{serverId}:{YYYY-MM-DD}:calls        — INCR per call
 *   analytics:{serverId}:{YYYY-MM-DD}:errors       — INCR on failed calls
 *   analytics:{serverId}:{YYYY-MM-DD}:revenue:{tok} — INCRBY amount
 *   analytics:{serverId}:1h:calls                   — INCR per call (EX 3600, rolling 1h window)
 *   analytics:{serverId}:1h:errors                  — INCR on failed calls (EX 3600)
 *   analytics:{serverId}:callers                    — PFADD unique callers
 *   alert:{serverId}:error-rate                     — SET NX EX 3600 (dedup, max 1 alert/hour)
 *   audit:{txHash}                                  — SET with 90-day TTL
 */
export class AnalyticsHook implements Hook {
  constructor(
    private readonly redis: RedisLike,
    private readonly db?: AnalyticsDb,
    private readonly onAlert?: (payload: ErrorRateAlertPayload) => void,
  ) {}

  async onRequest(ctx: RequestContext): Promise<void> {
    try {
      const date = ctx.timestamp.slice(0, 10) // YYYY-MM-DD
      const redis = this.redis

      // All Redis writes via setImmediate — NEVER block the request cycle
      setImmediate(() => {
        // Per-day keys expire after 33 days to prevent unbounded Redis growth
        const ttl = 33 * 86_400

        // Increment call counter (SET NX initialises key with TTL on first write of the day)
        const callKey = `analytics:${ctx.serverId}:${date}:calls`
        redis.set(callKey, '0', 'EX', ttl, 'NX').catch(() => {})
        redis.incr(callKey).catch(() => {})

        // Error tracking (failed calls only — for operator error-rate dashboard)
        if (!ctx.success) {
          const errKey = `analytics:${ctx.serverId}:${date}:errors`
          redis.set(errKey, '0', 'EX', ttl, 'NX').catch(() => {})
          redis.incr(errKey).catch(() => {})
        }

        // Revenue tracking (paid calls only)
        if (ctx.amount && ctx.token) {
          const revKey = `analytics:${ctx.serverId}:${date}:revenue:${ctx.token}`
          redis.set(revKey, '0', 'EX', ttl, 'NX').catch(() => {})
          redis
            .incrby(revKey, ctx.amount)
            .catch(() => {})
        }

        // Unique callers via HyperLogLog
        if (ctx.payer) {
          redis
            .pfadd(`analytics:${ctx.serverId}:callers`, ctx.payer)
            .catch(() => {})
        }

        // Audit trail with 90-day TTL (AC6: 7,776,000 seconds)
        if (ctx.txid) {
          redis
            .set(
              `audit:${ctx.txid}`,
              JSON.stringify({
                serverId: ctx.serverId,
                toolName: ctx.toolName,
                payer: ctx.payer,
                amount: ctx.amount,
                token: ctx.token,
                timestamp: ctx.timestamp,
              }),
              'EX',
              7_776_000,
            )
            .catch(() => {})
        }

        // Rolling 1-hour counters for error rate alerting (Story 3-4, FR56)
        const callKey1h = `analytics:${ctx.serverId}:1h:calls`
        const errKey1h = `analytics:${ctx.serverId}:1h:errors`
        redis.set(callKey1h, '0', 'EX', 3600, 'NX').catch(() => {})
        const callsP = redis.incr(callKey1h).catch(() => 0)

        let errorsP: Promise<number> = Promise.resolve(0)
        if (!ctx.success) {
          redis.set(errKey1h, '0', 'EX', 3600, 'NX').catch(() => {})
          errorsP = redis.incr(errKey1h).catch(() => 0)
        }

        // Error rate alert check (AC1, AC3, AC5 — non-blocking, deduped)
        // Uses INCR return values directly — no extra GET round-trips
        if (this.onAlert) {
          Promise.all([callsP, errorsP])
            .then(async ([calls, errorIncr]) => {
              // On success calls, read the error counter since we didn't INCR it
              const errors = ctx.success
                ? parseInt((await redis.get(errKey1h)) ?? '0', 10)
                : errorIncr
              if (calls < 10 || errors / calls <= 0.10) return // Below threshold or too few samples

              // Dedup: SET NX returns 'OK' only if key didn't exist (max 1 alert/hour)
              const dedup = await redis.set(
                `alert:${ctx.serverId}:error-rate`,
                '1',
                'EX',
                3600,
                'NX',
              )
              if (dedup === 'OK') {
                this.onAlert!({ serverId: ctx.serverId, errorRate: errors / calls })
              }
            })
            .catch(() => {}) // Swallow — alerting must never block
        }
      })

      // Dual-write to PostgreSQL (async, non-blocking — FR44)
      if (this.db) {
        setImmediate(() => {
          this.db!
            .insertAnalyticsEvent({
              serverId: ctx.serverId,
              toolName: ctx.toolName,
              payer: ctx.payer ?? null,
              txid: ctx.txid ?? null,
              amount: ctx.amount ?? null,
              token: ctx.token ?? null,
              success: ctx.success,
              durationMs: ctx.durationMs,
              timestamp: ctx.timestamp,
            })
            .catch(() => {})
        })
      }
    } catch {
      // Swallow errors — hooks must never propagate (AC2)
    }
  }
}
