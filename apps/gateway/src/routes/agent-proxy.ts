import { Hono } from 'hono'
import { X402PaymentVerifier, networkToCAIP2 } from 'x402-stacks'
import type { PaymentPayloadV2, PaymentRequiredV2, PaymentRequirementsV2, SettlementResponseV2 } from 'x402-stacks'
import { usdToMicro, decrypt } from 'stackai-x402/internal'
import type { AppEnv } from '../app.js'
import type { ServerConfig, IntrospectedTool } from '../services/registration.service.js'
import type { SettleFunction } from './proxy.js'
import { getAgent, logTransaction } from '../services/agent.service.js'
import type { AgentConfig, TransactionRecord } from '../services/agent.service.js'
import { enqueuePaymentNotification } from '../services/notification.service.js'

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

interface JsonRpcBody {
  jsonrpc?: string
  id?: number | string
  method: string
  params?: unknown
}

// ─── Upstream forwarding (shared with proxy.ts) ──────────────────────────────

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
    headers: { 'Content-Type': upstreamRes.headers.get('content-type') ?? 'application/json' },
  })
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const agentProxyRouter = new Hono<AppEnv>()

agentProxyRouter.post('/:agentId', async (c) => {
  const agentId = c.req.param('agentId')
  const redis = c.get('redis')
  const tokenPrices = c.get('tokenPrices')
  const encryptionKey = c.get('encryptionKey')
  const settleOverride = c.get('settlePayment')
  const timestamp = new Date().toISOString()

  if (!ULID_RE.test(agentId)) {
    return c.json({ error: 'Invalid agent ID format', code: 'INVALID_REQUEST' }, 400)
  }

  // ── Parse JSON-RPC body ────────────────────────────────────────────
  let body: JsonRpcBody
  try {
    body = (await c.req.json()) as JsonRpcBody
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_REQUEST' }, 400)
  }

  // ── Load agent config ──────────────────────────────────────────────
  const agent = await getAgent(agentId, { redis })
  if (!agent) {
    return c.json({ error: 'Agent not found', code: 'AGENT_NOT_FOUND' }, 404)
  }

  // ── Find tool in agent config ──────────────────────────────────────
  let toolName = body.method
  if (body.method === 'tools/call' && body.params && typeof body.params === 'object') {
    toolName = (body.params as any).name
  }

  const agentTool = agent.tools.find((t) => t.toolName === toolName)
  if (!agentTool) {
    return c.json({ error: `Tool '${toolName}' not found on this agent`, code: 'TOOL_NOT_FOUND' }, 404)
  }

  // ── Resolve upstream server ────────────────────────────────────────
  const configJson = await redis.get(`server:${agentTool.serverId}:config`)
  if (!configJson) {
    return c.json({ error: 'Upstream server not found', code: 'SERVER_NOT_FOUND' }, 404)
  }

  let serverConfig: ServerConfig
  try {
    serverConfig = JSON.parse(configJson) as ServerConfig
  } catch {
    return c.json({ error: 'Server data corrupted', code: 'INTERNAL_ERROR' }, 500)
  }

  if (serverConfig.status === 'disabled') {
    return c.json({ error: 'Upstream server disabled', code: 'ENDPOINT_DISABLED' }, 503)
  }

  const network = agent.network
  const relayUrl = network === 'testnet' ? c.get('testnetRelayUrl') : c.get('relayUrl')

  // ── Decrypt upstream auth ──────────────────────────────────────────
  let upstreamAuthHeader: string | undefined
  if (serverConfig.encryptedAuth) {
    try {
      upstreamAuthHeader = `Bearer ${decrypt(serverConfig.encryptedAuth, encryptionKey)}`
    } catch {
      return c.json({ error: 'Internal configuration error', code: 'INTERNAL_ERROR' }, 500)
    }
  }

  // ── 402 gate (agent's price, not server's) ─────────────────────────
  if (agentTool.price > 0) {
    const paymentSig = c.req.header('payment-signature')

    if (!paymentSig) {
      const caip2 = networkToCAIP2(network)
      const acceptedTokens = serverConfig.acceptedTokens ?? ['STX', 'sBTC', 'USDCx']

      const accepts: PaymentRequirementsV2[] = acceptedTokens.map((token) => ({
        scheme: 'exact',
        network: caip2,
        amount: usdToMicro(agentTool.price, token, tokenPrices[token]).toString(),
        asset: token,
        payTo: agent.ownerAddress, // Agent owner receives payment
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

    // Decode and settle payment
    let paymentPayload: PaymentPayloadV2
    try {
      const decoded = Buffer.from(paymentSig, 'base64').toString('utf-8')
      paymentPayload = JSON.parse(decoded) as PaymentPayloadV2
    } catch {
      return c.json({ error: 'Invalid payment-signature', code: 'INVALID_REQUEST' }, 400)
    }

    const doSettle: SettleFunction = settleOverride ?? (async (payload, requirements) => {
      const verifier = new X402PaymentVerifier(relayUrl)
      return verifier.settle(payload, { paymentRequirements: requirements })
    })

    let settlement: SettlementResponseV2
    try {
      settlement = await doSettle(paymentPayload, paymentPayload.accepted)
    } catch {
      return c.json({ error: 'Relay unavailable', code: 'RELAY_UNAVAILABLE' }, 503)
    }

    if (!settlement.success) {
      return c.json({ error: settlement.errorReason ?? 'Payment failed', code: 'PAYMENT_FAILED' }, 402)
    }

    // Dedup
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
      upstreamRes = await callUpstream(body, serverConfig, upstreamAuthHeader)
    } catch {
      // Log failed transaction
      await logTransactionAsync(redis, {
        status: 'failed', serverId: agentTool.serverId, serverName: serverConfig.name,
        agentId, agentName: agent.name, moltbookName: agent.moltbookName,
        toolName, amount: paidAmount, token: paidToken, network, payer: senderAddress,
        txHash: txid, timestamp,
      })
      return c.json({ error: 'Upstream failed', code: 'UPSTREAM_ERROR', txid, explorerUrl }, 502)
    }

    if (!upstreamRes.ok) {
      await logTransactionAsync(redis, {
        status: 'failed', serverId: agentTool.serverId, serverName: serverConfig.name,
        agentId, agentName: agent.name, moltbookName: agent.moltbookName,
        toolName, amount: paidAmount, token: paidToken, network, payer: senderAddress,
        txHash: txid, timestamp,
      })
      return c.json({ error: 'Upstream failed', code: 'UPSTREAM_ERROR', txid, explorerUrl }, 502)
    }

    // Success — log transaction + return response
    await logTransactionAsync(redis, {
      status: 'settled', serverId: agentTool.serverId, serverName: serverConfig.name,
      agentId, agentName: agent.name, moltbookName: agent.moltbookName,
      toolName, amount: paidAmount, token: paidToken, network, payer: senderAddress,
      txHash: txid, timestamp,
    })

    setImmediate(() => {
      enqueuePaymentNotification(redis, {
        serverId: agentTool.serverId, tool: toolName, amount: paidAmount,
        token: paidToken, fromAddress: senderAddress, txid,
      }).catch(() => {})
    })

    const paymentResponse = Buffer.from(JSON.stringify({ txid, explorerUrl })).toString('base64')
    return new Response(await upstreamRes.text(), {
      status: upstreamRes.status,
      headers: {
        'Content-Type': upstreamRes.headers.get('content-type') ?? 'application/json',
        'payment-response': paymentResponse,
      },
    })
  }

  // ── Free tool: forward directly ────────────────────────────────────
  try {
    const freeRes = await callUpstream(body, serverConfig, upstreamAuthHeader)

    // Log free call
    await logTransactionAsync(redis, {
      status: 'free', serverId: agentTool.serverId, serverName: serverConfig.name,
      agentId, agentName: agent.name, moltbookName: agent.moltbookName,
      toolName, amount: '0', token: '', network, payer: '', timestamp,
    })

    return freeRes
  } catch {
    return c.json({ error: 'Upstream unavailable', code: 'UPSTREAM_ERROR' }, 502)
  }
})

// ── tools/list for agent — returns the agent's curated tool list ────────────

agentProxyRouter.get('/:agentId/tools', async (c) => {
  const agentId = c.req.param('agentId')
  const redis = c.get('redis')

  if (!ULID_RE.test(agentId)) {
    return c.json({ error: 'Invalid agent ID format', code: 'INVALID_REQUEST' }, 400)
  }

  const agent = await getAgent(agentId, { redis })
  if (!agent) {
    return c.json({ error: 'Agent not found', code: 'AGENT_NOT_FOUND' }, 404)
  }

  // Resolve tool descriptions from upstream servers
  const serverIds = [...new Set(agent.tools.map((t) => t.serverId))]
  const toolKeys = serverIds.map((id) => `server:${id}:tools`)
  const toolsData = await redis.mget(...toolKeys)

  const toolDescriptions = new Map<string, { description: string; inputSchema?: any }>()
  toolsData.forEach((json: string | null) => {
    if (!json) return
    try {
      const tools = JSON.parse(json) as IntrospectedTool[]
      tools.forEach((t) => {
        toolDescriptions.set(t.name, { description: t.description, inputSchema: t.inputSchema })
      })
    } catch { /* skip */ }
  })

  const tools = agent.tools.map((t) => {
    const desc = toolDescriptions.get(t.toolName)
    return {
      name: t.toolName,
      description: desc?.description ?? '',
      price: t.price,
      inputSchema: desc?.inputSchema,
    }
  })

  return c.json({ tools })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function logTransactionAsync(
  redis: any,
  data: Omit<TransactionRecord, 'id'>,
) {
  const record: TransactionRecord = {
    id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ...data,
  }
  return logTransaction(record, { redis }).catch(() => {})
}
