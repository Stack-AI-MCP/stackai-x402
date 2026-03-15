'use client'

import { useState, useEffect, useCallback } from 'react'
import useSWR from 'swr'
import { RefreshCw, ArrowLeft, ArrowRight, Activity } from 'lucide-react'
import { ExplorerRow, type TransactionRecord } from './explorer-row'
import { Skeleton } from '@/components/ui/skeleton'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'
const PAGE_SIZE = 24
const POLL_INTERVAL = 10_000

interface TransactionListResponse {
  transactions: TransactionRecord[]
  pagination: {
    total: number
    page: number
    limit: number
    pages: number
  }
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Gateway error: ${res.status}`)
  return (await res.json()) as TransactionListResponse
}

/**
 * Transaction explorer table with pagination and auto-polling.
 * Inspired by Cronos402 client-explorer-page.tsx.
 * Displays all settled, free, and failed transactions across
 * servers and agents, with Moltbook badges and chat links.
 */
export function TransactionExplorer() {
  const [page, setPage] = useState(1)

  /* Build query URL with page and limit — analytics router is mounted at /api/v1/servers */
  const queryUrl = `${GATEWAY_URL}/api/v1/servers/transactions?page=${page}&limit=${PAGE_SIZE}`

  const { data, error, isLoading, mutate } = useSWR(queryUrl, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: POLL_INTERVAL,
  })

  /* Reset to page 1 on mount */
  useEffect(() => { setPage(1) }, [])

  const totalPages = data?.pagination.pages ?? 1
  const total = data?.pagination.total ?? 0

  const goNext = useCallback(() => {
    if (page < totalPages) setPage(p => p + 1)
  }, [page, totalPages])

  const goPrev = useCallback(() => {
    if (page > 1) setPage(p => p - 1)
  }, [page])

  return (
    <div className="space-y-6">
      {/* Header with refresh and pagination info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-muted-foreground">
            {total.toLocaleString()} transactions
          </span>
          <button
            type="button"
            onClick={() => mutate()}
            className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            REFRESH
          </button>
        </div>

        {/* Pagination controls */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={goPrev}
              disabled={page <= 1}
              className="h-7 w-7 flex items-center justify-center rounded-[2px] border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Previous page"
            >
              <ArrowLeft className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={page >= totalPages}
              className="h-7 w-7 flex items-center justify-center rounded-[2px] border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Next page"
            >
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-[2px]" />
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-[2px] border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error.message}
        </div>
      )}

      {/* Transaction table */}
      {data && data.transactions.length > 0 && (
        <div className="overflow-x-auto rounded-[2px] border border-border">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="py-2.5 px-4 text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">Status</th>
                <th className="py-2.5 px-4 text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">Server / Agent</th>
                <th className="py-2.5 px-4 text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">Method</th>
                <th className="py-2.5 px-4 text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground text-right">Amount</th>
                <th className="py-2.5 px-4 text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">Network</th>
                <th className="py-2.5 px-4 text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">Time</th>
                <th className="py-2.5 px-4 text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((tx) => (
                <ExplorerRow key={tx.id} tx={tx} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {data && data.transactions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-border rounded-[2px]">
          <Activity className="h-10 w-10 text-muted-foreground/30 mb-4" />
          <p className="text-sm font-medium text-muted-foreground">No transactions yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Transactions will appear here when tools are called through the gateway
          </p>
        </div>
      )}

      {/* Bottom pagination (for long tables) */}
      {data && data.transactions.length > 12 && (
        <div className="flex justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={goPrev}
            disabled={page <= 1}
            className="h-8 px-4 text-[10px] font-mono font-bold uppercase tracking-widest border border-border text-muted-foreground hover:text-foreground hover:border-foreground rounded-[2px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={page >= totalPages}
            className="h-8 px-4 text-[10px] font-mono font-bold uppercase tracking-widest border border-border text-muted-foreground hover:text-foreground hover:border-foreground rounded-[2px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
