import { NextResponse } from 'next/server'

export interface TokenPrices {
  STX: number   // USD per 1 STX
  BTC: number   // USD per 1 BTC
  USDC: number  // always 1
  updatedAt: string
  cached?: boolean
  stale?: boolean
}

interface PriceCacheEntry {
  STX: number
  BTC: number
  updatedAt: number
}

// Module-level in-memory cache (survives hot-reload in dev via singleton pattern)
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

declare global {
  // eslint-disable-next-line no-var
  var __priceCache: PriceCacheEntry | null
}
globalThis.__priceCache ??= null

async function fetchFromCoinGecko(): Promise<{ STX: number; BTC: number }> {
  const url =
    'https://api.coingecko.com/api/v3/simple/price?ids=blockstack,bitcoin&vs_currencies=usd'
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  })

  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`)

  const data = (await res.json()) as {
    blockstack?: { usd?: number }
    bitcoin?: { usd?: number }
  }

  const STX = data.blockstack?.usd
  const BTC = data.bitcoin?.usd
  if (!STX || !BTC) throw new Error('CoinGecko returned incomplete price data')

  return { STX, BTC }
}

export async function GET() {
  const now = Date.now()
  const cached = globalThis.__priceCache

  // Return fresh cache if within TTL
  if (cached && now - cached.updatedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      STX: cached.STX,
      BTC: cached.BTC,
      USDC: 1,
      updatedAt: new Date(cached.updatedAt).toISOString(),
      cached: true,
    } satisfies TokenPrices)
  }

  try {
    const prices = await fetchFromCoinGecko()
    globalThis.__priceCache = { ...prices, updatedAt: now }

    return NextResponse.json({
      STX: prices.STX,
      BTC: prices.BTC,
      USDC: 1,
      updatedAt: new Date(now).toISOString(),
      cached: false,
    } satisfies TokenPrices)
  } catch {
    // Serve stale cache on error rather than failing the user
    if (cached) {
      return NextResponse.json({
        STX: cached.STX,
        BTC: cached.BTC,
        USDC: 1,
        updatedAt: new Date(cached.updatedAt).toISOString(),
        cached: true,
        stale: true,
      } satisfies TokenPrices)
    }

    return NextResponse.json(
      { error: 'Price service temporarily unavailable', STX: null, BTC: null },
      { status: 503 },
    )
  }
}
