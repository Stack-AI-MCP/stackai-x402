'use client'

import Link from 'next/link'
import { Wrench, ChevronRight, MessageSquare } from 'lucide-react'
import { MoltbookBadge } from '@/components/moltbook-badge'

interface AgentCardProps {
  agentId: string
  name: string
  description: string
  toolCount: number
  moltbookName?: string
  network: 'mainnet' | 'testnet'
}

/**
 * Card displaying an agent in the agents listing grid.
 * Shows name, description, tool count, Moltbook badge, and action links.
 */
export function AgentCard({ agentId, name, description, toolCount, moltbookName, network }: AgentCardProps) {
  return (
    <div className="group flex flex-col gap-4 rounded-xl border border-border bg-card p-5 card-glow hover:border-primary/40">
      {/* Header: name + badges */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold text-lg tracking-tight text-foreground line-clamp-1">{name}</h3>
          {network === 'testnet' && (
            <span className="shrink-0 text-[9px] font-mono font-bold uppercase tracking-widest text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
              TESTNET
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">{description}</p>
      </div>

      {/* Meta: tool count + moltbook */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          <Wrench className="h-3 w-3" />
          {toolCount} TOOLS
        </span>
        {moltbookName && <MoltbookBadge moltbookName={moltbookName} />}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 mt-auto pt-3 border-t border-border/50">
        <Link
          href={`/chat/${agentId}`}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          CHAT
        </Link>
        <Link
          href={`/agents/${agentId}`}
          className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors ml-auto"
        >
          DETAILS
          <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>
    </div>
  )
}
