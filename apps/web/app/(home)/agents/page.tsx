'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Plus, Bot } from 'lucide-react'
import { toast } from 'sonner'
import { AgentCard } from '@/components/agents/agent-card'
import { CreateAgentWizard, type AgentCreatedInfo } from '@/components/create-agent/create-agent-wizard'
import { Skeleton } from '@/components/ui/skeleton'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'

interface AgentListItem {
  agentId: string
  name: string
  description: string
  tools: Array<{ toolName: string }>
  moltbookName?: string
  moltbook?: {
    moltbookStatus?: string
    claimUrl?: string
    verificationCode?: string
  }
  network: 'mainnet' | 'testnet'
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Gateway error: ${res.status}`)
  const data = await res.json()
  return data as { agents: AgentListItem[]; pagination: { total: number } }
}

export default function AgentsPage() {
  const [wizardOpen, setWizardOpen] = useState(false)

  const { data, error, isLoading, mutate } = useSWR(
    `${GATEWAY_URL}/api/v1/agents?limit=50`,
    fetcher,
    { revalidateOnFocus: false },
  )

  const handleCreated = (info: AgentCreatedInfo) => {
    mutate() // Refresh list

    if (info.hasMoltbook) {
      toast.success('Agent created — Moltbook registration in progress', {
        description: `@${info.moltbookName} is being registered on Moltbook. You'll need to verify via Twitter once the claim URL is ready.`,
        duration: 8000,
      })
    } else {
      toast.success('Agent created successfully', {
        description: 'Your agent is ready to use. Open it from the chat link on its card.',
        duration: 5000,
      })
    }
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create autonomous Moltbook agents that promote your tools 24/7 with AI-generated posts.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="h-10 px-5 text-[10px] font-mono font-bold uppercase tracking-widest bg-foreground text-background rounded-[2px] hover:bg-foreground/90 transition-colors flex items-center gap-2"
        >
          <Plus className="h-3.5 w-3.5" />
          CREATE AGENT
        </button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-[2px]" />
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-[2px] border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error.message}
        </div>
      )}

      {/* Agent grid */}
      {data && data.agents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.agents.map((agent) => (
            <AgentCard
              key={agent.agentId}
              agentId={agent.agentId}
              name={agent.name}
              description={agent.description}
              toolCount={agent.tools.length}
              moltbookName={agent.moltbookName}
              network={agent.network}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {data && data.agents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed border-border rounded-[2px]">
          <Bot className="h-10 w-10 text-muted-foreground/30 mb-4" />
          <p className="text-sm font-medium text-muted-foreground">No agents created yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Launch a Moltbook agent to autonomously promote your server's tools
          </p>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="mt-4 h-9 px-4 text-[10px] font-mono font-bold uppercase tracking-widest border border-border text-muted-foreground hover:border-foreground hover:text-foreground rounded-[2px] transition-colors"
          >
            CREATE YOUR FIRST AGENT
          </button>
        </div>
      )}

      {/* Create agent wizard modal */}
      <CreateAgentWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={handleCreated}
      />
    </div>
  )
}
