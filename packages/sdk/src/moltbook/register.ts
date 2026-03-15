/**
 * One-shot Moltbook agent registration.
 *
 * For ongoing Moltbook engagement (heartbeats, feed browsing, verified posting
 * with challenge solving), use the standalone `stackai-moltbook` service instead.
 * This function provides one-shot registration only — it does NOT solve
 * verification challenges or run heartbeat loops.
 *
 * @see https://github.com/stackai/stackai-moltbook
 */

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

// Base URL per Moltbook skill.md — always use www prefix
const MOLTBOOK_API_BASE = 'https://www.moltbook.com/api/v1'

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function moltbookFetch(
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
  method: 'POST' | 'PATCH' = 'POST',
): Promise<Response> {
  const url = `${MOLTBOOK_API_BASE}${path}`

  let res: Response
  try {
    res = await fetch(url, {
      method,
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

  // Step 1: Register agent — POST /api/v1/agents/register per Moltbook skill.md
  const createRes = await moltbookFetch('/agents/register', moltbookApiKey, {
    name: serverConfig.name,
    description: serverConfig.description,
  })

  // Moltbook registration returns: api_key, claim_url, verification_code
  let agentId: string
  let claimUrl: string
  try {
    const data = (await createRes.json()) as {
      api_key?: string
      claim_url?: string
      verification_code?: string
      // Fallback to camelCase in case API changes
      agentId?: string
      claimUrl?: string
    }
    agentId = data.api_key ?? data.agentId ?? ''
    claimUrl = data.claim_url ?? data.claimUrl ?? ''
    if (!agentId || !claimUrl) {
      throw new MoltbookError('INVALID_RESPONSE', 'Missing api_key or claim_url in Moltbook response')
    }
  } catch (err) {
    if (err instanceof MoltbookError) throw err
    throw new MoltbookError('INVALID_RESPONSE', 'Failed to parse Moltbook response')
  }

  // Step 2: Update agent description with capabilities (best-effort, PATCH /agents/me)
  try {
    await moltbookFetch('/agents/me', moltbookApiKey, {
      description: `${serverConfig.description}\n\nTools: ${serverConfig.toolNames.join(', ')}\nGateway: ${serverConfig.gatewayUrl}`,
    }, 'PATCH')
  } catch (err) {
    console.warn('[moltbook] Failed to update description:', err instanceof Error ? err.message : err)
  }

  // Step 3: Post capabilities announcement (best-effort — Moltbook posts API)
  try {
    const toolList = serverConfig.toolPricing?.length
      ? serverConfig.toolPricing
          .map((t) => `- ${t.name}: ${t.price} ${t.token}`)
          .join('\n')
      : serverConfig.toolNames.map((t) => `- ${t}`).join('\n')

    const content = [
      `${serverConfig.name} is now live on x402!`,
      '',
      serverConfig.description,
      '',
      'Tools available:',
      toolList,
      '',
      `Gateway: ${serverConfig.gatewayUrl}`,
    ].join('\n')

    // Post to a submolt if available, otherwise just announce
    await moltbookFetch('/posts', moltbookApiKey, {
      title: `${serverConfig.name} — x402 Agent`,
      content,
      type: 'text',
    })
  } catch (err) {
    // Best-effort — post failure does not affect registration
    console.warn('[moltbook] Failed to post capabilities:', err instanceof Error ? err.message : err)
  }

  return { agentId, claimUrl }
}
