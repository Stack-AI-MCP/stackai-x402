import { randomUUID, randomBytes } from 'node:crypto'
import { encrypt } from 'stackai-x402/internal'
import type { RedisLike } from 'stackai-x402/internal'
import { registerMoltbookAgent } from 'stackai-x402/moltbook'

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
  /** If true (and moltbookApiKey is provided), creates a Moltbook agent after registration */
  createMoltbookAgent?: boolean
  /** Used only for the one-time Moltbook API call — NEVER stored in Redis */
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
  acceptedTokens: TokenType[]
  toolPricing: Record<string, ToolPricingEntry>
  // Stored as `encryptedAuth` (camelCase) — arch doc calls it `upstream_auth_enc`
  encryptedAuth?: string
  telegramChatId?: string
  webhookUrl?: string
  createdAt: string
  /** Operator-controlled status — 'disabled' blocks all proxy traffic (AC7, Story 3-3). */
  status?: 'active' | 'disabled'
  /** Moltbook agent ID — stored after successful Moltbook registration (Story 4.2, AC5) */
  moltbookAgentId?: string
  // ownerKey is stored separately as server:{id}:ownerKey — NOT in this blob
}

export interface RegisterServerResult {
  serverId: string
  gatewayUrl: string
  ownerKey: string
  /** Moltbook claim URL — null if Moltbook registration was not requested or failed */
  claimUrl?: string | null
}

// Re-export for use in app.ts / routes
export type { RedisLike }

// ─── SSRF guard ───────────────────────────────────────────────────────────────

/**
 * Regex covers the most common private/loopback ranges. DNS-rebinding attacks
 * require additional mitigations (e.g. connecting-IP firewall rules) that are
 * outside the scope of this service, but this blocks the obvious cases.
 */
const PRIVATE_HOST_RE =
  /^(localhost|127\.|0\.0\.0\.0|::1|\[::1\]|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i

/** Throws a descriptive Error when the URL is not a public HTTPS endpoint. */
export function assertPublicUrl(rawUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('Invalid URL')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed')
  }
  if (PRIVATE_HOST_RE.test(parsed.hostname)) {
    throw new Error('Requests to private or loopback addresses are not allowed')
  }
}

// ─── Redis helpers ────────────────────────────────────────────────────────────

/** Cursor-based SCAN — safe for production unlike KEYS which blocks Redis. */
export async function scanAllKeys(redis: RedisLike, pattern: string): Promise<string[]> {
  const keys: string[] = []
  let cursor = '0'
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', '100')
    cursor = nextCursor
    keys.push(...batch)
  } while (cursor !== '0')
  return keys
}

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

  // Validate upstream URL before doing anything — prevents SSRF
  assertPublicUrl(input.url)

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

  // Optional Moltbook agent registration — best-effort (NFR14)
  // moltbookApiKey is NEVER stored in Redis — used for this call only (AC4)
  let claimUrl: string | null = null
  if (input.createMoltbookAgent && input.moltbookApiKey) {
    try {
      const moltbookResult = await registerMoltbookAgent({
        serverConfig: {
          name: input.name,
          description: input.description ?? '',
          toolNames: mcpTools.map((t) => t.name),
          gatewayUrl: `/api/v1/proxy/${serverId}`,
        },
        moltbookApiKey: input.moltbookApiKey,
      })

      claimUrl = moltbookResult.claimUrl

      // Store moltbookAgentId in config for later use (Story 3.4 alert) — AC5
      const configWithAgent: ServerConfig = { ...config, moltbookAgentId: moltbookResult.agentId }
      await redis.set(`server:${serverId}:config`, JSON.stringify(configWithAgent), 'KEEPTTL')
    } catch (err) {
      // Moltbook failure must not affect server registration (NFR14)
      console.warn('Moltbook registration failed (non-fatal):', err instanceof Error ? err.message : err)
    }
  }

  return {
    serverId,
    gatewayUrl: `/api/v1/proxy/${serverId}`,
    ownerKey,
    claimUrl,
  }
}
