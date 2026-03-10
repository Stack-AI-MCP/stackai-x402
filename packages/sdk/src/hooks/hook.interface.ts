/**
 * Hook system for async, non-blocking request observation.
 *
 * Hooks are observers — they receive RequestContext after a tool call
 * completes but cannot modify the response. Errors in hooks are silently
 * swallowed and never propagate to the caller.
 */

export interface RequestContext {
  serverId: string
  toolName: string
  /** Stacks address of the payer (undefined for free tools) */
  payer?: string
  /** On-chain transaction ID (undefined for free tools) */
  txid?: string
  /** Payment amount in micro-units (undefined for free tools) */
  amount?: string
  /** Token used for payment: 'STX' | 'sBTC' | 'USDCx' (undefined for free tools) */
  token?: string
  /** Whether the tool call succeeded */
  success: boolean
  /** Request duration in milliseconds */
  durationMs: number
  /** ISO 8601 timestamp when the request started */
  timestamp: string
}

export interface Hook {
  onRequest(ctx: RequestContext): Promise<void>
}
