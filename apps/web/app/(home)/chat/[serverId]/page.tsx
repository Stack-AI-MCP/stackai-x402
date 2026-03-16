'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { Suspense, useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Loader2, Bot, User, Wrench, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'
import { request } from '@stacks/connect'
import { ModelSelector, DEFAULT_MODEL } from '@/components/x402/ModelSelector'
import { ChatInput } from '@/components/x402/ChatInput'
import {
  PaymentCard,
  type PaymentRequirement,
  type PaymentStatus,
} from '@/components/x402/PaymentCard'
import { useX402Wallet } from '@/hooks/use-x402-wallet'
import { buildUnsignedPaymentTx, broadcastSignedTx } from '@/lib/x402/build-payment-tx'
import type { AgentConfig } from '@/components/x402/AgentComposer'

interface PaymentStatusEntry {
  status: PaymentStatus
  error?: string
  errorCode?: string
  txid?: string
  toolResult?: unknown
}

function isPaymentOutput(output: unknown): output is {
  __paymentRequired: true
  toolName: string
  serverId: string
  payment: PaymentRequirement
  args: unknown
} {
  return (
    typeof output === 'object' &&
    output !== null &&
    (output as Record<string, unknown>).__paymentRequired === true
  )
}

// Collapsible tool result component — works for any MCP output shape
function ToolResult({ output }: { output: unknown }) {
  const [expanded, setExpanded] = useState(false)
  const formatted =
    typeof output === 'string' ? output : JSON.stringify(output, null, 2)
  const lines = formatted.split('\n')
  const isLong = lines.length > 6

  return (
    <div className="mt-2">
      <pre className={`whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed overflow-auto rounded-lg bg-background/60 p-2 ${isLong && !expanded ? 'max-h-[7rem]' : 'max-h-[32rem]'}`}>
        {formatted}
      </pre>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? 'collapse' : `show ${lines.length - 6} more lines`}
        </button>
      )}
    </div>
  )
}

