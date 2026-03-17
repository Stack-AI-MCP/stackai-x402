'use client'

import { useRouter } from 'next/navigation'
import { Wrench } from 'lucide-react'
import { MoltbookBadge } from '@/components/moltbook-badge'

interface AgentCardProps {
  agentId: string
  name: string
  description: string
  toolCount: number
  moltbookName?: string
  network?: 'mainnet' | 'testnet'
}

/**
 * Card displaying an agent in the agents listing grid.
 * Entire card is clickable → /agents/{agentId}.
 * Moltbook badge is independently clickable → moltbook.com (stops propagation).
 */
export function AgentCard({ agentId, name, description, toolCount, moltbookName, network }: AgentCardProps) {
  const router = useRouter()

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/agents/${agentId}`)}
      onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/agents/${agentId}`) }}
      className="group flex flex-col gap-4 rounded-xl border border-border bg-card p-5 card-glow hover:border-primary/40 transition-colors cursor-pointer"
    >
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
        {moltbookName && (
          <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <MoltbookBadge moltbookName={moltbookName} />
          </span>
        )}
      </div>

      {/* Footer: MANAGE indicator */}
      <div className="flex items-center mt-auto pt-3 border-t border-border/50">
        <span className="text-xs font-bold text-primary group-hover:underline ml-auto">
          MANAGE &rarr;
        </span>
      </div>
    </div>
  )
}
