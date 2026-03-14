'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { Suspense, useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Send, Loader2, Bot, User, Wrench } from 'lucide-react'
import { request } from '@stacks/connect'
import { ModelSelector, DEFAULT_MODEL } from '@/components/x402/ModelSelector'
import {
  PaymentCard,
  type PaymentRequirement,
  type PaymentStatus,
} from '@/components/x402/PaymentCard'
import { useX402Wallet } from '@/hooks/use-x402-wallet'
import { buildUnsignedPaymentTx } from '@/lib/x402/build-payment-tx'
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
        prepareSendMessagesRequest: ({ body }) => ({
          body: {
            ...body,
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
      if (!wallet.address || !wallet.publicKey) {
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
        // Build unsigned sponsored tx (fee=0, relay pays gas)
        let unsignedHex: string
        try {
          unsignedHex = await buildUnsignedPaymentTx({
            publicKey: wallet.publicKey,
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

        // Sign with wallet (no broadcast — relay handles that)
        // AC4/FR28: wallet cancel → no charge, no broadcast
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

        setPaymentStatuses((prev) => ({
          ...prev,
          [toolCallId]: { status: 'approved' },
        }))

        // Build V2 payment-signature: base64(JSON(PaymentPayloadV2))
        const payloadV2 = { x402Version: 2, accepted: selectedAccept, payload: { transaction: signedHex } }
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

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const text = input.trim()
      if (!text || isLoading) return
      setInput('')
      sendMessage({ role: 'user' as const, parts: [{ type: 'text' as const, text }] })
    },
    [input, isLoading, sendMessage],
  )

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <h1 className="text-lg font-semibold">
            {agentConfig?.name ?? 'Chat'}
          </h1>
          <p className="text-xs text-muted-foreground">Server: {serverId}</p>
        </div>
        <ModelSelector value={model} onChange={setModel} />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <p className="text-sm text-muted-foreground">
              {agentConfig
                ? `Start chatting with ${agentConfig.name}`
                : 'Send a message to start chatting with this server\u2019s tools.'}
            </p>
            {agentConfig?.starterPrompts && agentConfig.starterPrompts.length > 0 && (
              <div className="w-full max-w-md space-y-2">
                {agentConfig.starterPrompts.map((prompt) => (
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
                    className="block w-full rounded-md border border-border p-3 text-left text-sm transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
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
                    return (
                      <div key={`text-${i}`} className="whitespace-pre-wrap text-sm">
                        {part.text}
                      </div>
                    )
                  }

                  // Tool parts follow `tool-{name}` pattern (same as components/message.tsx)
                  if (part.type.startsWith('tool-')) {
                    const toolName = part.type.replace(/^tool-/, '')
                    const toolCallId =
                      'toolCallId' in part ? (part.toolCallId as string) : `tool-${i}`
                    const state = 'state' in part ? (part.state as string) : ''
                    const isRunning =
                      state === 'input-available' || state === 'input-streaming'
                    const hasOutput = state === 'output-available' && 'output' in part
                    const hasError = state === 'output-error' && 'errorText' in part

                    return (
                      <div
                        key={toolCallId}
                        className="rounded-md border border-border bg-muted/30 p-3"
                      >
                        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <Wrench className="h-3 w-3" />
                          {toolName}
                          {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
                        </div>

                        {hasOutput && (() => {
                          const output = (part as { output: unknown }).output
                          if (isPaymentOutput(output)) {
                            const entry = paymentStatuses[toolCallId]
                            return (
                              <>
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
                                {entry?.toolResult && (
                                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                                    {typeof entry.toolResult === 'string'
                                      ? entry.toolResult
                                      : JSON.stringify(entry.toolResult, null, 2)}
                                  </pre>
                                )}
                              </>
                            )
                          }
                          return (
                            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                              {typeof output === 'string'
                                ? output
                                : JSON.stringify(output, null, 2)}
                            </pre>
                          )
                        })()}

                        {hasError && (
                          <div className="mt-2 text-xs text-destructive">
                            Error: {(part as { errorText: string }).errorText}
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
        <div className="mb-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
          {error.message}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border pt-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask something..."
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          aria-label="Send message"
          className="rounded-md bg-primary px-3 py-2 text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
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
