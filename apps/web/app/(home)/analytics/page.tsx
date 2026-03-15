'use client'

import { TransactionExplorer } from '@/components/explorer/transaction-explorer'

/**
 * Explorer page — public transaction log for all gateway activity.
 * Replaces the previous per-server analytics dashboard with a
 * unified, paginated, auto-polling transaction explorer.
 */
export default function ExplorerPage() {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Explorer</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Public transaction log for all x402 gateway activity — servers, agents, and payments.
        </p>
      </div>

      {/* Transaction explorer table */}
      <TransactionExplorer />
    </div>
  )
}
