import { randomUUID, randomBytes } from 'node:crypto'
import { encrypt } from 'stackai-x402/internal'
import type { RedisLike } from 'stackai-x402/internal'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TokenType = 'STX' | 'sBTC' | 'USDCx'

export interface ToolPricingEntry {
  price: number
}

export interface RegisterServerInput {
  url: string
  name: string
  description?: string
  recipientAddress: string
  acceptedTokens?: TokenType[]
  toolPricing?: Record<string, ToolPricingEntry>
  upstreamAuth?: string
  telegramChatId?: string
  webhookUrl?: string
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
  acceptedTokens: TokenType[]
  toolPricing: Record<string, ToolPricingEntry>
  // Stored as `encryptedAuth` (camelCase) — arch doc calls it `upstream_auth_enc`
  encryptedAuth?: string
  telegramChatId?: string
  webhookUrl?: string
  createdAt: string
  // ownerKey is stored separately as server:{id}:ownerKey — NOT in this blob
}

export interface RegisterServerResult {
  serverId: string
  gatewayUrl: string
  ownerKey: string
}

// Re-export for use in app.ts / routes
export type { RedisLike }

// ─── MCP introspection ────────────────────────────────────────────────────────

interface MCPTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

/**
 * Attempts a JSON-RPC `tools/list` call against the upstream MCP server.
 * Returns an empty array if the server is unreachable, times out (5 s),
 * or returns a non-JSON response (e.g. SSE). Registration is never blocked.
 */
export async function introspectTools(serverUrl: string): Promise<MCPTool[]> {
  try {
    const res = await fetch(serverUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    })

    if (!res.ok) return []

    // Some MCP servers respond with SSE — skip if not plain JSON
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) return []

    const data = (await res.json()) as { result?: { tools?: MCPTool[] } }
    return data?.result?.tools ?? []
  } catch {
    // Introspection failure is non-fatal — server may be offline at registration time
    return []
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export async function registerServer(
  input: RegisterServerInput,
  deps: { redis: RedisLike; encryptionKey: string },
): Promise<RegisterServerResult> {
  const { redis, encryptionKey } = deps

  const serverId = randomUUID()
  const ownerKey = randomBytes(32).toString('hex')

  const acceptedTokens: TokenType[] = input.acceptedTokens ?? ['STX', 'sBTC', 'USDCx']
  const toolPricing: Record<string, ToolPricingEntry> = input.toolPricing ?? {}

  // Encrypt upstreamAuth if provided — never store plaintext credentials
  const encryptedAuth = input.upstreamAuth
    ? encrypt(input.upstreamAuth, encryptionKey)
    : undefined

  const config: ServerConfig = {
    serverId,
    name: input.name,
    description: input.description ?? '',
    url: input.url,
    recipientAddress: input.recipientAddress,
    acceptedTokens,
    toolPricing,
    ...(encryptedAuth !== undefined && { encryptedAuth }),
    ...(input.telegramChatId !== undefined && { telegramChatId: input.telegramChatId }),
    ...(input.webhookUrl !== undefined && { webhookUrl: input.webhookUrl }),
    createdAt: new Date().toISOString(),
  }

  // Introspect upstream MCP server for available tools
  const mcpTools = await introspectTools(input.url)

  // Merge introspected tools with pricing — any unlisted tool defaults to price 0
  const tools: IntrospectedTool[] = mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    price: toolPricing[tool.name]?.price ?? 0,
    acceptedTokens,
    ...(tool.inputSchema && { inputSchema: tool.inputSchema }),
  }))

  const TTL = ['EX', 2_592_000] as const

  // Store config, tools, and ownerKey in Redis with 30-day TTL.
  // ownerKey lives in its own key — never inside the config blob — to avoid
  // accidental exposure if a future route dumps the config without projecting.
  await Promise.all([
    redis.set(`server:${serverId}:config`, JSON.stringify(config), ...TTL),
    redis.set(`server:${serverId}:tools`, JSON.stringify(tools), ...TTL),
    redis.set(`server:${serverId}:ownerKey`, ownerKey, ...TTL),
  ])

  return {
    serverId,
    gatewayUrl: `/api/v1/proxy/${serverId}`,
    ownerKey,
  }
}
