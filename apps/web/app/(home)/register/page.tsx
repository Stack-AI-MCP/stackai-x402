'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { CircleCheck, AlertCircle, Loader2, Copy, Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils/format'
import { HighlighterText } from '@/components/landing/HighlighterText'
import { ServerRegisterForm } from '@/components/x402/ServerRegisterForm'
import { MonetizeWizard, type MCPToolLite } from '@/components/x402/MonetizeWizard'
import { TelegramConnect } from '@/components/x402/TelegramConnect'
import { useX402Wallet } from '@/hooks/use-x402-wallet'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'

type Tab = 'mcp' | 'api'
type Mode = null | 'monetize' | 'index'

interface RegistrationResult {
  serverId: string
  gatewayUrl: string
}

function validateUrl(val: string): boolean {
  try {
    const u = new URL(val)
    return /^https?:$/.test(u.protocol) && Boolean(u.hostname)
  } catch { return false }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="ml-2 p-1 text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

export default function RegisterPage() {
  const router = useRouter()
  const { address } = useX402Wallet()
  const [tab, setTab] = useState<Tab>('mcp')
  const [serverUrl, setServerUrl] = useState('')
  const [urlValid, setUrlValid] = useState(false)
  const [tools, setTools] = useState<MCPToolLite[] | null>(null)
  const [serverInfo, setServerInfo] = useState<{ name: string; description: string } | null>(null)
  const [loadingTools, setLoadingTools] = useState(false)
  const [mode, setMode] = useState<Mode>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [result, setResult] = useState<RegistrationResult | null>(null)
  const fetchRef = useRef<AbortController | null>(null)

  const handleUrlChange = (val: string) => {
    setServerUrl(val)
    const valid = validateUrl(val.trim())
    setUrlValid(valid)
    if (!valid) {
      setTools(null)
      setServerInfo(null)
      setMode(null)
    }
  }

  // Fetch tools when URL becomes valid
  useEffect(() => {
    if (!urlValid || !serverUrl.trim()) return
    fetchRef.current?.abort()
    const ctrl = new AbortController()
    fetchRef.current = ctrl

    setLoadingTools(true)
    setTools(null)

    fetch(`${GATEWAY_URL}/api/v1/servers/introspect?url=${encodeURIComponent(serverUrl.trim())}`, {
      signal: ctrl.signal,
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        setTools(Array.isArray(data?.tools) ? (data.tools as MCPToolLite[]) : [])
        if (data?.serverInfo) setServerInfo(data.serverInfo as { name: string; description: string })
      })
      .catch((err) => { if (err.name !== 'AbortError') setTools([]) })
      .finally(() => setLoadingTools(false))
  }, [urlValid, serverUrl])

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) handleUrlChange(text.trim())
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClear = () => {
    fetchRef.current?.abort()
    setServerUrl('')
    setUrlValid(false)
    setTools(null)
    setServerInfo(null)
    setMode(null)
    setWizardOpen(false)
    setResult(null)
  }

  const handleTabChange = (t: Tab) => {
    setTab(t)
    handleClear()
  }

  const handleMonetize = () => {
    setMode('monetize')
    setWizardOpen(true)
  }

  const handleIndex = () => {
    setMode('index')
  }

  const handleCreate = async (payload: {
    name: string
    description: string
    recipientAddress: string
    network: 'mainnet' | 'testnet'
    acceptedTokens: string[]
    toolPricing: Record<string, { price: number }>
    requireAuth: boolean
    authHeaders: Record<string, string>
  }) => {
    const body = {
      url: serverUrl.trim(),
      name: payload.name,
      ...(payload.description && { description: payload.description }),
      recipientAddress: payload.recipientAddress,
      ownerAddress: address ?? payload.recipientAddress, // Wallet address as server owner
      network: payload.network,
      acceptedTokens: payload.acceptedTokens,
      ...(Object.keys(payload.toolPricing).length > 0 && { toolPricing: payload.toolPricing }),
      ...(payload.requireAuth && Object.keys(payload.authHeaders).length > 0 && {
        upstreamAuth: Object.entries(payload.authHeaders)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n'),
      }),
    }

    const res = await fetch(`${GATEWAY_URL}/api/v1/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      throw new Error((errData as { error?: string }).error ?? `Registration failed (${res.status})`)
    }

    const data = await res.json() as RegistrationResult
    setWizardOpen(false)
    setResult(data)
  }

  const toolCount = tools?.length ?? null

  // ── Success state ──
  if (result) {
    return (
      <div className="space-y-10 animate-in fade-in duration-700">
        <div>
          <h1 className="font-host text-2xl font-bold tracking-tight">Registration Successful</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your MCP server is now live in the marketplace.
          </p>
        </div>

        <div className="rounded-[2px] border border-border bg-card p-6 space-y-5 max-w-lg">
          <div className="space-y-1.5">
            <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
              Gateway URL
            </label>
            <div className="flex items-center border border-border bg-background px-3 py-2 font-mono text-sm">
              <span className="flex-1 truncate text-xs">{result.gatewayUrl}</span>
              <CopyButton text={result.gatewayUrl} />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => router.push(`/marketplace/${result.serverId}`)}
              className="btn-primary-tall flex-1"
            >
              VIEW SERVER
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="btn-secondary-tall flex-1"
            >
              REGISTER ANOTHER
            </button>
          </div>
        </div>

        {/* Telegram notification opt-in */}
        {address && <TelegramConnect walletAddress={address} />}
      </div>
    )
  }

  return (
    <div className="space-y-10 animate-in fade-in duration-700">
      {/* Header */}
      <div>
        <h1 className="font-host text-2xl font-bold tracking-tight">Register</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect your MCP server and start accepting payments instantly.
        </p>
      </div>

      {/* Tab selector */}
      <div className="flex gap-0 border-b border-border">
        {(['mcp', 'api'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => handleTabChange(t)}
            className={cn(
              'px-6 py-2.5 text-[11px] font-mono font-bold uppercase tracking-widest border-b-2 -mb-px transition-colors',
              tab === t
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'mcp' ? 'MCP SERVER' : 'API'}
          </button>
        ))}
      </div>

      {tab === 'api' ? (
        <div className="rounded-[2px] border border-border bg-card p-8 text-center space-y-3">
          <p className="text-sm font-mono text-muted-foreground">REST API support coming soon.</p>
          <p className="text-xs text-muted-foreground/60">
            Any OpenAPI-compatible API can be converted to MCP. Switch to the MCP tab to register
            using a gateway URL.
          </p>
        </div>
      ) : (
        <>
          {/* URL input */}
          <div className="space-y-3">
            <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
              MCP SERVER URL
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <input
                  type="url"
                  value={serverUrl}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder="https://your-mcp-server.example.com"
                  className={cn(
                    'w-full h-11 px-4 pr-10 font-mono text-sm bg-background border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors',
                    urlValid ? 'border-foreground' : 'border-border',
                  )}
                />
                {serverUrl && (
                  <div className="absolute inset-y-0 right-3 flex items-center">
                    {urlValid
                      ? <CircleCheck className="h-4 w-4 text-foreground" />
                      : <AlertCircle className="h-4 w-4 text-muted-foreground/60" />
                    }
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handlePaste}
                className="h-11 px-5 text-[10px] font-mono font-bold uppercase tracking-widest bg-secondary text-foreground border border-border hover:bg-muted transition-colors shrink-0"
              >
                PASTE
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="h-11 px-5 text-[10px] font-mono font-bold uppercase tracking-widest bg-transparent text-muted-foreground border border-border hover:border-foreground hover:text-foreground transition-colors shrink-0"
              >
                CLEAR
              </button>
            </div>

            {/* Status pills */}
            <div className="flex items-center gap-2">
              {!serverUrl.trim() && <HighlighterText>Paste a URL to get started</HighlighterText>}
              {serverUrl.trim() && !urlValid && <HighlighterText>INVALID URL</HighlighterText>}
              {urlValid && (
                <>
                  <HighlighterText className="text-teal-700 bg-teal-500/10 dark:text-teal-300 dark:bg-teal-800/30">
                    VALID URL
                  </HighlighterText>
                  {loadingTools ? (
                    <HighlighterText className="flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      SCANNING
                    </HighlighterText>
                  ) : toolCount !== null ? (
                    <HighlighterText>{toolCount} TOOLS</HighlighterText>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {/* Action cards — shown after valid URL and not in index mode */}
          {urlValid && mode === null && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col gap-8 p-6 rounded-[2px] bg-card border border-border">
                <div className="space-y-2">
                  <h3 className="text-xl font-bold font-host text-foreground">Monetize</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Wrap your server and set prices per tool call. Earn sBTC, STX, or USDCx
                    micropayments.
                  </p>
                </div>
                <div className="mt-auto">
                  <button type="button" onClick={handleMonetize} className="btn-primary-tall w-full">
                    MONETIZE
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-8 p-6 rounded-[2px] bg-card border border-border">
                <div className="space-y-2">
                  <h3 className="text-xl font-bold font-host text-foreground">Index Only</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Already x402-enabled? Index your server to increase discoverability in the
                    marketplace.
                  </p>
                </div>
                <div className="mt-auto">
                  <button type="button" onClick={handleIndex} className="btn-secondary-tall w-full">
                    INDEX
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Index mode: show full form inline */}
          {mode === 'index' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                  Registration Details
                </span>
                <button
                  type="button"
                  onClick={() => setMode(null)}
                  className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                >
                  ← Back
                </button>
              </div>
              <ServerRegisterForm defaultUrl={serverUrl} />
            </div>
          )}

          {/* Monetize wizard modal */}
          <MonetizeWizard
            open={wizardOpen}
            onOpenChange={(open) => {
              setWizardOpen(open)
              if (!open) setMode(null)
            }}
            serverUrl={serverUrl}
            tools={loadingTools ? null : (tools ?? [])}
            onCreate={handleCreate}
            defaultAddress={address ?? ''}
            defaultName={serverInfo?.name ?? ''}
            defaultDescription={serverInfo?.description ?? ''}
          />
        </>
      )}
    </div>
  )
}
