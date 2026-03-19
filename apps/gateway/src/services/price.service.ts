import type { TokenType } from 'stackai-x402/internal'

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=blockstack,bitcoin&vs_currencies=usd'

interface CoinGeckoResponse {
  blockstack?: { usd: number }
  bitcoin?: { usd: number }
}

/**
 * Fetch live STX and BTC prices from CoinGecko (free tier, no API key).
 * sBTC tracks BTC 1:1. USDCx is always $1.
 * Returns null on any network/parse error.
 */
async function fetchLivePrices(): Promise<{ STX: number; sBTC: number } | null> {
  try {
    const res = await fetch(COINGECKO_URL, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const data = (await res.json()) as CoinGeckoResponse
    const stx = data.blockstack?.usd
    const btc = data.bitcoin?.usd
    if (!stx || !btc || stx <= 0 || btc <= 0) return null
    return { STX: stx, sBTC: btc }
  } catch {
    return null
  }
}

/**
 * Start a background price refresh loop.
 * Mutates `tokenPrices` in-place so the Hono middleware picks up live values
 * on every request without any additional plumbing.
 *
 * @param tokenPrices  - The shared prices object passed to createApp (mutated in-place)
 * @param intervalMs   - How often to refresh (default 5 minutes)
 * @returns            - A stop function to cancel the interval
 */
export function startPriceRefresh(
  tokenPrices: Record<TokenType, number>,
  intervalMs = 5 * 60 * 1_000,
): () => void {
  const refresh = async () => {
    const prices = await fetchLivePrices()
    if (prices) {
      tokenPrices.STX = prices.STX
      tokenPrices.sBTC = prices.sBTC
      console.log(`[price] Updated — STX=$${prices.STX.toFixed(4)} sBTC=$${prices.sBTC.toLocaleString()}`)
    } else {
      console.warn('[price] Failed to fetch live prices, keeping existing values')
    }
  }

  // Fetch immediately on startup, then on interval
  refresh()
  const handle = setInterval(refresh, intervalMs)
  return () => clearInterval(handle)
}
