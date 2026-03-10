// ─── Error types ──────────────────────────────────────────────────────────────

export type MoltbookErrorCode = 'API_UNAVAILABLE' | 'AUTH_FAILED' | 'INVALID_RESPONSE'

export class MoltbookError extends Error {
  constructor(
    public readonly code: MoltbookErrorCode,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'MoltbookError'
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MoltbookAgentConfig {
  /** Server name — used as the agent display name on Moltbook */
  name: string
  /** Short description of what the server does */
  description: string
  /** List of tool names the server exposes */
  toolNames: string[]
  /** Public gateway URL where the server is accessible */
  gatewayUrl: string
  /** Tool pricing info for the capabilities post (optional) */
  toolPricing?: Array<{ name: string; price: number; token: string }>
}

export interface MoltbookRegistrationResult {
  /** Moltbook agent ID — store this for future API calls */
  agentId: string
  /** URL the developer visits to claim ownership on moltbook.com */
  claimUrl: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MOLTBOOK_API_BASE = 'https://api.moltbook.com/v1'

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function moltbookFetch(
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const url = `${MOLTBOOK_API_BASE}${path}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new MoltbookError('API_UNAVAILABLE', 'Moltbook API is unreachable')
  }

  if (res.status === 401 || res.status === 403) {
    throw new MoltbookError('AUTH_FAILED', `Moltbook authentication failed (${res.status})`)
  }
  if (!res.ok) {
    throw new MoltbookError('INVALID_RESPONSE', `Moltbook API returned ${res.status}`)
  }

  return res
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Registers a Moltbook agent for a gateway-registered MCP server.
 *
 * Creates an agent on the Moltbook social network and optionally publishes
 * a capabilities announcement post. The `moltbookApiKey` is ONLY sent to
 * `api.moltbook.com` — never logged, never forwarded elsewhere (NFR8).
 *
 * @throws {MoltbookError} with code 'API_UNAVAILABLE' | 'AUTH_FAILED' | 'INVALID_RESPONSE'
 */
export async function registerMoltbookAgent(opts: {
  serverConfig: MoltbookAgentConfig
  moltbookApiKey: string
}): Promise<MoltbookRegistrationResult> {
  const { serverConfig, moltbookApiKey } = opts

  // Step 1: Create agent
  const createRes = await moltbookFetch('/agents', moltbookApiKey, {
    name: serverConfig.name,
    description: serverConfig.description,
    capabilities: serverConfig.toolNames,
    gatewayUrl: serverConfig.gatewayUrl,
  })

  let agentId: string
  let claimUrl: string
  try {
    const data = (await createRes.json()) as { agentId?: string; claimUrl?: string }
    if (!data.agentId || !data.claimUrl) {
      throw new MoltbookError('INVALID_RESPONSE', 'Missing agentId or claimUrl in Moltbook response')
    }
    agentId = data.agentId
    claimUrl = data.claimUrl
  } catch (err) {
    if (err instanceof MoltbookError) throw err
    throw new MoltbookError('INVALID_RESPONSE', 'Failed to parse Moltbook response')
  }

  // Step 2: Auto-post capabilities announcement (best-effort — NFR14, FR48)
  try {
    const toolList = serverConfig.toolPricing?.length
      ? serverConfig.toolPricing
          .map((t) => `- ${t.name}: ${t.price} ${t.token}`)
          .join('\n')
      : serverConfig.toolNames.map((t) => `- ${t}`).join('\n')

    const content = [
      `🤖 ${serverConfig.name} is now live!`,
      '',
      serverConfig.description,
      '',
      'Tools available:',
      toolList,
      '',
      `Gateway: ${serverConfig.gatewayUrl}`,
    ].join('\n')

    await moltbookFetch(`/agents/${agentId}/posts`, moltbookApiKey, { content })
  } catch (err) {
    // Best-effort — capabilities post failure does not affect registration (NFR14)
    console.warn('[moltbook] Failed to post capabilities:', err instanceof Error ? err.message : err)
  }

  return { agentId, claimUrl }
}
