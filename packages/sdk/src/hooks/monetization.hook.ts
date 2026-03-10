import type { Hook, RequestContext } from './hook.interface.js'

/**
 * x402 monetization context extraction hook.
 *
 * Extracts payment context from the request (token, amount, payer) for
 * downstream hooks in the chain. Currently a pass-through observer that
 * logs paid calls for audit visibility.
 */
export class X402MonetizationHook implements Hook {
  async onRequest(ctx: RequestContext): Promise<void> {
    try {
      if (ctx.txid && ctx.amount && ctx.token) {
        console.log(
          `[x402] Payment: ${ctx.amount} ${ctx.token} from ${ctx.payer ?? 'unknown'} tx:${ctx.txid}`,
        )
      }
    } catch {
      // Swallow errors — hooks must never propagate (AC2)
    }
  }
}
