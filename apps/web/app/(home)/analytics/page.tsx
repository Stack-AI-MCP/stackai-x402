'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { BarChart3, TrendingUp, Users, Zap, RefreshCw } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { AnalyticsDashboard, type AnalyticsData } from '@/components/x402/AnalyticsDashboard'
import { cn } from '@/lib/utils/format'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'

interface ServerListItem {
  serverId: string
  name: string
  url: string
  toolCount: number
}

const serversFetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Gateway error: ${res.status}`)
  const data = await res.json()
  return (data.servers ?? []) as ServerListItem[]
}

const analyticsFetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Gateway error: ${res.status}`)
  return (await res.json()) as AnalyticsData
}

function StatCard({ label, value, icon: Icon, sub }: {
  label: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
  sub?: string
}) {
  return (
    <div className="rounded-[2px] border border-border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <Icon className="h-4 w-4 text-muted-foreground/50" />
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight font-mono">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

export default function AnalyticsPage() {
  const [serverId, setServerId] = useState('')

  const { data: servers, isLoading: serversLoading } = useSWR(
    `${GATEWAY_URL}/api/v1/servers`,
    serversFetcher,
    { revalidateOnFocus: false },
  )

  const { data: analytics, error, isLoading: analyticsLoading, mutate } = useSWR(
    serverId ? `${GATEWAY_URL}/api/v1/servers/${serverId}/analytics` : null,
    analyticsFetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  )

  const selectedServer = servers?.find((s) => s.serverId === serverId)

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Public usage stats for all registered MCP servers.
          </p>
        </div>
        {serverId && (
          <button
            type="button"
            onClick={() => mutate()}
            className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            REFRESH
          </button>
        )}
      </div>

      {/* Server selector */}
      <div className="space-y-2">
        <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          Select Server
        </label>
        {serversLoading ? (
          <Skeleton className="h-11 w-full max-w-sm" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {servers?.map((s) => (
              <button
                key={s.serverId}
                type="button"
                onClick={() => setServerId(s.serverId)}
                className={cn(
                  'h-9 px-4 text-[11px] font-mono font-bold uppercase tracking-widest border transition-colors rounded-[2px]',
                  serverId === s.serverId
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground',
                )}
              >
                {s.name}
              </button>
            ))}
            {!servers?.length && (
              <p className="text-sm text-muted-foreground">No servers registered yet.</p>
            )}
          </div>
        )}
      </div>

      {/* Loading skeletons */}
      {analyticsLoading && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Skeleton className="h-24 rounded-[2px]" />
            <Skeleton className="h-24 rounded-[2px]" />
            <Skeleton className="h-24 rounded-[2px]" />
          </div>
          <Skeleton className="h-[280px] rounded-[2px]" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-[2px] border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error.message}
        </div>
      )}

      {/* Stats + chart */}
      {analytics && selectedServer && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Total Calls"
              value={analytics.totalCalls.toLocaleString()}
              icon={Zap}
              sub="Last 30 days"
            />
            <StatCard
              label="Unique Callers"
              value={analytics.uniqueCallers.toLocaleString()}
              icon={Users}
              sub="Distinct addresses"
            />
            <StatCard
              label="STX Revenue"
              value={`${(Number(analytics.revenue.STX) / 1_000_000).toFixed(4)}`}
              icon={TrendingUp}
              sub="STX earned (30d)"
            />
          </div>
          <AnalyticsDashboard data={analytics} />
        </div>
      )}

      {/* Empty state */}
      {!serverId && !serversLoading && (
        <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-border rounded-[2px]">
          <BarChart3 className="h-10 w-10 text-muted-foreground/30 mb-4" />
          <p className="text-sm font-medium text-muted-foreground">Select a server above to view analytics</p>
          <p className="text-xs text-muted-foreground/60 mt-1">No authentication required</p>
        </div>
      )}
    </div>
  )
}
