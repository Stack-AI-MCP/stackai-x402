import { Hono } from 'hono'
import type { Context } from 'hono'
import { randomUUID } from 'node:crypto'
import { usdToMicro, networkToCAIP2, decrypt, PaymentVerificationError } from 'stackai-x402/internal'
import type { AppEnv } from '../app.js'
import type { ServerConfig, IntrospectedTool } from '../services/registration.service.js'
import { processPayment } from '../services/payment.service.js'
import { enqueuePaymentNotification } from '../services/notification.service.js'
import type { Hook, RequestContext } from 'stackai-x402/hooks'

// ─── Types ────────────────────────────────────────────────────────────────────

interface JsonRpcBody {
  jsonrpc?: string
  id?: number | string
  method: string
  params?: unknown
}

// ─── Upstream forwarding ──────────────────────────────────────────────────────

/**
 * Forwards the JSON-RPC body to the upstream MCP server unchanged (NFR17).
 * Returns the upstream Response on success.
 * @throws on network failure (caller decides how to surface to client)
 */
async function callUpstream(
  body: JsonRpcBody,
  config: ServerConfig,
  upstreamAuthHeader: string | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
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

/**
 * Fires the hook chain via setImmediate — NEVER blocks the response (AC5, NFR3).
 * Each hook error is silently swallowed (AC2).
 */
function fireHooks(hooks: Hook[], ctx: RequestContext): void {
  for (const hook of hooks) {
    setImmediate(() => hook.onRequest(ctx).catch((err) => {
      console.warn('[hook] error (non-fatal):', err instanceof Error ? err.message : err)
    }))
  }
}

// ─── Shared handler ───────────────────────────────────────────────────────────

async function handleProxy(c: Context<AppEnv>, serverId: string): Promise<Response> {
  const redis = c.get('redis')
  const network = c.get('network')
  const tokenPrices = c.get('tokenPrices')
  const encryptionKey = c.get('encryptionKey')
  const relayUrl = c.get('relayUrl')
  const hooks = c.get('hooks')
  const startTime = Date.now()
  const timestamp = new Date().toISOString()

  // ── Parse JSON-RPC body first (gives 400 before 404 on bad body) ───────────
  let body: JsonRpcBody
  try {
    body = (await c.req.json()) as JsonRpcBody
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_REQUEST' }, 400)
  }

  // ── Load server config + tools from Redis ──────────────────────────────────
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

  // ── Check disabled status (before any tool work or payment) ──────────────
  if (config.status === 'disabled') {
    return c.json({ error: 'Endpoint disabled', code: 'ENDPOINT_DISABLED' }, 503)
  }

  // Update lastSeen only for non-disabled servers (fire-and-forget, 30-day TTL)
  redis.set(`server:${serverId}:lastSeen`, new Date().toISOString(), 'EX', 2_592_000).catch(() => {})

  // ── Find tool ──────────────────────────────────────────────────────────────
  const tool = tools.find((t) => t.name === body.method)
  if (!tool) {
    return c.json({ error: 'Tool not found', code: 'TOOL_NOT_FOUND' }, 404)
  }

  // ── Decrypt upstream auth header early (before any payment) ───────────────
  // Decryption failure (bad key, tampered ciphertext) is an operator config error,
  // not a payment error — return 500 rather than leaking txid in a 502.
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
      // No payment yet — issue 402 with payment requirements
      const paymentIdentifier = randomUUID()
      const caip2 = networkToCAIP2(network)

      // AC7: use config.acceptedTokens (server-level), not tool.acceptedTokens.
      const price: Record<string, string> = {}
      for (const token of config.acceptedTokens) {
        price[token] = usdToMicro(tool.price, token, tokenPrices[token]).toString()
      }

      const payload = {
        version: 2,
        network: caip2,
        payTo: config.recipientAddress,
        price,
        paymentIdentifier,
      }

      // Header name MUST be lowercase — x402 spec mandates `payment-required`
      c.header('payment-required', Buffer.from(JSON.stringify(payload)).toString('base64'))
      return c.json({ error: 'Payment required', code: 'PAYMENT_REQUIRED' }, 402)
    }

    // Payment signature present — require the paymentId for replay protection
    const paymentId = c.req.header('payment-id')
    if (!paymentId) {
      return c.json(
        { error: 'payment-id header required when payment-signature is present', code: 'INVALID_REQUEST' },
        400,
      )
    }

    // Verify payment via 6-step engine (AC 1, 2, 3, 4, 5, 6)
    let txid: string
    let explorerUrl: string
    let paidToken: string
    let paidAmount: string
    let senderAddress: string
    try {
      const result = await processPayment({
        paymentSignature: paymentSig,
        paymentId,
        tool,
        config,
        network,
        tokenPrices,
        redis,
        relayUrl,
      })
      txid = result.txid
      explorerUrl = result.explorerUrl
      paidToken = result.tokenType
      paidAmount = result.amount
      senderAddress = result.senderAddress
    } catch (err) {
      if (err instanceof PaymentVerificationError) {
        if (err.code === 'RELAY_FAILED') {
          // AC 6: relay unreachable → 503
          return c.json({ error: 'Relay unavailable', code: 'RELAY_UNAVAILABLE' }, 503)
        }
        // All other verification errors → 402 with error code
        return c.json({ error: err.message, code: err.code }, 402)
      }
      // Raw infrastructure error (Redis down etc.) → propagates to global handler → 500
      throw err
    }

    // Payment verified — forward to upstream (AC 3, 4)
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
      // AC 5: upstream failure after verified payment — return txid so caller can verify
      return c.json({ error: 'Upstream failed', code: 'UPSTREAM_ERROR', txid, explorerUrl }, 502)
    }

    if (!upstreamRes.ok) {
      // AC 5: upstream returned non-OK after verified payment
      fireHooks(hooks, {
        serverId, toolName: body.method, payer: senderAddress, txid,
        amount: paidAmount, token: paidToken, success: false,
        durationMs: Date.now() - startTime, timestamp,
      })
      return c.json({ error: 'Upstream failed', code: 'UPSTREAM_ERROR', txid, explorerUrl }, 502)
    }

    // AC 8: success — rebuild response with payment-response header (base64-encoded { txid, explorerUrl })
    // c.header() does not merge into a raw Response; we must include it explicitly.
    const paymentResponse = Buffer.from(JSON.stringify({ txid, explorerUrl })).toString('base64')
    const response = new Response(await upstreamRes.text(), {
      status: upstreamRes.status,
      headers: {
        'Content-Type': upstreamRes.headers.get('content-type') ?? 'application/json',
        'payment-response': paymentResponse,
      },
    })

    // Fire-and-forget notification — NEVER delays the gateway response (NFR3, AC1)
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

    // Fire hook chain — LoggingHook → X402MonetizationHook → AnalyticsHook (AC1)
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

// JSON-RPC is always POST. Restricting to .post() avoids misleading INVALID_REQUEST
// errors for GET/DELETE requests that have no body to parse.
proxyRouter.post('/:serverId', (c) => handleProxy(c, c.req.param('serverId')))
proxyRouter.post('/:serverId/*', (c) => handleProxy(c, c.req.param('serverId')))
