import type { TokenType } from './token-registry.js'
import { TOKEN_REGISTRY } from './token-registry.js'

// Scale factor for converting float inputs to integers before bigint arithmetic.
// 6 decimal places handles USD amounts and prices down to $0.000001.
const INPUT_SCALE = 1_000_000n
const INPUT_SCALE_NUM = 1_000_000

/**
 * Converts a USD cost to token micro-units using integer bigint arithmetic.
 * All intermediate arithmetic is performed in bigint space to avoid IEEE-754
 * precision errors. The only float operations are the two input scalings.
 *
 * @param usdAmount  - The cost in USD (e.g. 0.01 for one cent). Must be finite and >= 0.
 * @param tokenType  - Which token to price in
 * @param priceUSD   - Current market price of 1 full token in USD. Must be > 0.
 * @returns          - Amount in the token's smallest unit (bigint), rounded to nearest
 */
export function usdToMicro(
  usdAmount: number,
  tokenType: TokenType,
  priceUSD: number,
): bigint {
  if (!Number.isFinite(usdAmount) || usdAmount < 0) {
    throw new Error(`usdAmount must be a non-negative finite number, got ${usdAmount}`)
  }
  if (!Number.isFinite(priceUSD) || priceUSD <= 0) {
    throw new Error(`priceUSD must be a positive finite number, got ${priceUSD}`)
  }

  const { decimals } = TOKEN_REGISTRY[tokenType]

  // Convert float inputs to scaled integers before any division
  const usdScaled = BigInt(Math.round(usdAmount * INPUT_SCALE_NUM))
  const priceScaled = BigInt(Math.round(priceUSD * INPUT_SCALE_NUM))
  const decimalsScale = 10n ** BigInt(decimals)

  // microAmount = (usdAmount / priceUSD) * 10^decimals
  // In integer space: (usdScaled * decimalsScale) / priceScaled
  // Add priceScaled/2 before division for round-half-up behaviour
  return (usdScaled * decimalsScale + priceScaled / 2n) / priceScaled
}
