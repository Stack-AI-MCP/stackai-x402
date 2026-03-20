'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { Suspense, useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Loader2, Bot, CheckCircle2 } from 'lucide-react'
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
import { ChatMessage, ChatMessageText } from '@/components/chat/chat-message'
import { ChatMessages } from '@/components/chat/chat-messages'
import { ChatEmptyState } from '@/components/chat/chat-empty-state'
import { ToolResult, ToolCallCard } from '@/components/chat/chat-tool-result'

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
        } catch {
          setPaymentStatuses((prev) => ({
            ...prev,
            [toolCallId]: {
              status: 'error',
              error: 'Failed to build transaction — check your network connection',
            },
          }))
          return
        }

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

        const payloadV2 = { x402Version: 2, accepted: selectedAccept, payload: { txid } }
        const paymentSignature = btoa(JSON.stringify(payloadV2))

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

  const displayName = agentConfig?.name ?? serverName ?? 'Chat'

  return (
    <div className="flex flex-col h-[calc(100dvh-6.5rem)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
        <div>
          <h1 className="text-lg font-semibold">{displayName}</h1>
          <p className="text-xs text-muted-foreground font-mono">Server: {serverId}</p>
        </div>
      </div>

      {/* Messages — min-h-0 is critical so flex child can scroll */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4">
        {messages.length === 0 ? (
          <ChatEmptyState
            title={displayName}
            starterPrompts={activeStarterPrompts}
            isLoading={isLoading}
            onSelectPrompt={(prompt) => {
              setInput('')
              sendMessage({
                role: 'user' as const,
                parts: [{ type: 'text' as const, text: prompt }],
              })
            }}
          />
        ) : null}

        <ChatMessages>
          {messages.map((message) => (
            <ChatMessage key={message.id} role={message.role as 'user' | 'assistant'}>
              {message.parts?.map((part, i) => {
                if (part.type === 'text') {
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
                    <ChatMessageText
                      key={`text-${i}`}
                      text={part.text}
                      role={message.role as 'user' | 'assistant'}
                    />
                  )
                }

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
                    <ToolCallCard key={toolCallId} toolName={toolName} isRunning={isRunning}>
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
                    </ToolCallCard>
                  )
                }

                return null
              })}
            </ChatMessage>
          ))}

          {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
            <ChatMessage role="assistant">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking...
              </div>
            </ChatMessage>
          )}

          <div ref={messagesEndRef} />
        </ChatMessages>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 rounded-xl border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive shrink-0">
          {error.message}
        </div>
      )}

      {/* Input area with gradient fade */}
      <div className="shrink-0 relative">
        <div className="absolute -top-8 inset-x-0 h-8 bg-gradient-to-t from-background via-background to-transparent pointer-events-none" />
        <div className="border-t border-border px-4 pt-3 pb-4 space-y-2">
          <div className="max-w-3xl mx-auto space-y-2">
            <ChatInput
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              isLoading={isLoading}
              placeholder="Ask about Stacks DeFi, sBTC, ALEX…"
            />
            <div className="flex items-center justify-end">
              <ModelSelector value={model} onChange={setModel} />
            </div>
          </div>
        </div>
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
