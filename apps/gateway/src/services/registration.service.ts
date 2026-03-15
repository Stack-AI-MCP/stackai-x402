import { randomUUID } from 'node:crypto'
import { encrypt } from 'stackai-x402/internal'
import type { RedisLike } from 'stackai-x402/internal'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TokenType = 'STX' | 'sBTC' | 'USDCx'

export interface ToolPricingEntry { price: number }

export interface RegisterServerInput {
  url: string
  name: string
  description?: string
  recipientAddress: string
  ownerAddress: string
  network?: 'mainnet' | 'testnet'
  acceptedTokens?: TokenType[]
  toolPricing?: Record<string, ToolPricingEntry>
  upstreamAuth?: string
  telegramChatId?: string
  webhookUrl?: string
  createMoltbookAgent?: boolean
  moltbookApiKey?: string
}

export interface IntrospectedTool {
  name: string
  description: string
  price: number
  acceptedTokens: TokenType[]
  inputSchema?: Record<string, unknown>
}

export interface ServerConfig {
  serverId: string
  name: string
  description: string
  url: string
  recipientAddress: string
  ownerAddress: string
  network: 'mainnet' | 'testnet'
  acceptedTokens: TokenType[]
  toolPricing: Record<string, ToolPricingEntry>
  encryptedAuth?: string
  telegramChatId?: string
  webhookUrl?: string
  createdAt: string
  status?: 'active' | 'disabled'
  moltbookAgentId?: string
}

export interface RegisterServerResult {
  serverId: string
  gatewayUrl: string
  claimUrl?: string | null
}

export type { RedisLike }

// ─── SSRF guard ───────────────────────────────────────────────────────────────

const PRIVATE_HOST_RE =
  /^(localhost|127\.|0\.0\.0\.0|::1|\[::1\]|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i

export function assertPublicUrl(rawUrl: string): void {
  let parsed: URL
  try { parsed = new URL(rawUrl) } catch { throw new Error('Invalid URL') }
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed')
  if (PRIVATE_HOST_RE.test(parsed.hostname)) throw new Error('Private/loopback addresses not allowed')
}

// ─── Redis helpers ────────────────────────────────────────────────────────────

export async function scanAllKeys(redis: RedisLike, pattern: string): Promise<string[]> {
  const keys: string[] = []
  let cursor = '0'
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', '100')
    cursor = next
    keys.push(...batch)
  } while (cursor !== '0')
  return keys
}

// ─── MCP introspection ──────────────────────────────────────────────────────

interface MCPTool { name: string; description?: string; inputSchema?: Record<string, unknown> }

async function mcpPost<T>(serverUrl: string, method: string, params: Record<string, unknown>): Promise<T | null> {
  const res = await fetch(serverUrl, {
    method: 'POST',
    signal: AbortSignal.timeout(8_000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!res.ok) return null
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) return (await res.json()) as T
  if (ct.includes('text/event-stream')) {
    for (const line of (await res.text()).split('\n')) {
      if (!line.startsWith('data:')) continue
      try { return JSON.parse(line.slice(5).trim()) as T } catch { /* skip */ }
    }
  }
  return null
}

export async function introspectTools(serverUrl: string): Promise<MCPTool[]> {
  try {
    const data = await mcpPost<{ result?: { tools?: MCPTool[] } }>(serverUrl, 'tools/list', {})
    return data?.result?.tools ?? []
  } catch { return [] }
}

export interface MCPServerInfo { name: string; description: string }

export async function introspectServerInfo(serverUrl: string): Promise<MCPServerInfo> {
  try {
    const data = await mcpPost<{ result?: { serverInfo?: { name?: string }; meta?: { description?: string } } }>(
      serverUrl, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'stackai-gateway', version: '1.0.0' } },
    )
    return { name: data?.result?.serverInfo?.name ?? '', description: data?.result?.meta?.description ?? '' }
  } catch { return { name: '', description: '' } }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export async function registerServer(
  input: RegisterServerInput,
  deps: { redis: RedisLike; encryptionKey: string },
): Promise<RegisterServerResult> {
  const { redis, encryptionKey } = deps

  assertPublicUrl(input.url)

  const serverId = randomUUID()
  const acceptedTokens: TokenType[] = input.acceptedTokens ?? ['STX', 'sBTC', 'USDCx']
  const toolPricing = input.toolPricing ?? {}
  const encryptedAuth = input.upstreamAuth ? encrypt(input.upstreamAuth, encryptionKey) : undefined

  const config: ServerConfig = {
    serverId,
    name: input.name,
    description: input.description ?? '',
    url: input.url,
    recipientAddress: input.recipientAddress,
    ownerAddress: input.ownerAddress,
    network: input.network ?? 'mainnet',
    acceptedTokens,
    toolPricing,
    ...(encryptedAuth && { encryptedAuth }),
    ...(input.telegramChatId && { telegramChatId: input.telegramChatId }),
    ...(input.webhookUrl && { webhookUrl: input.webhookUrl }),
    createdAt: new Date().toISOString(),
  }

  const mcpTools = await introspectTools(input.url)
  const tools: IntrospectedTool[] = mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    price: toolPricing[t.name]?.price ?? 0,
    acceptedTokens,
    ...(t.inputSchema && { inputSchema: t.inputSchema }),
  }))

  const TTL = ['EX', 2_592_000] as const
  await Promise.all([
    redis.set(`server:${serverId}:config`, JSON.stringify(config), ...TTL),
    redis.set(`server:${serverId}:tools`, JSON.stringify(tools), ...TTL),
    redis.set(`server:${serverId}:ownerAddress`, input.ownerAddress, ...TTL),
  ])

  // Store Moltbook API key for standalone moltbook service to pick up
  if (input.createMoltbookAgent && input.moltbookApiKey) {
    await redis.set(`server:${serverId}:moltbookApiKey`, input.moltbookApiKey, ...TTL)
    await redis.lpush('moltbook:pending-registrations', JSON.stringify({
      serverId,
      name: input.name,
      description: input.description ?? '',
      toolNames: mcpTools.map((t) => t.name),
      gatewayUrl: `/api/v1/proxy/${serverId}`,
    }))
  }

  return { serverId, gatewayUrl: `/api/v1/proxy/${serverId}` }
}
