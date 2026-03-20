'use client'

import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import useSWR from 'swr'
import { 
  Wrench, 
  MessageSquare, 
  Wallet, 
  Activity, 
  ArrowLeft,
  ExternalLink,
  Shield,
  Clock,
  Coins,
  Search,
  Zap,
  ChevronRight
} from 'lucide-react'
import { useMemo, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { HighlighterText } from '@/components/ui/highlighter-text'
import { ServerDetailsCard } from '@/components/x402/ServerDetailsCard'
import { TokenBadge } from '@/components/x402/TokenBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { ToolRunnerModal, type ToolForRunner } from '@/components/x402/ToolRunnerModal'
import { ServerFavicon } from '@/components/x402/ServerFavicon'
import { ConnectPanel } from '@/components/x402/ConnectPanel'
import { MoltbookBadge } from '@/components/moltbook-badge'
import { ExplorerRow, type TransactionRecord } from '@/components/explorer/explorer-row'
import { cn, formatRelative, formatDate } from '@/lib/utils/format'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'


interface Tool {
  name: string
  description: string
  price: number
  acceptedTokens: string[]
  inputSchema?: any
}

interface ServerDetail {
  serverId: string
  name: string
  description: string
  url: string
  recipientAddress: string
  acceptedTokens: string[]
  tools: Tool[]
  createdAt: string
  network?: 'mainnet' | 'testnet'
  telegramChatId?: string
  webhookUrl?: string
  moltbookAgentId?: string
  moltbookName?: string
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Gateway error: ${res.status}`)
  return res.json() as Promise<ServerDetail>
}

export default function ServerDetailsPage() {
  const { serverId } = useParams<{ serverId: string }>()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('tools')
  const [toolSearch, setToolSearch] = useState('')
  const [runnerTool, setRunnerTool] = useState<ToolForRunner | null>(null)

  const { data, error, isLoading, mutate } = useSWR(
    `${GATEWAY_URL}/api/v1/servers/${serverId}`,
    fetcher
  )

  // Payments data — only fetch when payments tab is active
  const paymentsFetcher = useCallback(async (url: string) => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Gateway error: ${res.status}`)
    return res.json() as Promise<{ transactions: TransactionRecord[], pagination: { page: number, total: number, pages: number } }>
  }, [])

  const { data: paymentsData, isLoading: paymentsLoading } = useSWR(
    activeTab === 'payments' ? `${GATEWAY_URL}/api/v1/servers/transactions?serverId=${serverId}&limit=50` : null,
    paymentsFetcher,
    { revalidateOnFocus: false }
  )

  const filteredTools = useMemo(() => {
    if (!data?.tools) return []
    const q = toolSearch.toLowerCase()
    return data.tools.filter(t => 
      t.name.toLowerCase().includes(q) || 
      t.description.toLowerCase().includes(q)
    )
  }, [data?.tools, toolSearch])

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-[400px] w-full rounded-xl" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-[200px] w-full rounded-xl" />
            <Skeleton className="h-[300px] w-full rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="rounded-full bg-destructive/10 p-4 mb-4">
          <Shield className="h-8 w-8 text-destructive" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Server Not Found</h2>
        <p className="text-muted-foreground mb-6">The MCP server you are looking for does not exist or has been removed.</p>
        <button 
          onClick={() => router.push('/marketplace')}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Marketplace
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between border-b border-border/50 pb-8">
        <div className="space-y-4">
          <button 
            onClick={() => router.push('/marketplace')}
            className="group flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-1" />
            Marketplace
          </button>
          
          <div className="flex items-center gap-4">
            <ServerFavicon url={data.url} name={data.name} size="lg" />
            <div className="space-y-1">
              <h1 className="text-4xl font-bold tracking-tight">{data.name}</h1>
              <p className="text-lg text-muted-foreground max-w-2xl">{data.description}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <HighlighterText icon={Activity} variant="green">Active</HighlighterText>
            <HighlighterText icon={Wrench} variant="blue">{data.tools.length} Tools</HighlighterText>
            <HighlighterText icon={Clock} variant="amber">Created {formatRelative(data.createdAt)}</HighlighterText>
            {data.network === 'testnet' ? (
              <HighlighterText variant="amber">TESTNET</HighlighterText>
            ) : (
              <HighlighterText variant="green">MAINNET</HighlighterText>
            )}
            {data.moltbookName && <MoltbookBadge moltbookName={data.moltbookName} size="md" />}
          </div>
        </div>

        <div className="flex gap-3">
          <button 
            onClick={() => router.push(`/chat/${serverId}`)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 hover:scale-[1.02] active:scale-[0.98]"
          >
            <MessageSquare className="h-4 w-4" />
            Open Chat
          </button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Main Content: Tabs */}
        <div className="lg:col-span-2 space-y-6">
          <Tabs defaultValue="tools" value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full justify-start bg-transparent border-b border-border h-auto p-0 gap-8 rounded-none">
              <TabsTrigger 
                value="tools" 
                className="rounded-none border-b-2 border-transparent px-1 py-4 text-sm font-semibold data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground bg-transparent transition-all hover:text-primary/70"
              >
                TOOLS
              </TabsTrigger>
              <TabsTrigger 
                value="payments" 
                className="rounded-none border-b-2 border-transparent px-1 py-4 text-sm font-semibold data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground bg-transparent transition-all hover:text-primary/70"
              >
                PAYMENTS
              </TabsTrigger>
              <TabsTrigger 
                value="connect" 
                className="rounded-none border-b-2 border-transparent px-1 py-4 text-sm font-semibold data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground bg-transparent transition-all hover:text-primary/70"
              >
                CONNECT
              </TabsTrigger>
            </TabsList>

            <TabsContent value="tools" className="pt-6 space-y-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search tools..."
                  value={toolSearch}
                  onChange={(e) => setToolSearch(e.target.value)}
                  className="w-full rounded-xl border border-border bg-card/50 py-2.5 pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>

              <div className="grid gap-4">
                {filteredTools.length > 0 ? (
                  filteredTools.map((tool) => (
                    <div 
                      key={tool.name}
                      className="group flex flex-col gap-4 rounded-xl border border-border bg-card/50 p-5 transition-all hover:border-primary/30 hover:bg-card/80 hover:shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-2">
                            <code className="text-sm font-bold text-primary font-mono">{tool.name}</code>
                            {tool.price > 0 && (
                              <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600 uppercase tracking-tighter">
                                Paid
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{tool.description}</p>
                        </div>
                        
                        <div className="text-right shrink-0">
                          <div className="text-sm font-bold">
                            {tool.price === 0 ? (
                              <span className="text-green-600 font-mono">FREE</span>
                            ) : (
                              <span className="font-mono text-amber-600">
                                {tool.price < 0.001
                                  ? `$${tool.price.toFixed(6)}`
                                  : tool.price < 0.01
                                    ? `$${tool.price.toFixed(4)}`
                                    : `$${tool.price.toFixed(2)}`}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-mono">Price</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-border/50 pt-4">
                        <div className="flex gap-1.5">
                          {data.acceptedTokens.map(token => (
                            <TokenBadge key={token} token={token} />
                          ))}
                        </div>
                        
                        <button
                          onClick={() => setRunnerTool({
                            name: tool.name,
                            description: tool.description,
                            price: tool.price,
                            inputSchema: tool.inputSchema,
                          })}
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline group-hover:translate-x-0.5 transition-transform"
                        >
                          RUN TOOL
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-12 text-center text-sm text-muted-foreground border-2 border-dashed border-border rounded-xl">
                    No tools found matching your search.
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="payments" className="pt-6">
              {paymentsLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-lg" />
                  ))}
                </div>
              ) : paymentsData?.transactions && paymentsData.transactions.length > 0 ? (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-muted/30">
                        <tr className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">Server</th>
                          <th className="py-3 px-4">Tool</th>
                          <th className="py-3 px-4 text-right">Amount</th>
                          <th className="py-3 px-4">Network</th>
                          <th className="py-3 px-4">Time</th>
                          <th className="py-3 px-4">Tx Hash</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paymentsData.transactions.map((tx) => (
                          <ExplorerRow key={tx.id} tx={tx} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-border rounded-xl bg-muted/5">
                  <div className="rounded-full bg-primary/10 p-4 mb-4">
                    <Coins className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">No Payments Yet</h3>
                  <p className="text-sm text-muted-foreground max-w-xs">Transaction history for this server will appear here once you start using paid tools.</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="connect" className="pt-6">
              <ConnectPanel serverId={serverId} serverName={data.name} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          <ServerDetailsCard
            details={{
              deploymentRef: (data.network ?? 'mainnet').toUpperCase(),
              license: 'MIT',
              isLocal: false,
              publishedAt: formatDate(data.createdAt),
              homepage: data.url
            }}
          />

          <div className="rounded-xl border border-border bg-gradient-to-br from-primary/10 to-transparent p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <h3 className="font-bold tracking-tight">Monetization Ready</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This server is registered on the x402 Gateway, enabling secure, per-call payments using Bitcoin (sBTC), Stacks (STX), and USDCx.
            </p>
            <div className="pt-2">
              <a 
                href="https://x402.org" 
                target="_blank" 
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
              >
                Learn more about x402
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      </div>

      <ToolRunnerModal
        open={runnerTool !== null}
        onOpenChange={(open) => { if (!open) setRunnerTool(null) }}
        serverId={serverId}
        tool={runnerTool}
      />
    </div>
  )
}
