import type { Hook, RequestContext } from './hook.interface.js'

/**
 * Structured console logging hook.
 *
 * Logs a single line per tool call with timing, outcome, and payer info.
 * NEVER logs raw `payment-signature` values (NFR6).
 */
export class LoggingHook implements Hook {
  async onRequest(ctx: RequestContext): Promise<void> {
    try {
      const status = ctx.success ? 'OK' : 'FAIL'
      const payer = ctx.payer ?? 'anonymous'
      console.log(
        `[${ctx.timestamp}] ${ctx.toolName} by ${payer} — ${status} ${ctx.durationMs}ms`,
      )
    } catch {
      // Swallow errors — hooks must never propagate (AC2)
    }
  }
}
