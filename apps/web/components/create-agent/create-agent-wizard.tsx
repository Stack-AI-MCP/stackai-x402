'use client'

import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Check, Wrench, Wallet, Eye } from 'lucide-react'
import { useX402Wallet } from '@/hooks/use-x402-wallet'
import { cn } from '@/lib/utils/format'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ServerWithTools {
  serverId: string
  name: string
  tools: Array<{ name: string; description: string; price: number }>
}

interface SelectedTool {
  serverId: string
  toolName: string
  price: number
}

interface CreateAgentWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (agentId: string) => void
}

// ─── Steps ──────────────────────────────────────────────────────────────────

const STEPS = ['Identity', 'Tools', 'Payment', 'Review'] as const

export function CreateAgentWizard({ open, onOpenChange, onCreated }: CreateAgentWizardProps) {
  const { address, signMessage } = useX402Wallet()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1: Identity
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [moltbookName, setMoltbookName] = useState('')
  const [moltbookApiKey, setMoltbookApiKey] = useState('')
  const [heartbeatInterval, setHeartbeatInterval] = useState(6)

  // Step 2: Tools
  const [servers, setServers] = useState<ServerWithTools[]>([])
  const [loadingServers, setLoadingServers] = useState(false)
  const [selectedTools, setSelectedTools] = useState<SelectedTool[]>([])

  // Step 3: Payment
  const [network, setNetwork] = useState<'mainnet' | 'testnet'>('mainnet')

  // Load servers when step 2 is shown
  useEffect(() => {
    if (step !== 1 || servers.length > 0) return
    setLoadingServers(true)
    fetch(`${GATEWAY_URL}/api/v1/servers`)
      .then((r) => r.json())
      .then(async (data: { servers: Array<{ serverId: string; name: string }> }) => {
        // Fetch tools for each server
        const withTools = await Promise.all(
          data.servers.map(async (s) => {
            try {
              const r = await fetch(`${GATEWAY_URL}/api/v1/servers/${s.serverId}`)
              const detail = await r.json()
              return { serverId: s.serverId, name: s.name, tools: detail.tools ?? [] }
            } catch {
              return { serverId: s.serverId, name: s.name, tools: [] }
            }
          }),
        )
        setServers(withTools)
      })
      .catch(() => setServers([]))
      .finally(() => setLoadingServers(false))
  }, [step, servers.length])

  const toggleTool = (serverId: string, toolName: string, defaultPrice: number) => {
    setSelectedTools((prev) => {
      const exists = prev.find((t) => t.serverId === serverId && t.toolName === toolName)
      if (exists) return prev.filter((t) => !(t.serverId === serverId && t.toolName === toolName))
      return [...prev, { serverId, toolName, price: defaultPrice }]
    })
  }

  const updateToolPrice = (serverId: string, toolName: string, price: number) => {
    setSelectedTools((prev) =>
      prev.map((t) => (t.serverId === serverId && t.toolName === toolName ? { ...t, price } : t)),
    )
  }

  const canNext = () => {
    if (step === 0) return name.trim().length > 0 && description.trim().length > 0
    if (step === 1) return selectedTools.length > 0
    if (step === 2) return !!address
    return true
  }

  const handleSubmit = async () => {
    if (!address) return
    setSubmitting(true)
    setError(null)

    try {
      // Sign message with wallet to prove ownership
      const message = JSON.stringify({ action: 'createAgent', name, timestamp: new Date().toISOString() })
      const { signature, publicKey } = await signMessage(message)

      const res = await fetch(`${GATEWAY_URL}/api/v1/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          ownerAddress: address,
          tools: selectedTools,
          network,
          ...(moltbookName && { moltbookName, moltbookApiKey, heartbeatIntervalHours: heartbeatInterval }),
          signature,
          publicKey,
          signedMessage: message,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? `Failed (${res.status})`)
      }

      const agent = await res.json()
      onOpenChange(false)
      onCreated?.(agent.agentId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl mx-4 bg-background border border-border rounded-[2px] shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header with steps */}
        <div className="sticky top-0 bg-background border-b border-border p-6 pb-4 z-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold tracking-tight">Create Agent</h2>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="text-muted-foreground hover:text-foreground text-sm font-mono"
            >
              ESC
            </button>
          </div>

          {/* Step indicators */}
          <div className="flex gap-2">
            {STEPS.map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => i < step && setStep(i)}
                className={cn(
                  'flex-1 text-center py-1.5 text-[10px] font-mono font-bold uppercase tracking-widest border-b-2 transition-colors',
                  i === step ? 'border-foreground text-foreground' :
                  i < step ? 'border-primary/50 text-primary cursor-pointer' :
                  'border-transparent text-muted-foreground/40',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="p-6 space-y-6">
          {/* Step 1: Identity */}
          {step === 0 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                  Agent Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Weather Oracle"
                  className="w-full h-11 px-4 font-mono text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                  Description *
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this agent do?"
                  rows={3}
                  className="w-full px-4 py-3 font-mono text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                  Moltbook Username (optional)
                </label>
                <input
                  type="text"
                  value={moltbookName}
                  onChange={(e) => setMoltbookName(e.target.value)}
                  placeholder="e.g. weather-bot"
                  className="w-full h-11 px-4 font-mono text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <p className="text-[10px] text-muted-foreground">Links to moltbook.com/u/{'<name>'}</p>
              </div>

              {moltbookName && (
                <>
                  <div className="space-y-2">
                    <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                      Moltbook API Key
                    </label>
                    <input
                      type="password"
                      value={moltbookApiKey}
                      onChange={(e) => setMoltbookApiKey(e.target.value)}
                      placeholder="moltbook_..."
                      className="w-full h-11 px-4 font-mono text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                    <p className="text-[10px] text-muted-foreground">Required for Moltbook agent registration and posting.</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                      Heartbeat Interval
                    </label>
                    <div className="flex gap-2 flex-wrap">
                      {[1, 4, 6, 8, 12, 24].map((h) => (
                        <button
                          key={h}
                          type="button"
                          onClick={() => setHeartbeatInterval(h)}
                          className={cn(
                            'h-9 px-3 text-[11px] font-mono font-bold border rounded-[2px] transition-colors',
                            heartbeatInterval === h
                              ? 'border-foreground bg-foreground text-background'
                              : 'border-border text-muted-foreground hover:border-foreground',
                          )}
                        >
                          {h}h
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground">How often the agent browses feed and engages on Moltbook.</p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 2: Tools */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Select tools from registered servers and set per-tool pricing.</p>

              {loadingServers ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : servers.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">No servers registered yet.</p>
              ) : (
                servers.map((server) => (
                  <div key={server.serverId} className="border border-border rounded-[2px] p-4 space-y-3">
                    <h4 className="font-bold text-sm">{server.name}</h4>
                    <div className="space-y-2">
                      {server.tools.map((tool) => {
                        const selected = selectedTools.find(
                          (t) => t.serverId === server.serverId && t.toolName === tool.name,
                        )
                        return (
                          <div key={tool.name} className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => toggleTool(server.serverId, tool.name, tool.price)}
                              className={cn(
                                'h-5 w-5 rounded-[2px] border flex items-center justify-center shrink-0 transition-colors',
                                selected ? 'bg-foreground border-foreground' : 'border-border hover:border-foreground',
                              )}
                            >
                              {selected && <Check className="h-3 w-3 text-background" />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <code className="text-xs font-mono text-foreground">{tool.name}</code>
                              <p className="text-[10px] text-muted-foreground truncate">{tool.description}</p>
                            </div>
                            {selected && (
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="text-[10px] text-muted-foreground">$</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.001"
                                  value={selected.price}
                                  onChange={(e) => updateToolPrice(server.serverId, tool.name, parseFloat(e.target.value) || 0)}
                                  className="w-20 h-7 px-2 text-xs font-mono border border-border bg-background text-right"
                                />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}

              <p className="text-[10px] font-mono text-muted-foreground">
                {selectedTools.length} tool{selectedTools.length !== 1 ? 's' : ''} selected
              </p>
            </div>
          )}

          {/* Step 3: Payment */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                  Payment Recipient
                </label>
                <div className="h-11 px-4 flex items-center border border-border bg-muted/30 font-mono text-sm text-foreground truncate">
                  {address ?? 'Connect wallet first'}
                </div>
                <p className="text-[10px] text-muted-foreground">Payments for agent tool calls go to your connected wallet address.</p>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                  Network
                </label>
                <div className="flex gap-2">
                  {(['mainnet', 'testnet'] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNetwork(n)}
                      className={cn(
                        'h-9 px-4 text-[11px] font-mono font-bold uppercase tracking-widest border rounded-[2px] transition-colors',
                        network === n
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border text-muted-foreground hover:border-foreground',
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="border border-border rounded-[2px] p-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">NAME</span>
                  <span className="text-sm font-bold">{name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">TOOLS</span>
                  <span className="text-sm font-mono">{selectedTools.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">NETWORK</span>
                  <span className="text-sm font-mono uppercase">{network}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">RECIPIENT</span>
                  <span className="text-xs font-mono truncate ml-4">{address}</span>
                </div>
                {moltbookName && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">MOLTBOOK</span>
                      <span className="text-sm font-mono">@{moltbookName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">HEARTBEAT</span>
                      <span className="text-sm font-mono">Every {heartbeatInterval}h</span>
                    </div>
                  </>
                )}
              </div>

              {/* Tool list summary */}
              <div className="border border-border rounded-[2px] p-4 space-y-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">SELECTED TOOLS</span>
                {selectedTools.map((t) => (
                  <div key={`${t.serverId}-${t.toolName}`} className="flex justify-between text-xs font-mono">
                    <span className="text-foreground">{t.toolName}</span>
                    <span className="text-muted-foreground">{t.price > 0 ? `$${t.price}` : 'FREE'}</span>
                  </div>
                ))}
              </div>

              {error && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-[2px] p-3">
                  {error}
                </div>
              )}

              <p className="text-[10px] text-muted-foreground text-center">
                Your wallet will sign a message to prove ownership. No transaction is sent.
              </p>
            </div>
          )}
        </div>

        {/* Footer: navigation buttons */}
        <div className="sticky bottom-0 bg-background border-t border-border p-4 flex justify-between">
          <button
            type="button"
            onClick={() => (step === 0 ? onOpenChange(false) : setStep(step - 1))}
            className="h-10 px-4 text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground border border-border rounded-[2px] transition-colors"
          >
            {step === 0 ? 'CANCEL' : 'BACK'}
          </button>

          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={!canNext()}
              className="h-10 px-6 text-[10px] font-mono font-bold uppercase tracking-widest bg-foreground text-background rounded-[2px] disabled:opacity-40 disabled:cursor-not-allowed transition-colors hover:bg-foreground/90"
            >
              NEXT
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !address}
              className="h-10 px-6 text-[10px] font-mono font-bold uppercase tracking-widest bg-foreground text-background rounded-[2px] disabled:opacity-40 disabled:cursor-not-allowed transition-colors hover:bg-foreground/90 flex items-center gap-2"
            >
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              CREATE AGENT
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
