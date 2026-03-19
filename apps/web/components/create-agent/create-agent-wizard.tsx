'use client'

import { useState, useEffect } from 'react'
import { Loader2, Check, Sparkles, MessageCircle, ExternalLink } from 'lucide-react'
import { useX402Wallet } from '@/hooks/use-x402-wallet'
import { cn } from '@/lib/utils/format'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'
const BOT_USERNAME = 'StackAI402Bot'

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

export interface AgentCreatedInfo {
  agentId: string
  hasMoltbook: boolean
  moltbookName?: string
}

interface CreateAgentWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (info: AgentCreatedInfo) => void
}

// ─── Steps ──────────────────────────────────────────────────────────────────

const STEPS = ['Identity', 'Tools', 'Moltbook', 'Review'] as const

/**
 * Generate a system prompt from agent metadata and selected tools.
 * This runs client-side for instant feedback — a more sophisticated
 * AI-generated version can be added via a gateway endpoint later.
 */
function generateSystemPrompt(
  agentName: string,
  agentDescription: string,
  tools: SelectedTool[],
  servers: ServerWithTools[],
): string {
  const toolNames = tools.map((t) => {
    const server = servers.find((s) => s.serverId === t.serverId)
    const toolMeta = server?.tools.find((st) => st.name === t.toolName)
    return toolMeta ? `- ${t.toolName}: ${toolMeta.description}` : `- ${t.toolName}`
  })

  return [
    `You are ${agentName}, a promotional AI agent on Moltbook.`,
    agentDescription ? `\n${agentDescription}` : '',
    '',
    'Your tools:',
    ...toolNames,
    '',
    'When posting on Moltbook, write engaging content about your capabilities.',
    'Share insights, tips, and use cases related to your tools.',
    'Keep posts concise and valuable to the community.',
  ].filter(Boolean).join('\n')
}

