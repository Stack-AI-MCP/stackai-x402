'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Eye, EyeOff, Plus, X, Check, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils/format'
import type { TokenPrices } from '@/app/api/prices/route'

export interface MCPToolLite {
  name: string
  description?: string
}

export interface MonetizeWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverUrl: string
  tools: MCPToolLite[] | null // null = still loading
  onCreate: (payload: {
    name: string
    description: string
    recipientAddress: string
    network: 'mainnet' | 'testnet'
    acceptedTokens: string[]
    toolPricing: Record<string, { price: number }>
    requireAuth: boolean
    authHeaders: Record<string, string>
  }) => Promise<void>
  defaultAddress?: string
  defaultName?: string
  defaultDescription?: string
}

const TOKEN_OPTIONS = ['STX', 'sBTC', 'USDCx'] as const
const STEP_LABELS = ['TOKENS', 'PRICES', 'AUTH', 'DETAILS']

// ─── Conversion helpers ──────────────────────────────────────────────────────

/** USD → μSTX (integer, 1 STX = 1,000,000 μSTX) */
function usdToMicroSTX(usd: number, stxPrice: number): number {
  if (!stxPrice || usd <= 0) return 0
  return Math.round((usd / stxPrice) * 1_000_000)
}

/** USD → satoshis (integer, 1 BTC = 100,000,000 sats) */
function usdToSats(usd: number, btcPrice: number): number {
  if (!btcPrice || usd <= 0) return 0
  return Math.round((usd / btcPrice) * 100_000_000)
}

function formatSats(sats: number): string {
  if (sats >= 100_000_000) return `${(sats / 100_000_000).toFixed(6)} BTC`
  if (sats >= 1_000) return `${sats.toLocaleString()} sats`
  return `${sats} sats`
}

