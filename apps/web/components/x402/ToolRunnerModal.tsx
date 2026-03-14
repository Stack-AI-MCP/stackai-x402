'use client'

import { useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Copy, Check, Loader2, RefreshCw, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils/format'
import { PaymentCard, type PaymentRequirement, type PaymentStatus } from './PaymentCard'
import { buildUnsignedPaymentTx } from '@/lib/x402/build-payment-tx'
import { useX402Wallet } from '@/hooks/use-x402-wallet'
import { request } from '@stacks/connect'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'

/**
 * Build a V2 PaymentPayloadV2 and base64-encode it for the payment-signature header.
 * Format: base64(JSON({ x402Version: 2, accepted: PaymentRequirementsV2, payload: { transaction: txHex } }))
 */
function buildPaymentSignature(accepted: import('./PaymentCard').PaymentAccept, txHex: string): string {
  const payload = { x402Version: 2, accepted, payload: { transaction: txHex } }
  return btoa(JSON.stringify(payload))
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  enum?: unknown[]
  description?: string
  title?: string
  items?: JsonSchema
  default?: unknown
  minimum?: number
  maximum?: number
}

export interface ToolForRunner {
  name: string
  description?: string
  price: number   // USD amount stored at registration
  inputSchema?: JsonSchema
}

interface ToolRunnerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverId: string
  tool: ToolForRunner | null
}

// ─── Price formatting ─────────────────────────────────────────────────────────

function formatUsdPrice(usd: number): string {
  if (usd === 0) return 'FREE'
  if (usd < 0.001) return `$${usd.toFixed(6)}`
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

// ─── Schema-driven field renderer ─────────────────────────────────────────────

function FieldRenderer({
  name,
  schema,
  value,
  onChange,
  required,
  depth = 0,
}: {
  name: string
  schema: JsonSchema
  value: unknown
  onChange: (val: unknown) => void
  required?: boolean
  depth?: number
}) {
  const label = schema.title ?? name
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type

  // Enum → select
  if (schema.enum && schema.enum.length > 0) {
    return (
      <div className="space-y-1">
        <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          {label} {required && <span className="text-destructive">*</span>}
        </label>
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
        >
          <option value="">Select…</option>
          {schema.enum.map((v) => (
            <option key={String(v)} value={String(v)}>
              {String(v)}
            </option>
          ))}
        </select>
        {schema.description && (
          <p className="text-[11px] text-muted-foreground">{schema.description}</p>
        )}
      </div>
    )
  }

  // Boolean → toggle
  if (type === 'boolean') {
    return (
      <div className="flex items-center justify-between">
        <div>
          <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
            {label} {required && <span className="text-destructive">*</span>}
          </label>
          {schema.description && (
            <p className="text-[11px] text-muted-foreground">{schema.description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors',
            value ? 'bg-primary' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform',
              value ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      </div>
    )
  }

  // Number → number input
  if (type === 'number' || type === 'integer') {
    return (
      <div className="space-y-1">
        <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          {label} {required && <span className="text-destructive">*</span>}
        </label>
        <input
          type="number"
          value={value === undefined ? '' : String(value)}
          min={schema.minimum}
          max={schema.maximum}
          onChange={(e) =>
            onChange(e.target.value === '' ? undefined : Number(e.target.value))
          }
          placeholder={schema.description ?? label}
          className="h-9 w-full border border-border bg-background px-3 font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        {schema.description && (
          <p className="text-[11px] text-muted-foreground">{schema.description}</p>
        )}
      </div>
    )
  }

  // Object → nested fields or JSON textarea
  if (type === 'object' && schema.properties) {
    const obj = (value as Record<string, unknown>) ?? {}
    return (
      <div className={cn('space-y-3', depth > 0 && 'pl-3 border-l border-border/50')}>
        <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          {label} {required && <span className="text-destructive">*</span>}
        </label>
        {Object.entries(schema.properties).map(([k, sub]) => (
          <FieldRenderer
            key={k}
            name={k}
            schema={sub}
            value={obj[k]}
            onChange={(v) => onChange({ ...obj, [k]: v })}
            required={schema.required?.includes(k)}
            depth={depth + 1}
          />
        ))}
      </div>
    )
  }

  // Object without properties → JSON textarea
  if (type === 'object') {
    const strVal = value === undefined ? '' : JSON.stringify(value, null, 2)
    return (
      <div className="space-y-1">
        <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          {label} (JSON) {required && <span className="text-destructive">*</span>}
        </label>
        <textarea
          value={strVal}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value))
            } catch {
              onChange(e.target.value)
            }
          }}
          rows={4}
          placeholder="{}"
          className="w-full border border-border bg-background px-3 py-2 font-mono text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
        />
      </div>
    )
  }

  // Array → JSON textarea
  if (type === 'array') {
    const strVal = value === undefined ? '' : JSON.stringify(value, null, 2)
    return (
      <div className="space-y-1">
        <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          {label} (JSON array) {required && <span className="text-destructive">*</span>}
        </label>
        <textarea
          value={strVal}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value))
            } catch {
              onChange(e.target.value)
            }
          }}
          rows={3}
          placeholder="[]"
          className="w-full border border-border bg-background px-3 py-2 font-mono text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
        />
      </div>
    )
  }

  // Default → string input
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      <input
        type="text"
        value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        placeholder={schema.description ?? label}
        className="h-9 w-full border border-border bg-background px-3 font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
      />
      {schema.description && (
        <p className="text-[11px] text-muted-foreground">{schema.description}</p>
      )}
    </div>
  )
}

