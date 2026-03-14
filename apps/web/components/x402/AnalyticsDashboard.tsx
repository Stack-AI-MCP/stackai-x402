'use client'

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { TokenBadge } from './TokenBadge'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnalyticsData {
  totalCalls: number
  uniqueCallers: number
  revenue: Record<string, string>
  daily: Array<{
    date: string
    calls: number
    revenue: Record<string, string>
  }>
}

const TOKEN_DECIMALS: Record<string, number> = {
  STX: 6,
  sBTC: 8,
  USDCx: 6,
}

const TOKEN_COLORS: Record<string, string> = {
  STX: '#8b5cf6',  // violet-500 — matches TokenBadge STX color
  sBTC: '#f97316', // orange-500 — matches TokenBadge sBTC color
  USDCx: '#3b82f6', // blue-500 — matches TokenBadge USDCx color
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function microToHuman(micro: string, decimals: number): number {
  return Number(micro) / Math.pow(10, decimals)
}

function formatMicro(micro: string, token: string): string {
  if (!micro || !/^\d+$/.test(micro)) return '0'
  const decimals = TOKEN_DECIMALS[token] ?? 6
  // Use BigInt arithmetic for the integer part to avoid float precision loss on large amounts
  const microBig = BigInt(micro)
  const factor = BigInt(10 ** decimals)
  const whole = microBig / factor
  const frac = microBig % factor
  if (whole === 0n && frac === 0n) return '0'
  const wholeNum = Number(whole)
  const wholeStr =
    wholeNum >= 1000 ? wholeNum.toLocaleString(undefined, { maximumFractionDigits: 0 }) : whole.toString()
  if (frac === 0n) return wholeStr
  // Format fractional part as string — no float conversion
  const fracFull = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  const maxFracDigits = whole === 0n ? decimals : 4
  return `${wholeStr}.${fracFull.slice(0, maxFracDigits)}`
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AnalyticsDashboard({ data }: { data: AnalyticsData }) {
  // Prepare chart data
  const chartData = data.daily.map((d) => ({
    date: formatShortDate(d.date),
    calls: d.calls,
    STX: microToHuman(d.revenue.STX ?? '0', TOKEN_DECIMALS.STX),
    sBTC: microToHuman(d.revenue.sBTC ?? '0', TOKEN_DECIMALS.sBTC),
    USDCx: microToHuman(d.revenue.USDCx ?? '0', TOKEN_DECIMALS.USDCx),
  }))

  return (
    <div className="space-y-6">
      {/* ── Summary Cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Total Calls" value={data.totalCalls.toLocaleString()} />
        <SummaryCard label="Unique Callers" value={data.uniqueCallers.toLocaleString()} />
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs font-medium text-muted-foreground">Revenue</p>
          <div className="mt-2 space-y-1">
            {Object.entries(data.revenue).map(([token, micro]) => (
              <div key={token} className="flex items-center justify-between">
                <TokenBadge token={token} />
                <span className="text-sm font-semibold tabular-nums">
                  {formatMicro(micro, token)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Daily Calls Chart ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-border p-4">
        <h3 className="mb-4 text-sm font-semibold">Daily Calls (30 days)</h3>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--color-popover, #1a1a2e)',
                border: '1px solid var(--color-border, #333)',
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Area
              type="monotone"
              dataKey="calls"
              stroke="#8b5cf6"
              fill="#8b5cf6"
              fillOpacity={0.15}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Daily Revenue Chart ───────────────────────────────────────── */}
      <div className="rounded-lg border border-border p-4">
        <h3 className="mb-4 text-sm font-semibold">Daily Revenue by Token (30 days)</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--color-popover, #1a1a2e)',
                border: '1px solid var(--color-border, #333)',
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            {Object.entries(TOKEN_COLORS).map(([token, color], idx, arr) => (
              <Bar
                key={token}
                dataKey={token}
                fill={color}
                stackId="revenue"
                // Only round the top of the topmost bar to avoid visual artifacts on stacked bars
                radius={idx === arr.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  )
}
