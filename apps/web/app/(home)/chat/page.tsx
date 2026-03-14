'use client'

import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { Loader2 } from 'lucide-react'
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

export default function ChatLandingPage() {
  const router = useRouter()
  const { data: servers, isLoading, error } = useSWR(
    `${GATEWAY_URL}/api/v1/servers`,
    fetcher,
    { revalidateOnFocus: false },
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Chat</h1>
        <p className="text-sm text-muted-foreground">
          Select an MCP server to start a chat session with its tools
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center text-sm text-destructive">
          Failed to load servers. Gateway may be unavailable.
        </div>
      )}

      {!isLoading && servers && servers.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No servers registered yet. Register one in the Register tab.
        </div>
      )}

      {servers && servers.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((server) => (
            <button
              key={server.serverId}
              type="button"
              onClick={() => router.push(`/chat/${server.serverId}`)}
              className="flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <ServerFavicon url={server.url} name={server.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{server.name}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {server.description || 'No description'}
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">
                  {server.toolCount} tool{server.toolCount !== 1 ? 's' : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
