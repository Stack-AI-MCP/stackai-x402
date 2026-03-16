import { Hono } from 'hono'
import type { Context } from 'hono'
import { X402PaymentVerifier, networkToCAIP2 } from 'x402-stacks'
import type { PaymentPayloadV2, PaymentRequiredV2, PaymentRequirementsV2, SettlementResponseV2 } from 'x402-stacks'
import { usdToMicro, decrypt } from 'stackai-x402/internal'
import type { AppEnv } from '../app.js'
import type { ServerConfig, IntrospectedTool } from '../services/registration.service.js'
import { enqueuePaymentNotification } from '../services/notification.service.js'
import { logTransaction } from '../services/agent.service.js'
import type { TransactionRecord } from '../services/agent.service.js'
import type { Hook, RequestContext } from 'stackai-x402/hooks'

// ─── Types ────────────────────────────────────────────────────────────────────

interface JsonRpcBody {
  jsonrpc?: string
  id?: number | string
  method: string
  params?: unknown
}

/** Injectable settle function — defaults to X402PaymentVerifier in production, can be overridden in tests. */
export type SettleFunction = (
  payload: PaymentPayloadV2,
  requirements: PaymentRequirementsV2,
) => Promise<SettlementResponseV2>

// ─── Upstream forwarding ──────────────────────────────────────────────────────

async function callUpstream(
  body: JsonRpcBody,
  config: ServerConfig,
  upstreamAuthHeader: string | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }

  if (upstreamAuthHeader) {
    headers['Authorization'] = upstreamAuthHeader
  }

  const upstreamRes = await fetch(config.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })

  const responseBody = await upstreamRes.text()
  return new Response(responseBody, {
    status: upstreamRes.status,
    headers: {
      'Content-Type': upstreamRes.headers.get('content-type') ?? 'application/json',
    },
  })
}

// ─── Hook firing ──────────────────────────────────────────────────────────────

function fireHooks(hooks: Hook[], ctx: RequestContext): void {
  for (const hook of hooks) {
    setImmediate(() => hook.onRequest(ctx).catch((err) => {
      console.warn('[hook] error (non-fatal):', err instanceof Error ? err.message : err)
    }))
  }
}

// ─── Shared handler ───────────────────────────────────────────────────────────