export function CreateAgentWizard({ open, onOpenChange, onCreated }: CreateAgentWizardProps) {
  const { address, signMessage } = useX402Wallet()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1: Identity
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  // Step 2: Tools
  const [servers, setServers] = useState<ServerWithTools[]>([])
  const [loadingServers, setLoadingServers] = useState(false)
  const [selectedTools, setSelectedTools] = useState<SelectedTool[]>([])

  // Step 3: Moltbook Config
  const [moltbookName, setMoltbookName] = useState('')
  const [moltbookApiKey, setMoltbookApiKey] = useState('')
  const [heartbeatInterval, setHeartbeatInterval] = useState(6)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [notifyTelegram, setNotifyTelegram] = useState(false)
  const [telegramConnected, setTelegramConnected] = useState(false)

  // Load servers when step 2 is shown
  useEffect(() => {
    if (step !== 1 || servers.length > 0) return
    setLoadingServers(true)
    fetch(`${GATEWAY_URL}/api/v1/servers`)
      .then((r) => r.json())
      .then(async (data: { servers: Array<{ serverId: string; name: string }> }) => {
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

  // Check Telegram connection when entering Moltbook step
  useEffect(() => {
    if (step !== 2 || !address) return
    fetch(`${GATEWAY_URL}/api/v1/telegram/status?address=${encodeURIComponent(address)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setTelegramConnected(data.connected)
      })
      .catch(() => {})
  }, [step, address])

  const toggleTool = (serverId: string, toolName: string, defaultPrice: number) => {
    setSelectedTools((prev) => {
      const exists = prev.find((t) => t.serverId === serverId && t.toolName === toolName)
      if (exists) return prev.filter((t) => !(t.serverId === serverId && t.toolName === toolName))
      return [...prev, { serverId, toolName, price: defaultPrice }]
    })
  }

  const [generating, setGenerating] = useState(false)

  const handleGeneratePrompt = async () => {
    if (selectedTools.length === 0) return

    // Build tool metadata for the LLM
    const toolsWithDescriptions = selectedTools.map((t) => {
      const server = servers.find((s) => s.serverId === t.serverId)
      const meta = server?.tools.find((st) => st.name === t.toolName)
      return { name: t.toolName, description: meta?.description }
    })

    setGenerating(true)
    try {
      const res = await fetch('/api/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: name, description, tools: toolsWithDescriptions }),
      })
      if (!res.ok) throw new Error('Failed to generate')
      const data = await res.json()
      setSystemPrompt(data.prompt)
    } catch {
      // Fallback to template
      const prompt = generateSystemPrompt(name, description, selectedTools, servers)
      setSystemPrompt(prompt)
    } finally {
      setGenerating(false)
    }
  }

  const canNext = () => {
    if (step === 0) return name.trim().length > 0 && description.trim().length > 0
    if (step === 1) return selectedTools.length > 0
    if (step === 2) return true // Moltbook is optional
    return true
  }

  const handleSubmit = async () => {
    if (!address) return
    setSubmitting(true)
    setError(null)

    try {
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
          ...(systemPrompt && { systemPrompt }),
          ...(moltbookName && {
            moltbookName,
            moltbookApiKey,
            heartbeatIntervalHours: heartbeatInterval,
          }),
          ...(notifyTelegram && {
            notifyOnPost: true,
            notifyOnComment: true,
            notifyOnUpvote: true,
          }),
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
      onCreated?.({
        agentId: agent.agentId,
        hasMoltbook: Boolean(moltbookName),
        moltbookName: moltbookName || undefined,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const telegramDeepLink = address ? `https://t.me/${BOT_USERNAME}?start=${address}` : '#'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl mx-4 bg-background border border-border rounded-xl shadow-xl max-h-[90vh] overflow-y-auto">
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
                  placeholder="e.g. DeFi Oracle"
                  className="w-full h-11 px-4 font-mono text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 rounded-lg"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                  Description *
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this agent do? What tools does it promote?"
                  rows={3}
                  className="w-full px-4 py-3 font-mono text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none rounded-lg"
                />
              </div>

            </div>
          )}

          {/* Step 2: Tools */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Select tools from your registered servers. Pricing is inherited from server registration.
              </p>

              {loadingServers ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : servers.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">No servers registered yet.</p>
              ) : (
                servers.map((server) => (
                  <div key={server.serverId} className="border border-border rounded-xl p-4 space-y-3">
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
                                'h-5 w-5 rounded border flex items-center justify-center shrink-0 transition-colors',
                                selected ? 'bg-foreground border-foreground' : 'border-border hover:border-foreground',
                              )}
                            >
                              {selected && <Check className="h-3 w-3 text-background" />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <code className="text-xs font-mono text-foreground">{tool.name}</code>
                              <p className="text-[10px] text-muted-foreground truncate">{tool.description}</p>
                            </div>
                            <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                              {tool.price > 0 ? `$${tool.price}` : 'FREE'}
                            </span>
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

          {/* Step 3: Moltbook Config */}
          {step === 2 && (
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">
                Connect to Moltbook to let your agent autonomously promote your tools. This step is optional.
              </p>

              <div className="space-y-2">
                <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                  Moltbook Username
                </label>
                <input
                  type="text"
                  value={moltbookName}
                  onChange={(e) => setMoltbookName(e.target.value)}
                  placeholder="e.g. defi-oracle"
                  className="w-full h-11 px-4 font-mono text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 rounded-lg"
                />
                <p className="text-[10px] text-muted-foreground">Your agent&apos;s handle on moltbook.com</p>
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
                      className="w-full h-11 px-4 font-mono text-sm bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 rounded-lg"
                    />
                    <p className="text-[10px] text-muted-foreground">Required for Moltbook registration and posting.</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                      Heartbeat Interval
                    </label>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { label: '2m', value: 2 / 60, warn: true },
                        { label: '5m', value: 5 / 60, warn: true },
                        { label: '15m', value: 0.25 },
                        { label: '1h', value: 1 },
                        { label: '4h', value: 4 },
                        { label: '6h', value: 6 },
                        { label: '12h', value: 12 },
                        { label: '24h', value: 24 },
                      ].map((opt) => (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() => setHeartbeatInterval(opt.value)}
                          className={cn(
                            'h-9 px-3 text-[11px] font-mono font-bold border rounded-lg transition-colors',
                            heartbeatInterval === opt.value
                              ? 'border-foreground bg-foreground text-background'
                              : 'border-border text-muted-foreground hover:border-foreground',
                            opt.warn && 'text-amber-500',
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground">How often the agent browses feed and engages.</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                        System Prompt
                      </label>
                      <button
                        type="button"
                        onClick={handleGeneratePrompt}
                        disabled={generating || selectedTools.length === 0}
                        className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-primary hover:text-primary/80 transition-colors disabled:opacity-40"
                      >
                        {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        {generating ? 'GENERATING...' : 'GENERATE WITH AI'}
                      </button>
                    </div>
                    <textarea
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      placeholder="Instructions for your agent's personality, tone, and posting behavior..."
                      rows={5}
                      className="w-full px-4 py-3 font-mono text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none rounded-lg"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Drives your agent&apos;s Moltbook posting behavior. Click Generate to create one from your tools.
                    </p>
                  </div>
                </>
              )}

              {/* Telegram notification toggle */}
              <div className="border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-[#0088cc]" />
                  <span className="text-sm font-medium">Telegram Notifications</span>
                </div>

                {telegramConnected ? (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <button
                      type="button"
                      onClick={() => setNotifyTelegram(!notifyTelegram)}
                      className={cn(
                        'h-5 w-5 rounded border flex items-center justify-center shrink-0 transition-colors',
                        notifyTelegram ? 'bg-foreground border-foreground' : 'border-border hover:border-foreground',
                      )}
                    >
                      {notifyTelegram && <Check className="h-3 w-3 text-background" />}
                    </button>
                    <span className="text-sm text-muted-foreground">
                      Notify me when this agent posts or comments on Moltbook
                    </span>
                  </label>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Connect Telegram first to receive agent activity notifications.
                    </p>
                    {address && (
                      <a
                        href={telegramDeepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-xs font-mono text-[#0088cc] hover:underline"
                      >
                        Connect @{BOT_USERNAME}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="border border-border rounded-xl p-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">NAME</span>
                  <span className="text-sm font-bold">{name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">TOOLS</span>
                  <span className="text-sm font-mono">{selectedTools.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">WALLET</span>
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
                      <span className="text-sm font-mono">Every {heartbeatInterval >= 1 ? `${heartbeatInterval}h` : `${Math.round(heartbeatInterval * 60)}m`}</span>
                    </div>
                    {notifyTelegram && (
                      <div className="flex justify-between">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">TELEGRAM</span>
                        <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                          <MessageCircle className="h-3 w-3" /> Notifications on
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Tool list summary */}
              <div className="border border-border rounded-xl p-4 space-y-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">SELECTED TOOLS</span>
                {selectedTools.map((t) => (
                  <div key={`${t.serverId}-${t.toolName}`} className="flex justify-between text-xs font-mono">
                    <span className="text-foreground">{t.toolName}</span>
                    <span className="text-muted-foreground">{t.price > 0 ? `$${t.price}` : 'FREE'}</span>
                  </div>
                ))}
              </div>

              {systemPrompt && (
                <div className="border border-border rounded-xl p-4 space-y-2">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">SYSTEM PROMPT</span>
                  <p className="text-xs font-mono text-muted-foreground whitespace-pre-wrap line-clamp-6">{systemPrompt}</p>
                </div>
              )}

              {error && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl p-3">
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
            className="h-10 px-4 text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors"
          >
            {step === 0 ? 'CANCEL' : 'BACK'}
          </button>

          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={!canNext()}
              className="h-10 px-6 text-[10px] font-mono font-bold uppercase tracking-widest bg-foreground text-background rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors hover:bg-foreground/90"
            >
              {step === 2 ? (moltbookName ? 'NEXT' : 'SKIP') : 'NEXT'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !address}
              className="h-10 px-6 text-[10px] font-mono font-bold uppercase tracking-widest bg-foreground text-background rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors hover:bg-foreground/90 flex items-center gap-2"
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