// ─── Result Display ───────────────────────────────────────────────────────────

function ResultPanel({ result }: { result: unknown }) {
  const [copied, setCopied] = useState(false)
  const [pretty, setPretty] = useState(true)

  const formatted =
    typeof result === 'string'
      ? result
      : pretty
        ? JSON.stringify(result, null, 2)
        : JSON.stringify(result)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(formatted)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          Result
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPretty((p) => !p)}
            className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            {pretty ? 'COMPACT' : 'PRETTY'}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            COPY
          </button>
        </div>
      </div>
      <pre className="max-h-64 overflow-auto rounded-[2px] border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
        {formatted}
      </pre>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ToolRunnerModal({ open, onOpenChange, serverId, tool }: ToolRunnerModalProps) {
  const { address, publicKey, isConnected, connectWallet, isConnecting } = useX402Wallet()

  const [args, setArgs] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [ran, setRan] = useState(false)

  // x402 payment state
  const [payment, setPayment] = useState<PaymentRequirement | null>(null)
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('pending')
  const [paymentError, setPaymentError] = useState<string | undefined>()
  const [paymentErrorCode, setPaymentErrorCode] = useState<string | undefined>()
  const [paymentTxid, setPaymentTxid] = useState<string | undefined>()
  // Store the args for retry after payment
  const [pendingArgs, setPendingArgs] = useState<Record<string, unknown> | null>(null)

  const handleArgChange = useCallback((key: string, val: unknown) => {
    setArgs((prev) => ({ ...prev, [key]: val }))
  }, [])

  // ─── Core MCP call (reused by initial run + post-payment retry) ──────────

  async function callTool(
    cleanArgs: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ): Promise<{ ok: boolean; status: number; data: unknown; headers: Headers }> {
    const res = await fetch(`${GATEWAY_URL}/mcp?id=${encodeURIComponent(serverId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...extraHeaders,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool!.name, arguments: cleanArgs },
      }),
    })

    const ct = res.headers.get('content-type') ?? ''
    let data: unknown

    if (ct.includes('text/event-stream')) {
      const text = await res.text()
      for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue
        try { data = JSON.parse(line.slice(5).trim()); break } catch {}
      }
    } else {
      data = await res.json()
    }

    return { ok: res.ok, status: res.status, data, headers: res.headers }
  }

  // ─── Initial run ─────────────────────────────────────────────────────────

  const handleRun = async () => {
    if (!tool) return
    setLoading(true)
    setError(null)
    setResult(null)
    setRan(false)
    setPayment(null)
    setPaymentStatus('pending')
    setPaymentError(undefined)
    setPaymentErrorCode(undefined)
    setPaymentTxid(undefined)
    setPendingArgs(null)

    const cleanArgs: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(args)) {
      if (v !== undefined && v !== '') cleanArgs[k] = v
    }

    try {
      const { status, data, headers } = await callTool(cleanArgs)

      if (status === 402) {
        // Parse V2 payment requirement from header
        const paymentRequiredHeader = headers.get('payment-required')
        if (paymentRequiredHeader) {
          try {
            const decoded = JSON.parse(atob(paymentRequiredHeader)) as PaymentRequirement
            setPayment(decoded)
            setPendingArgs(cleanArgs)
          } catch {
            setError('Payment required but could not parse payment details.')
          }
        } else {
          setError('Payment required — connect your wallet to continue.')
        }
        return
      }

      processRpcResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  // ─── Handle wallet payment approval ──────────────────────────────────────

  const handlePaymentApprove = async (tokenType: string) => {
    if (!payment || !pendingArgs || !address || !publicKey) return
    setPaymentStatus('signing')
    setPaymentError(undefined)
    setPaymentErrorCode(undefined)

    try {
      // 1. Find the selected accept option from the V2 accepts array
      const selectedAccept = payment.accepts.find((a) => a.asset === tokenType) ?? payment.accepts[0]
      if (!selectedAccept) throw new Error(`No payment option found for token ${tokenType}`)

      // 2. Build unsigned sponsored transaction
      const unsignedHex = await buildUnsignedPaymentTx({
        publicKey,
        senderAddress: address,
        recipient: selectedAccept.payTo,
        amount: selectedAccept.amount,
        tokenType,
        network: selectedAccept.network,
      })

      // 3. Prompt wallet to sign (broadcast: false — relay handles broadcast)
      const signResult = await request('stx_signTransaction', {
        transaction: unsignedHex,
        broadcast: false,
      })

      setPaymentStatus('approved')

      // 4. Build V2 payment-signature: base64(JSON(PaymentPayloadV2))
      const signedHex: string = (signResult as { transaction?: string }).transaction ?? unsignedHex
      const paymentSig = buildPaymentSignature(selectedAccept, signedHex)

      // 5. Retry tool call with V2 payment-signature (no payment-id)
      const { status, data, headers } = await callTool(pendingArgs, {
        'payment-signature': paymentSig,
      })

      if (status === 200 || status === 201) {
        // Extract txid from payment-response header (V2: { success, transaction, payer, network })
        const paymentResponseHeader = headers.get('payment-response')
        if (paymentResponseHeader) {
          try {
            const pr = JSON.parse(atob(paymentResponseHeader)) as { transaction?: string }
            if (pr.transaction) setPaymentTxid(pr.transaction)
          } catch {}
        }
        setPaymentStatus('settled')
        processRpcResult(data)
        setRan(true)
      } else if (status === 402) {
        // Another 402 after payment — payment verification failed
        const errData = data as { code?: string; error?: string }
        setPaymentStatus('error')
        setPaymentError(errData?.error ?? 'Payment verification failed')
        setPaymentErrorCode(errData?.code)
      } else {
        setPaymentStatus('error')
        setPaymentError(`Tool call failed after payment: HTTP ${status}`)
      }
    } catch (err) {
      // User rejected wallet signing or tx build error
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('user denied')) {
        setPaymentStatus('rejected')
      } else {
        setPaymentStatus('error')
        setPaymentError(msg)
      }
    }
  }

  const handlePaymentReject = () => {
    setPaymentStatus('rejected')
  }

  // ─── Parse MCP RPC result ─────────────────────────────────────────────────

  function processRpcResult(data: unknown) {
    const rpc = data as { result?: { content?: Array<{ type: string; text?: string }> }; error?: { message: string } }
    if (rpc?.error) {
      setError(rpc.error.message)
    } else if (rpc?.result?.content) {
      const text = rpc.result.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n')
      try {
        setResult(JSON.parse(text))
      } catch {
        setResult(text)
      }
      setRan(true)
    } else {
      setResult(rpc?.result ?? data)
      setRan(true)
    }
  }

  const handleReset = () => {
    setArgs({})
    setResult(null)
    setError(null)
    setRan(false)
    setPayment(null)
    setPaymentStatus('pending')
    setPaymentError(undefined)
    setPaymentErrorCode(undefined)
    setPaymentTxid(undefined)
    setPendingArgs(null)
  }

  if (!tool) return null

  const schema = tool.inputSchema
  const properties = schema?.properties ?? {}
  const required = schema?.required ?? []
  const hasParams = Object.keys(properties).length > 0
  const isPaid = tool.price > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden rounded-[2px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="font-mono text-base font-bold text-primary">
                {tool.name}
              </DialogTitle>
              {tool.description && (
                <p className="text-xs text-muted-foreground mt-1">{tool.description}</p>
              )}
            </div>
            <div className="shrink-0">
              {!isPaid ? (
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-green-600 dark:text-green-400 bg-green-500/10 px-2 py-1 rounded-[2px]">
                  FREE
                </span>
              ) : (
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-amber-600 bg-amber-500/10 px-2 py-1 rounded-[2px]">
                  {formatUsdPrice(tool.price)}
                </span>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Wallet connect prompt for paid tools */}
          {isPaid && !isConnected && (
            <div className="rounded-[2px] border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-center justify-between gap-3">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Connect your wallet to pay for this tool.
              </p>
              <button
                type="button"
                onClick={connectWallet}
                disabled={isConnecting}
                className="flex shrink-0 items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-primary hover:underline disabled:opacity-50"
              >
                {isConnecting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Wallet className="h-3 w-3" />
                )}
                {isConnecting ? 'CONNECTING…' : 'CONNECT'}
              </button>
            </div>
          )}

          {/* Params */}
          {!payment && (
            <>
              {hasParams ? (
                <div className="space-y-4">
                  <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                    Parameters
                  </span>
                  {Object.entries(properties).map(([key, subSchema]) => (
                    <FieldRenderer
                      key={key}
                      name={key}
                      schema={subSchema}
                      value={args[key]}
                      onChange={(v) => handleArgChange(key, v)}
                      required={required.includes(key)}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  This tool takes no parameters.
                </p>
              )}
            </>
          )}

          {/* Payment UI — shown when 402 received */}
          {payment && (
            <PaymentCard
              toolName={tool.name}
              payment={payment}
              status={paymentStatus}
              error={paymentError}
              errorCode={paymentErrorCode}
              txid={paymentTxid}
              onApprove={handlePaymentApprove}
              onReject={handlePaymentReject}
            />
          )}

          {/* Error (non-payment) */}
          {error && (
            <div className="rounded-[2px] border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive font-mono">
              {error}
            </div>
          )}

          {/* Result */}
          {ran && result !== null && <ResultPanel result={result} />}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={ran || payment ? handleReset : () => onOpenChange(false)}
            className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            {ran || payment ? (
              <span className="flex items-center gap-1.5">
                <RefreshCw className="h-3 w-3" />
                {ran ? 'NEW QUERY' : 'START OVER'}
              </span>
            ) : (
              'CANCEL'
            )}
          </button>

          {/* Only show Run button when no payment pending */}
          {!payment && (
            <button
              type="button"
              onClick={handleRun}
              disabled={loading || (isPaid && !isConnected)}
              className="h-9 px-6 text-[10px] font-mono font-bold uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loading ? 'RUNNING…' : ran ? 'RUN AGAIN' : 'RUN TOOL'}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
