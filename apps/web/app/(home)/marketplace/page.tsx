'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Search } from 'lucide-react'
import { ServerCard, type ServerCardProps } from '@/components/x402/ServerCard'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils/format'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'

interface ServerResponse {
  serverId: string
  name: string
  description: string
  url: string
  acceptedTokens: string[]
  toolPricing: Record<string, { price: number }>
  toolCount: number
  priceRange: { min: number; max: number }
  createdAt: string
  network?: 'mainnet' | 'testnet'
  reputationScore?: number
  featured?: boolean
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Gateway error: ${res.status}`)
  const data = await res.json()
  return data.servers as ServerResponse[]
}

function toCardProps(server: ServerResponse): ServerCardProps {
  return {
    id: server.serverId,
    name: server.name,
    description: server.description,
    url: server.url,
    toolCount: server.toolCount,
    priceRange: server.priceRange,
    acceptedTokens: server.acceptedTokens,
    network: server.network,
    reputationScore: 5.0,
    featured: server.toolCount >= 3,
  }
}

function extractCategories(servers: ServerResponse[]): string[] {
  const tokenSets = new Set<string>()
  servers.forEach((s) => s.acceptedTokens.forEach((t) => tokenSets.add(t)))
  return Array.from(tokenSets).sort()
}

function CardSkeleton() {
  return (
    <div className="rounded-[2px] border border-border/50 p-4 space-y-3">
      <div className="flex items-start justify-between">
        <Skeleton className="h-4 w-32 rounded-[2px]" />
        <Skeleton className="h-3 w-16 rounded-[2px]" />
      </div>
      <Skeleton className="h-3 w-full rounded-[2px]" />
      <Skeleton className="h-3 w-3/4 rounded-[2px]" />
      <div className="flex items-center gap-2 pt-1">
        <Skeleton className="h-5 w-16 rounded-[2px]" />
        <Skeleton className="h-5 w-10 rounded-[2px]" />
      </div>
      <div className="border-t border-border/50 pt-3 flex gap-2">
        <Skeleton className="h-6 flex-1 rounded-[2px]" />
        <Skeleton className="h-6 flex-1 rounded-[2px]" />
      </div>
    </div>
  )
}

export default function MarketplacePage() {
  const { data: servers, error, isLoading } = useSWR(
    `${GATEWAY_URL}/api/v1/servers`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  )

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)

  const categories = useMemo(() => (servers ? extractCategories(servers) : []), [servers])

  const filtered = useMemo(() => {
    if (!servers) return []
    const q = search.toLowerCase()
    return servers
      .filter((s) => {
        if (q && !s.name.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) {
          return false
        }
        if (categoryFilter && !s.acceptedTokens.includes(categoryFilter)) {
          return false
        }
        return true
      })
      .map(toCardProps)
  }, [servers, search, categoryFilter])

  const featured = filtered.filter((s) => s.featured)
  const rest = filtered.filter((s) => !s.featured)

  return (
    <div className="space-y-10 animate-in fade-in duration-700">
      {/* Header — Cronos402 style: no rounded corners, clean */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-host text-2xl font-bold tracking-tight">All Servers</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Discover monetized MCP endpoints on the Stacks x402 gateway.
            </p>
          </div>
          {/* Minimal filter — Cronos402 style: transparent bg, no border */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 pr-3 text-xs font-mono border border-border bg-transparent focus:outline-none focus:border-primary/40 transition-colors w-40"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Category filter pills — Cronos402: transparent bg, minimal */}
      {categories.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <button
            type="button"
            onClick={() => setCategoryFilter(null)}
            className={cn(
              "whitespace-nowrap px-3 py-1 text-[10px] font-mono font-bold uppercase tracking-wider rounded-[2px] transition-all",
              categoryFilter === null
                ? "bg-foreground text-background"
                : "bg-transparent text-muted-foreground border border-border hover:border-foreground/40 hover:text-foreground"
            )}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat === categoryFilter ? null : cat)}
              className={cn(
                "whitespace-nowrap px-3 py-1 text-[10px] font-mono font-bold uppercase tracking-wider rounded-[2px] transition-all",
                categoryFilter === cat
                  ? "bg-foreground text-background"
                  : "bg-transparent text-muted-foreground border border-border hover:border-foreground/40 hover:text-foreground"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="border border-destructive/20 bg-destructive/5 p-6 text-center text-sm font-mono text-destructive">
          Failed to load endpoints. Gateway may be unavailable.
        </div>
      )}

      {isLoading && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <div className="py-20 text-center text-sm font-mono text-muted-foreground border border-dashed border-border">
          {search || categoryFilter
            ? 'NO ENDPOINTS MATCH YOUR FILTERS.'
            : 'NO ENDPOINTS REGISTERED YET.'}
        </div>
      )}

      {featured.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight">Featured Endpoints</h2>
            <div className="h-px flex-1 bg-border/50" />
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((server) => (
              <ServerCard key={server.id} {...server} />
            ))}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section className="space-y-6">
          {featured.length > 0 && (
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight">All Endpoints</h2>
              <div className="h-px flex-1 bg-border/50" />
            </div>
          )}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((server) => (
              <ServerCard key={server.id} {...server} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
