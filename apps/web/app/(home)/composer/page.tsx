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
  const {
    data: servers,
    isLoading,
    error,
  } = useSWR(`${GATEWAY_URL}/api/v1/servers`, fetcher, {
    revalidateOnFocus: false,
  })

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Composer</h1>
        <p className="text-sm text-muted-foreground">
          Build a custom agent by selecting tools and writing a system prompt
        </p>
      </div>

      {/* Server selector */}
      <div>
        <label className="block text-sm font-medium">Server</label>

        {isLoading && (
          <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading servers...
          </div>
        )}

        {error && (
          <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            Failed to load servers. Gateway may be unavailable.
          </div>
        )}

        {!isLoading && servers && servers.length === 0 && (
          <div className="mt-2 text-sm text-muted-foreground">
            No servers registered yet. Register one in the Register tab.
          </div>
        )}

        {servers && servers.length > 0 && !selectedServer && (
          <div className="mt-2 grid gap-2">
            {servers.map((server) => (
              <button
                key={server.serverId}
                type="button"
                onClick={() => setSelectedServer(server)}
                className="flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <ServerFavicon url={server.url} name={server.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{server.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {server.description || 'No description'} &middot;{' '}
                    {server.toolCount} tool
                    {server.toolCount !== 1 ? 's' : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {selectedServer && (
          <div className="mt-2 flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center gap-2">
              <ServerFavicon url={selectedServer.url} name={selectedServer.name} size="sm" />
              <span className="text-sm font-medium">{selectedServer.name}</span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedServer(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Change
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
