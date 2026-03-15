'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Copy, Check, ExternalLink, MessageSquare } from 'lucide-react'
import { MoltbookBadge } from '@/components/moltbook-badge'

export interface TransactionRecord {
  id: string
  status: 'settled' | 'free' | 'failed'
  serverId: string
  serverName: string
  agentId?: string
  agentName?: string
  moltbookName?: string
  toolName: string
  /** Amount as string from gateway (micro-units). */
  amount: string
  token: string
  network: 'mainnet' | 'testnet'
  payer: string
  txHash?: string
  timestamp: string
}

/* Status indicator dot */
function StatusDot({ status }: { status: TransactionRecord['status'] }) {
  const colors = {
    settled: 'bg-green-500',
    free: 'bg-gray-400',
    failed: 'bg-red-500',
  }
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${colors[status]}`} />
  )
}

/* Copy-to-clipboard button */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

/* Relative time from ISO string */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

/* Truncate hash for display */
function truncateHash(hash: string, chars = 6): string {
  if (hash.length <= chars * 2 + 2) return hash
  return `${hash.slice(0, chars + 2)}...${hash.slice(-chars)}`
}

/* Explorer URL for the transaction hash */
function explorerUrl(txHash: string, network: 'mainnet' | 'testnet'): string {
  const base = network === 'mainnet'
    ? 'https://explorer.hiro.so/txid'
    : 'https://explorer.hiro.so/txid'
  const suffix = network === 'testnet' ? '?chain=testnet' : ''
  return `${base}/${txHash}${suffix}`
}

interface ExplorerRowProps {
  tx: TransactionRecord
}

/**
 * Single row in the transaction explorer table.
 * Shows status, server/agent, method, amount, network, time, tx hash.
 * Includes Moltbook badge and chat link when applicable.
 */
export function ExplorerRow({ tx }: ExplorerRowProps) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors text-sm">
      {/* Status */}
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <StatusDot status={tx.status} />
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            {tx.status}
          </span>
        </div>
      </td>

      {/* Server / Agent */}
      <td className="py-3 px-4">
        <div className="space-y-1">
          <span className="font-medium text-foreground">{tx.agentName ?? tx.serverName}</span>
          {tx.moltbookName && (
            <div>
              <MoltbookBadge moltbookName={tx.moltbookName} />
            </div>
          )}
        </div>
      </td>

      {/* Method / Tool */}
      <td className="py-3 px-4">
        <code className="text-xs font-mono text-primary">{tx.toolName}</code>
      </td>

      {/* Amount */}
      <td className="py-3 px-4 text-right">
        {tx.status === 'free' || tx.amount === '0' || !tx.amount ? (
          <span className="text-xs text-muted-foreground font-mono">Free</span>
        ) : (
          <span className="text-xs font-mono text-green-600">
            {tx.amount} {tx.token}
          </span>
        )}
      </td>

      {/* Network */}
      <td className="py-3 px-4">
        <span className={`text-[9px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full ${
          tx.network === 'testnet'
            ? 'text-amber-600 bg-amber-500/10'
            : 'text-green-600 bg-green-500/10'
        }`}>
          {tx.network}
        </span>
      </td>

      {/* Time */}
      <td className="py-3 px-4 text-xs text-muted-foreground font-mono">
        {relativeTime(tx.timestamp)}
      </td>

      {/* Tx Hash + Actions */}
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          {tx.txHash ? (
            <>
              <code className="text-[11px] font-mono text-muted-foreground">
                {truncateHash(tx.txHash)}
              </code>
              <CopyButton text={tx.txHash} />
              <a
                href={explorerUrl(tx.txHash, tx.network)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="View on explorer"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground/50 font-mono">—</span>
          )}

          {/* Chat link for agent transactions */}
          {tx.agentId && (
            <Link
              href={`/chat/${tx.agentId}`}
              className="ml-1 text-muted-foreground hover:text-primary transition-colors"
              aria-label="Open chat"
            >
              <MessageSquare className="h-3 w-3" />
            </Link>
          )}
        </div>
      </td>
    </tr>
  )
}