export async function handleProxy(c: Context<AppEnv>, serverId: string): Promise<Response> {
  const redis = c.get('redis')
  const tokenPrices = c.get('tokenPrices')
  const encryptionKey = c.get('encryptionKey')
  const hooks = c.get('hooks')
  const settleOverride = c.get('settlePayment')
  const startTime = Date.now()
  const timestamp = new Date().toISOString()

  // ── Parse JSON-RPC body first ────────────────────────────────────────────
  let body: JsonRpcBody
  try {
    body = (await c.req.json()) as JsonRpcBody
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_REQUEST' }, 400)
  }

  // ── Load server config + tools from Redis ────────────────────────────────
  const [configJson, toolsJson] = await Promise.all([
    redis.get(`server:${serverId}:config`),
    redis.get(`server:${serverId}:tools`),
  ])

  if (!configJson) {
    return c.json({ error: 'Server not found', code: 'SERVER_NOT_FOUND' }, 404)
  }

  let config: ServerConfig
  let tools: IntrospectedTool[]
  try {
    config = JSON.parse(configJson) as ServerConfig
    tools = toolsJson ? (JSON.parse(toolsJson) as IntrospectedTool[]) : []
  } catch {
    return c.json({ error: 'Server data is corrupted', code: 'INTERNAL_ERROR' }, 500)
  }

  const network: 'mainnet' | 'testnet' = config.network ?? 'mainnet'
  const relayUrl = network === 'testnet' ? c.get('testnetRelayUrl') : c.get('relayUrl')

  if (config.status === 'disabled') {
    return c.json({ error: 'Endpoint disabled', code: 'ENDPOINT_DISABLED' }, 503)
  }

  redis.set(`server:${serverId}:lastSeen`, new Date().toISOString(), 'EX', 2_592_000).catch(() => {})

  // ── Find tool ──────────────────────────────────────────────────────────────
  let toolName = body.method
  if (body.method === 'tools/call' && body.params && typeof body.params === 'object') {
    toolName = (body.params as any).name
  }

  const tool = tools.find((t) => t.name === toolName)
  if (!tool) {
    return c.json({ error: `Tool '${toolName}' not found`, code: 'TOOL_NOT_FOUND' }, 404)
  }

  // ── Decrypt upstream auth header ─────────────────────────────────────────
  let upstreamAuthHeader: string | undefined
  if (config.encryptedAuth) {
    try {
      upstreamAuthHeader = `Bearer ${decrypt(config.encryptedAuth, encryptionKey)}`
    } catch (err) {
      console.error(`Failed to decrypt upstream auth for server ${serverId}:`, err instanceof Error ? err.message : err)
      return c.json({ error: 'Internal configuration error', code: 'INTERNAL_ERROR' }, 500)
    }
  }

  // ── 402 gate / payment verification ───────────────────────────────────────
  if (tool.price > 0) {
    const paymentSig = c.req.header('payment-signature')

    if (!paymentSig) {
      // No payment yet — issue 402 with V2 Coinbase-compatible payment requirements
      const caip2 = networkToCAIP2(network)

      // Build one PaymentRequirementsV2 entry per accepted token.
      // Filter out tokens where the USD amount is too small to represent
      // (e.g. $0.0001 in sBTC at $100k rounds to 0 satoshis).
      const accepts: PaymentRequirementsV2[] = config.acceptedTokens
        .map((token) => ({
          scheme: 'exact' as const,
          network: caip2,
          amount: usdToMicro(tool.price, token, tokenPrices[token]).toString(),
          asset: token,
          payTo: config.recipientAddress,
          maxTimeoutSeconds: 300,
        }))
        .filter((entry) => entry.amount !== '0')

      const paymentRequired: PaymentRequiredV2 = {
        x402Version: 2,
        resource: { url: c.req.url },
        accepts,
      }

      c.header('payment-required', Buffer.from(JSON.stringify(paymentRequired)).toString('base64'))
      return c.json({ error: 'Payment required', code: 'PAYMENT_REQUIRED' }, 402)
    }

    // Payment signature present — decode PaymentPayloadV2
    let paymentPayload: PaymentPayloadV2
    try {
      const decoded = Buffer.from(paymentSig, 'base64').toString('utf-8')
      paymentPayload = JSON.parse(decoded) as PaymentPayloadV2
    } catch {
      return c.json({ error: 'Invalid payment-signature: must be base64-encoded PaymentPayloadV2 JSON', code: 'INVALID_REQUEST' }, 400)
    }

    // Reject zero-amount payments early (e.g. sBTC at very low USD prices)
    if (!paymentPayload.accepted?.amount || paymentPayload.accepted.amount === '0') {
      return c.json({ error: 'Payment amount is zero — choose a different token', code: 'AMOUNT_INSUFFICIENT' }, 402)
    }

    // Settle payment by verifying the broadcast txid on Hiro API.
    // The wallet signs and broadcasts the tx directly (non-sponsored, pays its own fee).
    // We verify the txid is in the mempool and matches the expected recipient + amount.
    const doSettle: SettleFunction = settleOverride ?? (async (payload, requirements) => {
      const txid = ((payload.payload as unknown) as Record<string, unknown>)?.txid as string | undefined
      if (!txid) throw new Error('Missing txid in payment payload')

      const hinapiBase = network === 'testnet'
        ? 'https://api.testnet.hiro.so'
        : 'https://api.hiro.so'

      console.log(`[x402] Verifying txid ${txid} | token=${requirements.asset} amount=${requirements.amount} payTo=${requirements.payTo}`)

      // Wait up to 10s for the tx to appear in the mempool
      let tx: Record<string, unknown> | null = null
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await fetch(`${hinapiBase}/extended/v1/tx/${txid}`, {
          signal: AbortSignal.timeout(10_000),
        })
        if (res.ok) {
          tx = await res.json() as Record<string, unknown>
          break
        }
        if (attempt < 4) await new Promise((r) => setTimeout(r, 2_000))
      }

      if (!tx) {
        console.log(`[x402] Txid ${txid} not found in mempool after retries`)
        return { success: false, errorReason: 'Transaction not found in mempool', transaction: '', network: requirements.network } as SettlementResponseV2
      }

      const txStatus = tx.tx_status as string
      if (txStatus !== 'pending' && txStatus !== 'success') {
        console.log(`[x402] Txid ${txid} has unexpected status: ${txStatus}`)
        return { success: false, errorReason: `Transaction status: ${txStatus}`, transaction: '', network: requirements.network } as SettlementResponseV2
      }

      const tokenType = requirements.asset ?? 'STX'
      const sender = tx.sender_address as string ?? ''

      if (tokenType === 'STX') {
        const transfer = tx.token_transfer as Record<string, unknown> | undefined
        if (!transfer) return { success: false, errorReason: 'Not a STX transfer', transaction: '', network: requirements.network } as SettlementResponseV2
        if (transfer.recipient_address !== requirements.payTo) {
          console.log(`[x402] Wrong recipient: ${transfer.recipient_address} != ${requirements.payTo}`)
          return { success: false, errorReason: 'Wrong payment recipient', transaction: '', network: requirements.network } as SettlementResponseV2
        }
        if (BigInt(transfer.amount as string ?? '0') < BigInt(requirements.amount)) {
          console.log(`[x402] Insufficient amount: ${transfer.amount} < ${requirements.amount}`)
          return { success: false, errorReason: 'Insufficient payment amount', transaction: '', network: requirements.network } as SettlementResponseV2
        }
      } else {
        // SIP-010 token (sBTC, USDCx): verify via contract_call function args
        // transfer(amount uint, sender principal, recipient principal, memo optional)
        const call = tx.contract_call as Record<string, unknown> | undefined
        const args = call?.function_args as Array<Record<string, unknown>> | undefined
        if (!args || args.length < 3) return { success: false, errorReason: 'Not a SIP-010 transfer', transaction: '', network: requirements.network } as SettlementResponseV2
        const recipientRepr = args[2]?.repr as string ?? ''
        const recipientAddr = recipientRepr.startsWith("'") ? recipientRepr.slice(1) : recipientRepr
        if (recipientAddr !== requirements.payTo) {
          console.log(`[x402] Wrong token recipient: ${recipientAddr} != ${requirements.payTo}`)
          return { success: false, errorReason: 'Wrong payment recipient', transaction: '', network: requirements.network } as SettlementResponseV2
        }
        const amountRepr = args[0]?.repr as string ?? '0'
        const paidAmount = BigInt(amountRepr.replace(/^u/, ''))
        if (paidAmount < BigInt(requirements.amount)) {
          console.log(`[x402] Insufficient token amount: ${paidAmount} < ${requirements.amount}`)
          return { success: false, errorReason: 'Insufficient payment amount', transaction: '', network: requirements.network } as SettlementResponseV2
        }
      }

      console.log(`[x402] Payment verified: txid=${txid} sender=${sender}`)
      return { success: true, payer: sender, transaction: txid, network: requirements.network } as SettlementResponseV2
    })

    let settlement: SettlementResponseV2
    try {
      settlement = await doSettle(paymentPayload, paymentPayload.accepted)
    } catch (err) {
      console.error(`[x402] Relay error for server ${serverId}:`, err instanceof Error ? err.message : err)
      return c.json({ error: 'Relay unavailable', code: 'RELAY_UNAVAILABLE' }, 503)
    }

    if (!settlement.success) {
      return c.json({ error: settlement.errorReason ?? 'Payment verification failed', code: 'PAYMENT_FAILED' }, 402)
    }

    // Dedup by txid — atomic NX; Stacks nonce prevents chain-level replay
    const txid = settlement.transaction
    const nx = await redis.set(`payment:${txid}`, 'used', 'NX', 'EX', 2_592_000)
    if (nx === null) {
      return c.json({ error: 'Payment already processed', code: 'REPLAY_DETECTED' }, 402)
    }

    const paidToken = paymentPayload.accepted.asset
    const paidAmount = paymentPayload.accepted.amount
    const senderAddress = settlement.payer ?? ''
    const chain = network === 'mainnet' ? 'mainnet' : 'testnet'
    const explorerUrl = `https://explorer.hiro.so/txid/${txid}?chain=${chain}`

    // Forward to upstream
    let upstreamRes: Response
    try {
      upstreamRes = await callUpstream(body, config, upstreamAuthHeader)
    } catch (err) {
      fireHooks(hooks, {
        serverId, toolName, payer: senderAddress, txid,
        amount: paidAmount, token: paidToken, success: false,
        durationMs: Date.now() - startTime, timestamp,
      })
      console.error(`Upstream error after payment [${serverId}]:`, err instanceof Error ? err.message : err)
      return c.json({ error: 'Upstream failed', code: 'UPSTREAM_ERROR', txid, explorerUrl }, 502)
    }

    if (!upstreamRes.ok) {
      fireHooks(hooks, {
        serverId, toolName, payer: senderAddress, txid,
        amount: paidAmount, token: paidToken, success: false,
        durationMs: Date.now() - startTime, timestamp,
      })
      return c.json({ error: 'Upstream failed', code: 'UPSTREAM_ERROR', txid, explorerUrl }, 502)
    }

    // Success — attach payment-response header
    const paymentResponse = Buffer.from(JSON.stringify({ txid, explorerUrl })).toString('base64')
    const response = new Response(await upstreamRes.text(), {
      status: upstreamRes.status,
      headers: {
        'Content-Type': upstreamRes.headers.get('content-type') ?? 'application/json',
        'payment-response': paymentResponse,
      },
    })

    setImmediate(() => {
      enqueuePaymentNotification(redis, {
        serverId, tool: toolName, amount: paidAmount,
        token: paidToken, fromAddress: senderAddress, txid,
      }).catch(() => {})

      logTransaction({
        id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        status: 'settled', serverId, serverName: config.name,
        toolName, amount: paidAmount, token: paidToken,
        network, payer: senderAddress, txHash: txid, timestamp,
      }, { redis }).catch(() => {})
    })

    fireHooks(hooks, {
      serverId,
      toolName,
      payer: senderAddress,
      txid,
      amount: paidAmount,
      token: paidToken,
      success: true,
      durationMs: Date.now() - startTime,
      timestamp,
    })

    return response
  }

  // ── Free tool: forward directly to upstream ────────────────────────────────
  try {
    const freeRes = await callUpstream(body, config, upstreamAuthHeader)
    fireHooks(hooks, {
      serverId,
      toolName,
      success: freeRes.ok,
      durationMs: Date.now() - startTime,
      timestamp,
    })
    return freeRes
  } catch (err) {
    fireHooks(hooks, {
      serverId,
      toolName,
      success: false,
      durationMs: Date.now() - startTime,
      timestamp,
    })
    console.error(`Upstream error [${serverId}]:`, err instanceof Error ? err.message : err)
    return c.json({ error: 'Upstream unavailable', code: 'UPSTREAM_ERROR' }, 502)
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const proxyRouter = new Hono<AppEnv>()

proxyRouter.post('/:serverId', (c) => handleProxy(c, c.req.param('serverId')))
proxyRouter.post('/:serverId/*', (c) => handleProxy(c, c.req.param('serverId')))
