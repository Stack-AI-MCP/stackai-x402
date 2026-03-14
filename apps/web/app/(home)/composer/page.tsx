'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Loader2 } from 'lucide-react'
import { AgentComposer } from '@/components/x402/AgentComposer'
import { ServerFavicon } from '@/components/x402/ServerFavicon'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'

interface ServerEntry {
  serverId: string
  name: string
  description: string
  url: string
  toolCount: number
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Gateway error: ${res.status}`)
  const data = await res.json()
  return data.servers as ServerEntry[]
}

export default function ComposerPage() {
  const [selectedServer, setSelectedServer] = useState<ServerEntry | null>(null)
  const { data: servers, isLoading, error } = useSWR(
    `${GATEWAY_URL}/api/v1/servers`,
    fetcher,
    { revalidateOnFocus: false },
  )

  return (
    <div className="mx-auto max-w-2xl space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <h1 className="font-host text-2xl font-bold tracking-tight">Composer</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Build a custom agent by selecting tools and writing a system prompt.
        </p>
      </div>

      {/* Server selector */}
      <div className="space-y-3">
        <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          Select Server
        </label>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="font-mono text-xs">Loading servers...</span>
          </div>
        )}

        {error && (
          <div className="rounded-[2px] border border-destructive/30 bg-destructive/5 p-4 text-xs font-mono text-destructive">
            Failed to load servers. Gateway may be unavailable.
          </div>
        )}

        {!isLoading && servers && servers.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No servers registered yet.{' '}
            <a href="/register" className="underline decoration-dotted underline-offset-2 hover:text-foreground transition-colors">
              Register one
            </a>{' '}
            to get started.
          </p>
        )}

        {servers && servers.length > 0 && !selectedServer && (
          <div className="grid gap-2">
            {servers.map((server) => (
              <button
                key={server.serverId}
                type="button"
                onClick={() => setSelectedServer(server)}
                className="flex items-start gap-3 rounded-[2px] border border-border bg-card p-4 text-left transition-colors hover:border-foreground/40 hover:bg-muted/30"
              >
                <ServerFavicon url={server.url} name={server.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium font-mono">{server.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {server.description || 'No description'} &middot;{' '}
                    {server.toolCount} tool{server.toolCount !== 1 ? 's' : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {selectedServer && (
          <div className="flex items-center justify-between rounded-[2px] border border-border bg-card p-3">
            <div className="flex items-center gap-2.5">
              <ServerFavicon url={selectedServer.url} name={selectedServer.name} size="sm" />
              <span className="text-sm font-mono font-medium">{selectedServer.name}</span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedServer(null)}
              className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              CHANGE
            </button>
          </div>
        )}
      </div>

      {/* Agent Composer form */}
      {selectedServer && (
        <AgentComposer
          serverId={selectedServer.serverId}
          serverName={selectedServer.name}
        />
      )}
    </div>
  )
}