function ChatPageInner() {
  const { serverId } = useParams<{ serverId: string }>()
  const searchParams = useSearchParams()
  const [model, setModel] = useState(DEFAULT_MODEL.id)
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef(model)
  modelRef.current = model
  const wallet = useX402Wallet()
  const [paymentStatuses, setPaymentStatuses] = useState<Record<string, PaymentStatusEntry>>({})
  const [serverName, setServerName] = useState<string | null>(null)

  // Fetch server name from agent card
  const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'
  useEffect(() => {
    fetch(`${GATEWAY_URL}/.well-known/agent.json?server=${encodeURIComponent(serverId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((card) => { if (card?.name) setServerName(card.name) })
      .catch(() => {})
  }, [serverId, GATEWAY_URL])

  // Decode agent config from ?agent= query param (set by Composer)
  const agentConfig = useMemo<AgentConfig | null>(() => {
    const encoded = searchParams.get('agent')
    if (!encoded) return null
    try {
      // Unicode-safe base64 decode: base64 → binary string → UTF-8 bytes → JSON
      const binStr = atob(encoded)
      const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0))
      return JSON.parse(new TextDecoder().decode(bytes)) as AgentConfig
    } catch {
      return null
    }
  }, [searchParams])

  // Apply model from agent config on first load
  useEffect(() => {
    if (agentConfig?.model) setModel(agentConfig.model)
  }, [agentConfig])

  const agentConfigRef = useRef(agentConfig)
  agentConfigRef.current = agentConfig

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: { serverId, model: modelRef.current },
        prepareSendMessagesRequest: ({ body, messages }) => ({
          body: {
            ...body,
            messages,
            model: modelRef.current,
            ...(agentConfigRef.current && {
              systemPrompt: agentConfigRef.current.systemPrompt,
              toolFilter: agentConfigRef.current.tools,
            }),
          },
        }),
      }),
    [serverId],
  )

  const { messages, sendMessage, status, error } = useChat({
    transport,
    maxSteps: 10,
  })

  const isLoading = status === 'submitted' || status === 'streaming'

  const handlePaymentApprove = useCallback(
    async (
      toolCallId: string,
      paymentData: {
        toolName: string
        serverId: string
        payment: PaymentRequirement
        args: unknown
      },
      tokenType: string,
    ) => {
      if (!wallet.address) {
        setPaymentStatuses((prev) => ({
          ...prev,
          [toolCallId]: { status: 'error', error: 'Wallet not connected' },
        }))
        return
      }

      // Find the selected accept option from the V2 accepts array
      const selectedAccept = paymentData.payment.accepts.find((a) => a.asset === tokenType)
        ?? paymentData.payment.accepts[0]
      if (!selectedAccept) {
        setPaymentStatuses((prev) => ({
          ...prev,
          [toolCallId]: { status: 'error', error: `Token ${tokenType} is no longer accepted` },
        }))
        return
      }

      setPaymentStatuses((prev) => ({
        ...prev,
        [toolCallId]: { status: 'signing' },
      }))

      try {
        // Get the verified signing public key (prompts wallet via stx_signMessage if not cached).
        let signingKey: string
        try {
          signingKey = await wallet.getSigningPublicKey()
        } catch {
          setPaymentStatuses((prev) => ({
            ...prev,
            [toolCallId]: { status: 'error', error: 'Wallet verification cancelled' },
          }))
          return
        }

        // Build unsigned tx with auto fee estimation
        let unsignedHex: string
        try {
          unsignedHex = await buildUnsignedPaymentTx({
            publicKey: signingKey,
            senderAddress: wallet.address,
            recipient: selectedAccept.payTo,
            amount: selectedAccept.amount,
            tokenType,
            network: selectedAccept.network,
          })
        } catch (buildErr) {
          setPaymentStatuses((prev) => ({
            ...prev,
            [toolCallId]: {
              status: 'error',
              error: 'Failed to build transaction — check your network connection',
            },
          }))
          return
        }

        // Wallet signs (broadcast: false) — we broadcast ourselves to get a real txid
        let signedHex: string
        try {
          const signResult = await request('stx_signTransaction', {
            transaction: unsignedHex,
            broadcast: false,
          })
          signedHex = signResult.transaction
        } catch {
          setPaymentStatuses((prev) => ({
            ...prev,
            [toolCallId]: { status: 'error', error: 'Payment cancelled' },
          }))
          return
        }

        // Broadcast to Stacks network via Hiro API to get the real txid
        let txid: string
        try {
          txid = await broadcastSignedTx(signedHex, selectedAccept.network)
        } catch (broadcastErr) {
          setPaymentStatuses((prev) => ({
            ...prev,
            [toolCallId]: {
              status: 'error',
              error: broadcastErr instanceof Error ? broadcastErr.message : 'Broadcast failed',
            },
          }))
          return
        }

        setPaymentStatuses((prev) => ({
          ...prev,
          [toolCallId]: { status: 'approved' },
        }))

        // Build V2 payment-signature with the real txid — gateway verifies via Hiro API
        const payloadV2 = { x402Version: 2, accepted: selectedAccept, payload: { txid } }
        const paymentSignature = btoa(JSON.stringify(payloadV2))

        // Send payment-signature to gateway via our pay API route
        const payRes = await fetch('/api/pay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serverId: paymentData.serverId,
            toolName: paymentData.toolName,
            args: paymentData.args,
            paymentSignature,
          }),
        })

        const result = await payRes.json()
        if (!payRes.ok) {
          // Wire error code from gateway (AC1: NETWORK_MISMATCH, AMOUNT_MISMATCH, etc.)
          setPaymentStatuses((prev) => ({
            ...prev,
            [toolCallId]: {
              status: 'error',
              error: result.error ?? 'Payment processing failed',
              errorCode: result.code,
            },
          }))
          return
        }

        setPaymentStatuses((prev) => ({
          ...prev,
          [toolCallId]: {
            status: 'settled',
            txid: result.txid,
            toolResult: result.toolResult,
          },
        }))

        wallet.refreshBalances()

        // Auto-continue: feed the real tool result back to the AI so it can respond naturally.
        // The system prompt instructs the AI to parse __paid_continue__ and answer directly.
        if (result.toolResult !== undefined) {
          const continuationText = `__paid_continue__ ${JSON.stringify({
            toolName: paymentData.toolName,
            result: result.toolResult,
          })}`
          sendMessage({
            role: 'user' as const,
            parts: [{ type: 'text' as const, text: continuationText }],
          })
        }
      } catch (err) {
        // Unexpected error (tx building, network, etc.)
        setPaymentStatuses((prev) => ({
          ...prev,
          [toolCallId]: {
            status: 'error',
            error: err instanceof Error ? err.message : 'Payment failed',
          },
        }))
      }
    },
    [wallet],
  )

  const handlePaymentReject = useCallback((toolCallId: string) => {
    setPaymentStatuses((prev) => ({
      ...prev,
      [toolCallId]: { status: 'rejected' },
    }))
  }, [])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = useCallback(() => {
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    sendMessage({ role: 'user' as const, parts: [{ type: 'text' as const, text }] })
  }, [input, isLoading, sendMessage])

  const defaultStarterPrompts = [
    "What's the current STX price?",
    'Show me ALEX DeFi pools',
    'How do I deposit sBTC?',
    'Explain Arkadiko lending',
  ]

  const activeStarterPrompts =
    agentConfig?.starterPrompts?.length ? agentConfig.starterPrompts : defaultStarterPrompts

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-3 shrink-0">
        <div>
          <h1 className="text-lg font-semibold">
            {agentConfig?.name ?? serverName ?? 'Chat'}
          </h1>
          <p className="text-xs text-muted-foreground">Server: {serverId}</p>
        </div>
      </div>

      {/* Messages — min-h-0 is critical so flex child can scroll */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-8 px-4">
            {/* Empty state hero */}
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <h2 className="font-semibold">
                {agentConfig?.name ?? serverName ?? 'Chat'}
              </h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                Ask anything — free tools run instantly, paid tools show a payment prompt before executing.
              </p>
            </div>
            {/* Starter prompts grid */}
            <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
              {activeStarterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={isLoading}
                  onClick={() => {
                    setInput('')
                    sendMessage({
                      role: 'user' as const,
                      parts: [{ type: 'text' as const, text: prompt }],
                    })
                  }}
                  className="rounded-xl border border-border bg-card/50 p-3 text-left text-xs hover:border-primary/40 hover:bg-card card-glow disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-4 py-4">
          {messages.map((message) => (
            <div key={message.id} className="flex gap-3">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                  message.role === 'user'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {message.role === 'user' ? (
                  <User className="h-4 w-4" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-2">
                {message.parts?.map((part, i) => {
                  if (part.type === 'text') {
                    // Hide __paid_continue__ messages from the visible chat —
                    // show a compact "payment settled" chip instead
                    if (part.text.startsWith('__paid_continue__')) {
                      return (
                        <div
                          key={`sys-${i}`}
                          className="inline-flex items-center gap-1.5 rounded-full bg-teal-500/10 px-3 py-1 text-[11px] font-mono text-teal-500"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          payment settled — processing result…
                        </div>
                      )
                    }
                    return (
                      <div key={`text-${i}`} className="whitespace-pre-wrap text-sm leading-relaxed">
                        {part.text}
                      </div>
                    )
                  }

                  // Tool parts follow `tool-{name}` pattern
                  if (part.type.startsWith('tool-')) {
                    const toolName = part.type.replace(/^tool-/, '')
                    const toolCallId =
                      'toolCallId' in part ? (part.toolCallId as string) : `tool-${i}`
                    const state = 'state' in part ? (part.state as string) : ''
                    const isRunning =
                      state === 'input-available' || state === 'input-streaming'
                    const hasOutput = state === 'output-available' && 'output' in part
                    const hasError = state === 'output-error' && 'errorText' in part
                    const isUnknown = !isRunning && !hasOutput && !hasError && state !== ''

                    return (
                      <div
                        key={toolCallId}
                        className="rounded-xl border border-border bg-muted/20 p-3"
                      >
                        <div className="flex items-center gap-2 text-xs font-mono font-medium text-muted-foreground">
                          <Wrench className="h-3 w-3 text-primary/60" />
                          <span className="text-primary/80">{toolName}</span>
                          {isRunning && (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span className="text-[10px]">running…</span>
                            </>
                          )}
                        </div>

                        {hasOutput && (() => {
                          const output = (part as { output: unknown }).output
                          if (isPaymentOutput(output)) {
                            const entry = paymentStatuses[toolCallId]
                            return (
                              <div className="mt-2">
                                <PaymentCard
                                  toolName={output.toolName}
                                  payment={output.payment}
                                  status={entry?.status ?? 'pending'}
                                  error={entry?.error}
                                  errorCode={entry?.errorCode}
                                  txid={entry?.txid}
                                  onApprove={(token) =>
                                    handlePaymentApprove(toolCallId, output, token)
                                  }
                                  onReject={() => handlePaymentReject(toolCallId)}
                                />
                              </div>
                            )
                          }
                          // Free tool result — collapsible JSON viewer
                          return <ToolResult output={output} />
                        })()}

                        {hasError && (
                          <div className="mt-2 text-xs text-destructive">
                            {(part as { errorText: string }).errorText}
                          </div>
                        )}

                        {isUnknown && (
                          <div className="mt-2 text-xs text-muted-foreground">
                            Tool timed out or returned no result.
                          </div>
                        )}
                      </div>
                    )
                  }

                  return null
                })}
              </div>
            </div>
          ))}

          {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Bot className="h-4 w-4" />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-2 rounded-xl border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive shrink-0">
          {error.message}
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-end">
          <ModelSelector value={model} onChange={setModel} />
        </div>
        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          placeholder="Ask about Stacks DeFi, sBTC, ALEX…"
        />
      </div>
    </div>
  )
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  )
}
