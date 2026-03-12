import { Hono } from 'hono'

import type { AppEnv } from '../app.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate YYYY-MM-DD strings for the last `n` days ending today. */
function lastNDays(n: number): string[] {
  const days: string[] = []
  const now = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days.reverse() // oldest first
}

const TOKENS = ['STX', 'sBTC', 'USDCx'] as const

// ─── Router ───────────────────────────────────────────────────────────────────

export const analyticsRouter = new Hono<AppEnv>()

analyticsRouter.get('/:serverId/analytics', async (c) => {
  const serverId = c.req.param('serverId')

  if (!UUID_RE.test(serverId)) {
    return c.json({ error: 'Invalid server ID format', code: 'INVALID_REQUEST' }, 400)
  }

  const redis = c.get('redis')

  // ── Read analytics from Redis ─────────────────────────────────────────────
  const days = lastNDays(30)

  // Batch-read call counts for all 30 days
  const callKeys = days.map((d) => `analytics:${serverId}:${d}:calls`)
  const callValues = await redis.mget(...callKeys)

  // Batch-read revenue per token per day
  const revenueKeys: string[] = []
  for (const day of days) {
    for (const token of TOKENS) {
      revenueKeys.push(`analytics:${serverId}:${day}:revenue:${token}`)
    }
  }
  const revenueValues = await redis.mget(...revenueKeys)

  // Unique callers (HyperLogLog)
  const uniqueCallers = await redis.pfcount(`analytics:${serverId}:callers`)

  // ── Aggregate ─────────────────────────────────────────────────────────────
  let totalCalls = 0
  const totalRevenue: Record<string, bigint> = { STX: 0n, sBTC: 0n, USDCx: 0n }

  const daily: Array<{
    date: string
    calls: number
    revenue: Record<string, string>
  }> = []

  for (let i = 0; i < days.length; i++) {
    const calls = callValues[i] ? parseInt(callValues[i]!, 10) : 0
    totalCalls += calls

    const dayRevenue: Record<string, string> = {}
    for (let t = 0; t < TOKENS.length; t++) {
      const val = revenueValues[i * TOKENS.length + t]
      const amount = val ? BigInt(val) : 0n
      dayRevenue[TOKENS[t]] = amount.toString()
      totalRevenue[TOKENS[t]] += amount
    }

    daily.push({ date: days[i], calls, revenue: dayRevenue })
  }

  return c.json({
    totalCalls,
    uniqueCallers,
    revenue: {
      STX: totalRevenue.STX.toString(),
      sBTC: totalRevenue.sBTC.toString(),
      USDCx: totalRevenue.USDCx.toString(),
    },
    daily,
  })
})