function formatUsd(n: number): string {
  if (n === 0) return 'Free'
  if (n < 0.001) return `$${n.toFixed(6)}`
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

// ─── usePrices hook ──────────────────────────────────────────────────────────

function usePrices() {
  const [prices, setPrices] = useState<TokenPrices | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const fetch_ = useCallback(() => {
    setLoading(true)
    setError(false)
    fetch('/api/prices')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: TokenPrices) => setPrices(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetch_() }, [fetch_])

  return { prices, loading, error, refetch: fetch_ }
}

// ─── Step 0: Tokens ──────────────────────────────────────────────────────────

const TOKEN_INFO: Record<string, { desc: string; color: string; logo: string }> = {
  STX: {
    desc: 'Native Stacks token. Lowest fees, widest wallet support.',
    color: 'border-purple-500/40 bg-purple-500/5',
    logo: 'https://assets.coingecko.com/coins/images/2069/large/Stacks_logo_full.png',
  },
  sBTC: {
    desc: 'Synthetic Bitcoin on Stacks. For BTC-native users.',
    color: 'border-amber-500/40 bg-amber-500/5',
    logo: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
  },
  USDCx: {
    desc: 'USD-pegged stablecoin. Predictable revenue.',
    color: 'border-blue-500/40 bg-blue-500/5',
    logo: 'https://assets.coingecko.com/coins/images/6319/large/usdc.png',
  },
}

function StepTokens({
  selected,
  onToggle,
}: {
  selected: string[]
  onToggle: (token: string) => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          Accepted Payment Tokens
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Select which tokens callers can use to pay for tool calls.
        </p>
      </div>

      <div className="space-y-3">
        {TOKEN_OPTIONS.map((token) => {
          const info = TOKEN_INFO[token]
          const isSelected = selected.includes(token)
          return (
            <button
              key={token}
              type="button"
              onClick={() => onToggle(token)}
              className={cn(
                'w-full flex items-center gap-4 rounded-[2px] border p-4 text-left transition-all',
                isSelected
                  ? `${info.color} border-opacity-100`
                  : 'border-border bg-card hover:border-foreground/30',
              )}
            >
              <div
                className={cn(
                  'h-5 w-5 rounded-sm border-2 flex items-center justify-center shrink-0 transition-colors',
                  isSelected ? 'border-primary bg-primary' : 'border-muted-foreground',
                )}
              >
                {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
              </div>
              <img
                src={info.logo}
                alt={token}
                className="h-8 w-8 rounded-full object-contain shrink-0"
              />
              <div className="flex-1">
                <p className="font-mono font-bold text-sm">{token}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{info.desc}</p>
              </div>
            </button>
          )
        })}
      </div>

      {selected.length === 0 && (
        <p className="text-xs text-destructive font-mono">Select at least one token.</p>
      )}
    </div>
  )
}

// ─── Step 1: Prices ──────────────────────────────────────────────────────────

function PriceConversions({
  usd,
  acceptedTokens,
  prices,
}: {
  usd: number
  acceptedTokens: string[]
  prices: TokenPrices | null
}) {
  if (usd <= 0 || !prices) return null

  const rows: Array<{ token: string; amount: string }> = []

  if (acceptedTokens.includes('STX') && prices.STX) {
    const μSTX = usdToMicroSTX(usd, prices.STX)
    rows.push({ token: 'STX', amount: `${μSTX.toLocaleString()} μSTX` })
  }
  if (acceptedTokens.includes('sBTC') && prices.BTC) {
    rows.push({ token: 'sBTC', amount: formatSats(usdToSats(usd, prices.BTC)) })
  }
  if (acceptedTokens.includes('USDCx')) {
    rows.push({ token: 'USDCx', amount: `${usd.toFixed(4)} USDCx` })
  }

  if (rows.length === 0) return null

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
      {rows.map(({ token, amount }) => (
        <span key={token} className="text-[10px] font-mono text-muted-foreground">
          ≈ {amount}
        </span>
      ))}
    </div>
  )
}

function StepPrices({
  tools,
  priceByTool,
  onChange,
  acceptedTokens,
  prices,
  pricesLoading,
  pricesError,
  onRefreshPrices,
}: {
  tools: MCPToolLite[]
  priceByTool: Record<string, number>
  onChange: (toolName: string, price: number) => void
  acceptedTokens: string[]
  prices: TokenPrices | null
  pricesLoading: boolean
  pricesError: boolean
  onRefreshPrices: () => void
}) {
  const [bulkValue, setBulkValue] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const applyBulk = () => {
    const price = parseFloat(bulkValue) || 0
    tools.forEach((t) => onChange(t.name, price))
  }

  const clearAll = () => {
    tools.forEach((t) => onChange(t.name, 0))
    setBulkValue('')
  }

  const pricedCount = tools.filter((t) => (priceByTool[t.name] ?? 0) > 0).length

  if (tools.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        No tools discovered. Prices can be set after registration.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          Set Prices
        </span>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono text-muted-foreground">
            {pricedCount}/{tools.length} priced
          </span>
          {/* Live price status */}
          {pricesLoading ? (
            <span className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading prices…
            </span>
          ) : prices ? (
            <span className="text-[10px] font-mono text-muted-foreground/60">
              STX ${prices.STX.toFixed(2)} · BTC ${prices.BTC.toLocaleString()}
            </span>
          ) : pricesError ? (
            <button
              type="button"
              onClick={onRefreshPrices}
              className="flex items-center gap-1 text-[10px] font-mono text-destructive hover:underline"
            >
              <RefreshCw className="h-3 w-3" />
              Retry prices
            </button>
          ) : null}
        </div>
      </div>

      {/* Bulk input — USD */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm pointer-events-none">
            $
          </span>
          <input
            type="number"
            min="0"
            step="0.001"
            value={bulkValue}
            onChange={(e) => setBulkValue(e.target.value)}
            placeholder="0.01"
            className="h-9 w-full border border-border bg-background pl-7 pr-3 font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
        <button
          type="button"
          onClick={applyBulk}
          className="h-9 px-4 text-[10px] font-mono font-bold uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          APPLY
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="h-9 px-4 text-[10px] font-mono font-bold uppercase tracking-widest border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
        >
          CLEAR
        </button>
      </div>

      {/* Bulk preview */}
      {bulkValue && parseFloat(bulkValue) > 0 && (
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground -mt-2">
          <span>Bulk:</span>
          <PriceConversions
            usd={parseFloat(bulkValue)}
            acceptedTokens={acceptedTokens}
            prices={prices}
          />
        </div>
      )}

      {/* Tool rows */}
      <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1">
        {tools.map((tool) => {
          const usdPrice = priceByTool[tool.name] ?? 0
          const isExpanded = expanded[tool.name]
          const hasLongDesc = (tool.description?.length ?? 0) > 80

          return (
            <div
              key={tool.name}
              className="rounded-[2px] border border-border bg-card p-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <code className="text-sm font-bold font-mono text-primary">{tool.name}</code>
                  {tool.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {isExpanded || !hasLongDesc
                        ? tool.description
                        : `${tool.description.slice(0, 80)}…`}
                      {hasLongDesc && (
                        <button
                          type="button"
                          onClick={() => setExpanded((p) => ({ ...p, [tool.name]: !p[tool.name] }))}
                          className="ml-1 text-[10px] font-mono font-bold uppercase text-primary hover:underline"
                        >
                          {isExpanded ? 'LESS' : 'MORE'}
                        </button>
                      )}
                    </p>
                  )}
                </div>

                {/* USD price input */}
                <div className="shrink-0 flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-muted-foreground">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={usdPrice === 0 ? '' : String(usdPrice)}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value)
                      onChange(tool.name, Number.isNaN(val) ? 0 : Math.max(0, val))
                    }}
                    placeholder="0"
                    className="w-20 h-8 border border-border bg-background px-2 text-right font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  <span className="text-[10px] font-mono text-muted-foreground">USD</span>
                </div>
              </div>

              {/* Per-token breakdown */}
              <PriceConversions
                usd={usdPrice}
                acceptedTokens={acceptedTokens}
                prices={prices}
              />

              {usdPrice === 0 && (
                <span className="text-[10px] font-mono text-green-600 dark:text-green-400">
                  Free
                </span>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Enter USD amounts per call. Conversions update live using market prices.
        Set 0 for free tools.
      </p>
    </div>
  )
}

// ─── Step 2: Auth ─────────────────────────────────────────────────────────────

function StepAuth({
  requireAuth,
  onToggle,
  headers,
  onHeaderChange,
  onAddHeader,
  onRemoveHeader,
}: {
  requireAuth: boolean
  onToggle: () => void
  headers: Array<{ key: string; value: string }>
  onHeaderChange: (index: number, field: 'key' | 'value', val: string) => void
  onAddHeader: () => void
  onRemoveHeader: (index: number) => void
}) {
  const [showValues, setShowValues] = useState(false)
  const filledCount = headers.filter((h) => h.key.trim() && h.value.trim()).length

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Require Auth Headers</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Gate your upstream MCP server with auth credentials.
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none',
            requireAuth ? 'bg-primary' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform',
              requireAuth ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      </div>

      <div className="rounded-[2px] border border-border bg-muted/30 p-3 text-xs text-muted-foreground leading-relaxed">
        By default, no authentication is required. The gateway forwards requests directly to your
        upstream server. Enable this if your server requires API keys or Bearer tokens.
      </div>

      {requireAuth && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
              Configure Headers{' '}
              <span className="normal-case">({filledCount}/{headers.length})</span>
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowValues((p) => !p)}
                className="p-1 text-muted-foreground hover:text-foreground"
                title={showValues ? 'Hide values' : 'Show values'}
              >
                {showValues ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={onAddHeader}
                className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-widest text-primary hover:underline"
              >
                <Plus className="h-3 w-3" />
                ADD
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {headers.map((h, i) => {
              const filled = h.key.trim() && h.value.trim()
              return (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={h.key}
                    onChange={(e) => onHeaderChange(i, 'key', e.target.value)}
                    placeholder="Header-Name"
                    className={cn(
                      'h-9 flex-1 border bg-background px-3 font-mono text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50',
                      filled ? 'border-primary/50' : 'border-border',
                    )}
                  />
                  <input
                    type={showValues ? 'text' : 'password'}
                    value={h.value}
                    onChange={(e) => onHeaderChange(i, 'value', e.target.value)}
                    placeholder="value"
                    className={cn(
                      'h-9 flex-1 border bg-background px-3 font-mono text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50',
                      filled ? 'border-primary/50' : 'border-border',
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveHeader(i)}
                    disabled={headers.length === 1}
                    className="p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-30"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Common: <code>Authorization: Bearer YOUR_KEY</code> or{' '}
            <code>x-api-key: YOUR_KEY</code>. Credentials are encrypted at rest.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Step 3: Details ──────────────────────────────────────────────────────────

function StepDetails({
  name,
  description,
  recipientAddress,
  network,
  onChange,
  onNetworkChange,
}: {
  name: string
  description: string
  recipientAddress: string
  network: 'mainnet' | 'testnet'
  onChange: (field: 'name' | 'description' | 'recipientAddress', val: string) => void
  onNetworkChange: (network: 'mainnet' | 'testnet') => void
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          Server Name <span className="text-destructive">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => onChange('name', e.target.value)}
          placeholder="My MCP Server"
          className="h-10 w-full border border-border bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => onChange('description', e.target.value)}
          placeholder="What does your MCP server do?"
          rows={3}
          className="w-full border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          Recipient Address <span className="text-destructive">*</span>
        </label>
        <input
          type="text"
          value={recipientAddress}
          onChange={(e) => onChange('recipientAddress', e.target.value)}
          placeholder="SP... or ST..."
          className="h-10 w-full border border-border bg-background px-3 font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <p className="text-[11px] text-muted-foreground">
          Stacks address where payment proceeds will be sent (SP/ST prefix).
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          Network
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(['mainnet', 'testnet'] as const).map((net) => (
            <button
              key={net}
              type="button"
              onClick={() => onNetworkChange(net)}
              className={cn(
                'h-10 border font-mono text-xs font-bold uppercase tracking-widest transition-all',
                network === net
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
              )}
            >
              {net}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {network === 'mainnet'
            ? 'Mainnet — real payments via x402-relay.aibtc.com'
            : 'Testnet — test payments via x402-relay.aibtc.dev'}
        </p>
      </div>
    </div>
  )
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

const STACKS_ADDRESS_RE = /^S[TPMN][0-9A-Z]{38,64}$/

export function MonetizeWizard({
  open,
  onOpenChange,
  serverUrl,
  tools,
  onCreate,
  defaultAddress = '',
  defaultName = '',
  defaultDescription = '',
}: MonetizeWizardProps) {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 0: Tokens
  const [acceptedTokens, setAcceptedTokens] = useState<string[]>(['STX', 'sBTC', 'USDCx'])

  // Step 1: Prices (USD per call)
  const [priceByTool, setPriceByTool] = useState<Record<string, number>>({})

  // Step 2: Auth
  const [requireAuth, setRequireAuth] = useState(false)
  const [authHeaders, setAuthHeaders] = useState([{ key: '', value: '' }])

  // Step 3: Details
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [recipientAddress, setRecipientAddress] = useState(defaultAddress)
  const [network, setNetwork] = useState<'mainnet' | 'testnet'>('mainnet')

  // Prices from CoinGecko
  const { prices, loading: pricesLoading, error: pricesError, refetch: refetchPrices } = usePrices()

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep(0)
      setLoading(false)
      setError(null)
      setAcceptedTokens(['STX', 'sBTC', 'USDCx'])
      setPriceByTool({})
      setRequireAuth(false)
      setAuthHeaders([{ key: '', value: '' }])
      setName(defaultName)
      setDescription(defaultDescription)
      setRecipientAddress(defaultAddress)
      setNetwork('mainnet')
    }
  }, [open, defaultAddress, defaultName, defaultDescription])

  // Init prices when tools load
  useEffect(() => {
    if (tools) {
      setPriceByTool((prev) => {
        const next = { ...prev }
        for (const t of tools) {
          if (!(t.name in next)) next[t.name] = 0
        }
        return next
      })
    }
  }, [tools])

  // ── Validation per step ──
  const step0Valid = acceptedTokens.length > 0
  const step1Valid = !tools || tools.length === 0 || Object.values(priceByTool).every((p) => p >= 0)
  const step2Valid =
    !requireAuth || authHeaders.every((h) => h.key.trim() && h.value.trim())
  const step3Valid =
    name.trim().length > 0 && STACKS_ADDRESS_RE.test(recipientAddress.trim())

  const canNext = [step0Valid, step1Valid, step2Valid, step3Valid][step] ?? true

  // ── Handlers ──
  const handlePriceChange = useCallback((toolName: string, price: number) => {
    setPriceByTool((p) => ({ ...p, [toolName]: price }))
  }, [])

  const handleHeaderChange = useCallback(
    (index: number, field: 'key' | 'value', val: string) => {
      setAuthHeaders((prev) => {
        const next = [...prev]
        next[index] = { ...next[index], [field]: val }
        return next
      })
    },
    [],
  )

  const handleTokenToggle = useCallback((token: string) => {
    setAcceptedTokens((prev) =>
      prev.includes(token) ? prev.filter((t) => t !== token) : [...prev, token],
    )
  }, [])

  const handleDetailChange = useCallback(
    (field: 'name' | 'description' | 'recipientAddress', val: string) => {
      if (field === 'name') setName(val)
      else if (field === 'description') setDescription(val)
      else setRecipientAddress(val)
    },
    [],
  )

  const handleCreate = async () => {
    setLoading(true)
    setError(null)
    try {
      // Store USD price directly — gateway converts to token micro-units at payment time
      const toolPricing: Record<string, { price: number }> = {}
      if (tools) {
        for (const t of tools) {
          const usd = priceByTool[t.name] ?? 0
          toolPricing[t.name] = { price: usd }
        }
      }

      const headers: Record<string, string> = {}
      if (requireAuth) {
        for (const h of authHeaders) {
          if (h.key.trim() && h.value.trim()) {
            headers[h.key.trim()] = h.value.trim()
          }
        }
      }

      await onCreate({
        name: name.trim(),
        description: description.trim(),
        recipientAddress: recipientAddress.trim(),
        network,
        acceptedTokens,
        toolPricing,
        requireAuth,
        authHeaders: headers,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const isLastStep = step === STEP_LABELS.length - 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden rounded-[2px]">
        {/* Title bar */}
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
            Monetize Server
          </DialogTitle>
          <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{serverUrl}</p>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex px-6 pt-4 gap-1.5">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex-1 space-y-1">
              <div
                className={cn(
                  'h-0.5 w-full rounded-full transition-colors',
                  i <= step ? 'bg-primary' : 'bg-border',
                )}
              />
              <span
                className={cn(
                  'text-[9px] font-mono font-bold uppercase tracking-widest',
                  i === step ? 'text-foreground' : 'text-muted-foreground/50',
                )}
              >
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="px-6 py-5 min-h-[300px]">
          {step === 0 ? (
            <StepTokens selected={acceptedTokens} onToggle={handleTokenToggle} />
          ) : step === 1 ? (
            tools === null ? (
              <div className="flex items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Discovering tools…
              </div>
            ) : (
              <StepPrices
                tools={tools}
                priceByTool={priceByTool}
                onChange={handlePriceChange}
                acceptedTokens={acceptedTokens}
                prices={prices}
                pricesLoading={pricesLoading}
                pricesError={pricesError}
                onRefreshPrices={refetchPrices}
              />
            )
          ) : step === 2 ? (
            <StepAuth
              requireAuth={requireAuth}
              onToggle={() => setRequireAuth((p) => !p)}
              headers={authHeaders}
              onHeaderChange={handleHeaderChange}
              onAddHeader={() => setAuthHeaders((p) => [...p, { key: '', value: '' }])}
              onRemoveHeader={(i) => setAuthHeaders((p) => p.filter((_, idx) => idx !== i))}
            />
          ) : (
            <StepDetails
              name={name}
              description={description}
              recipientAddress={recipientAddress}
              network={network}
              onChange={handleDetailChange}
              onNetworkChange={setNetwork}
            />
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mb-2 rounded-[2px] border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Footer navigation */}
        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={() => (step === 0 ? onOpenChange(false) : setStep((s) => s - 1))}
            className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            {step === 0 ? 'CANCEL' : '← BACK'}
          </button>

          <span className="text-[10px] font-mono text-muted-foreground">
            STEP {step + 1}/{STEP_LABELS.length}
          </span>

          {isLastStep ? (
            <button
              type="button"
              onClick={handleCreate}
              disabled={!canNext || loading}
              className="h-9 px-5 text-[10px] font-mono font-bold uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              CREATE →
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext}
              className="h-9 px-5 text-[10px] font-mono font-bold uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              NEXT →
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
