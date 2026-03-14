import { Hono } from 'hono'
import type { Context } from 'hono'
import { X402PaymentVerifier, networkToCAIP2 } from 'x402-stacks'
import type { PaymentPayloadV2, PaymentRequiredV2, PaymentRequirementsV2, SettlementResponseV2 } from 'x402-stacks'
import { usdToMicro, decrypt } from 'stackai-x402/internal'
import type { AppEnv } from '../app.js'
import type { ServerConfig, IntrospectedTool } from '../services/registration.service.js'
import { enqueuePaymentNotification } from '../services/notification.service.js'
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

      // Build one PaymentRequirementsV2 entry per accepted token
      const accepts: PaymentRequirementsV2[] = config.acceptedTokens.map((token) => ({
        scheme: 'exact',
        network: caip2,
        amount: usdToMicro(tool.price, token, tokenPrices[token]).toString(),
        asset: token,
        payTo: config.recipientAddress,
        maxTimeoutSeconds: 300,
      }))

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

    // Settle payment via relay (X402PaymentVerifier or injected test override)
    const doSettle: SettleFunction = settleOverride ?? (async (payload, requirements) => {
      const verifier = new X402PaymentVerifier(relayUrl)
      return verifier.settle(payload, { paymentRequirements: requirements })
    })

    let settlement: SettlementResponseV2
    try {
      settlement = await doSettle(paymentPayload, paymentPayload.accepted)
    } catch (err) {
      console.error(`Relay error for server ${serverId}:`, err instanceof Error ? err.message : err)
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
        serverId, toolName: body.method, payer: senderAddress, txid,
        amount: paidAmount, token: paidToken, success: false,
        durationMs: Date.now() - startTime, timestamp,
      })
      console.error(`Upstream error after payment [${serverId}]:`, err instanceof Error ? err.message : err)
      return c.json({ error: 'Upstream failed', code: 'UPSTREAM_ERROR', txid, explorerUrl }, 502)
    }

    if (!upstreamRes.ok) {
      fireHooks(hooks, {
        serverId, toolName: body.method, payer: senderAddress, txid,
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
        serverId,
        tool: body.method,
        amount: paidAmount,
        token: paidToken,
        fromAddress: senderAddress,
        txid,
      }).catch(() => {})
    })

    fireHooks(hooks, {
      serverId,
      toolName: body.method,
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
      toolName: body.method,
      success: freeRes.ok,
      durationMs: Date.now() - startTime,
      timestamp,
    })
    return freeRes
  } catch (err) {
    fireHooks(hooks, {
      serverId,
      toolName: body.method,
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
