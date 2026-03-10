import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerMoltbookAgent, MoltbookError } from './register.js'

// ─── Test constants ────────────────────────────────────────────────────────────

const MOLTBOOK_API_KEY = 'test-api-key-super-secret-12345'
const MOLTBOOK_DOMAIN = 'api.moltbook.com'

const AGENT_CONFIG = {
  name: 'My MCP Server',
  description: 'A test MCP server',
  toolNames: ['search', 'summarise'],
  gatewayUrl: 'https://gateway.example.com',
}

// ─── Fetch spy helpers ────────────────────────────────────────────────────────

function makeSuccessResponse(body: object) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ─── NFR8: API key only sent to moltbook.com ─────────────────────────────────

describe('NFR8 — moltbookApiKey only sent to api.moltbook.com', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('all fetch calls target api.moltbook.com exclusively', async () => {
    fetchSpy.mockResolvedValue(
      makeSuccessResponse({ agentId: 'agent-123', claimUrl: 'https://moltbook.com/claim/agent-123' }),
    )

    await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })

    expect(fetchSpy).toHaveBeenCalled()
    for (const [url] of fetchSpy.mock.calls) {
      const parsedUrl = new URL(url as string)
      expect(parsedUrl.hostname).toBe(MOLTBOOK_DOMAIN)
    }
  })

  it('API key is NOT present in request bodies sent to any non-moltbook URL', async () => {
    // Simulate a scenario where a second fetch to some other URL could occur
    // (it should NOT — but if it did, the API key must not be in the body)
    fetchSpy.mockResolvedValue(
      makeSuccessResponse({ agentId: 'agent-456', claimUrl: 'https://moltbook.com/claim/agent-456' }),
    )

    await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })

    for (const [url, init] of fetchSpy.mock.calls) {
      const parsedUrl = new URL(url as string)
      if (parsedUrl.hostname !== MOLTBOOK_DOMAIN) {
        // If any non-moltbook call somehow happens, API key must not be in body
        const bodyStr = typeof (init as RequestInit)?.body === 'string'
          ? ((init as RequestInit).body as string)
          : JSON.stringify((init as RequestInit)?.body)
        expect(bodyStr).not.toContain(MOLTBOOK_API_KEY)
      }
    }
  })

  it('API key appears in Authorization header only for moltbook.com requests', async () => {
    fetchSpy.mockResolvedValue(
      makeSuccessResponse({ agentId: 'agent-789', claimUrl: 'https://moltbook.com/claim/agent-789' }),
    )

    await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })

    for (const [url, init] of fetchSpy.mock.calls) {
      const parsedUrl = new URL(url as string)
      const headers = (init as RequestInit)?.headers as Record<string, string> | undefined
      if (parsedUrl.hostname === MOLTBOOK_DOMAIN) {
        expect(headers?.['Authorization']).toBe(`Bearer ${MOLTBOOK_API_KEY}`)
      }
    }
  })
})

// ─── Success path ─────────────────────────────────────────────────────────────

describe('registerMoltbookAgent — success', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        makeSuccessResponse({ agentId: 'agent-abc', claimUrl: 'https://moltbook.com/claim/agent-abc' }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns agentId and claimUrl from Moltbook response', async () => {
    const result = await registerMoltbookAgent({
      serverConfig: AGENT_CONFIG,
      moltbookApiKey: MOLTBOOK_API_KEY,
    })
    expect(result).toEqual({
      agentId: 'agent-abc',
      claimUrl: 'https://moltbook.com/claim/agent-abc',
    })
  })

  it('sends correct body to POST /agents', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      makeSuccessResponse({ agentId: 'agent-def', claimUrl: 'https://moltbook.com/claim/agent-def' }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })

    const [[, init]] = fetchSpy.mock.calls
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      name: AGENT_CONFIG.name,
      description: AGENT_CONFIG.description,
      capabilities: AGENT_CONFIG.toolNames,
      gatewayUrl: AGENT_CONFIG.gatewayUrl,
    })
  })

  it('sends a capabilities post to /agents/{agentId}/posts after registration', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      makeSuccessResponse({ agentId: 'agent-post', claimUrl: 'https://moltbook.com/claim/agent-post' }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })

    // Should be called at least twice: POST /agents + POST /agents/{id}/posts
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const secondCall = fetchSpy.mock.calls[1][0] as string
    expect(secondCall).toContain('/agents/agent-post/posts')
  })

  it('includes tool pricing in capabilities post when provided', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      makeSuccessResponse({ agentId: 'agent-price', claimUrl: 'https://moltbook.com/claim/agent-price' }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await registerMoltbookAgent({
      serverConfig: {
        ...AGENT_CONFIG,
        toolPricing: [{ name: 'search', price: 100, token: 'STX' }],
      },
      moltbookApiKey: MOLTBOOK_API_KEY,
    })

    const [, [, postInit]] = fetchSpy.mock.calls
    const postBody = JSON.parse((postInit as RequestInit).body as string)
    expect(postBody.content).toContain('100 STX')
  })

  it('includes gateway URL in capabilities post (AC3)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      makeSuccessResponse({ agentId: 'agent-gw', claimUrl: 'https://moltbook.com/claim/agent-gw' }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })

    const [, [, postInit]] = fetchSpy.mock.calls
    const postBody = JSON.parse((postInit as RequestInit).body as string)
    expect(postBody.content).toContain(AGENT_CONFIG.gatewayUrl)
  })

  it('post uses "content" field (not "text") and includes agent name in header (AC1, AC2)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      makeSuccessResponse({ agentId: 'agent-fmt', claimUrl: 'https://moltbook.com/claim/agent-fmt' }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })

    const [, [, postInit]] = fetchSpy.mock.calls
    const postBody = JSON.parse((postInit as RequestInit).body as string)
    expect(postBody).toHaveProperty('content')
    expect(postBody).not.toHaveProperty('text')
    expect(postBody.content).toContain(AGENT_CONFIG.name)
  })
})

// ─── Error handling ───────────────────────────────────────────────────────────

describe('registerMoltbookAgent — error handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws MoltbookError(API_UNAVAILABLE) when network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    const err = await registerMoltbookAgent({
      serverConfig: AGENT_CONFIG,
      moltbookApiKey: MOLTBOOK_API_KEY,
    }).catch((e) => e)

    expect(err).toBeInstanceOf(MoltbookError)
    expect(err.code).toBe('API_UNAVAILABLE')
  })

  it('throws MoltbookError(AUTH_FAILED) on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 })))

    const err = await registerMoltbookAgent({
      serverConfig: AGENT_CONFIG,
      moltbookApiKey: MOLTBOOK_API_KEY,
    }).catch((e) => e)

    expect(err).toBeInstanceOf(MoltbookError)
    expect(err.code).toBe('AUTH_FAILED')
  })

  it('throws MoltbookError(AUTH_FAILED) on 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })))

    const err = await registerMoltbookAgent({
      serverConfig: AGENT_CONFIG,
      moltbookApiKey: MOLTBOOK_API_KEY,
    }).catch((e) => e)

    expect(err).toBeInstanceOf(MoltbookError)
    expect(err.code).toBe('AUTH_FAILED')
  })

  it('throws MoltbookError(INVALID_RESPONSE) on 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Internal Server Error', { status: 500 })))

    const err = await registerMoltbookAgent({
      serverConfig: AGENT_CONFIG,
      moltbookApiKey: MOLTBOOK_API_KEY,
    }).catch((e) => e)

    expect(err).toBeInstanceOf(MoltbookError)
    expect(err.code).toBe('INVALID_RESPONSE')
  })

  it('throws MoltbookError(INVALID_RESPONSE) when response body is missing agentId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeSuccessResponse({ claimUrl: 'https://moltbook.com/claim/x' })),
    )

    const err = await registerMoltbookAgent({
      serverConfig: AGENT_CONFIG,
      moltbookApiKey: MOLTBOOK_API_KEY,
    }).catch((e) => e)

    expect(err).toBeInstanceOf(MoltbookError)
    expect(err.code).toBe('INVALID_RESPONSE')
  })

  it('throws MoltbookError(INVALID_RESPONSE) when response body is missing claimUrl', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeSuccessResponse({ agentId: 'agent-xyz' })),
    )

    const err = await registerMoltbookAgent({
      serverConfig: AGENT_CONFIG,
      moltbookApiKey: MOLTBOOK_API_KEY,
    }).catch((e) => e)

    expect(err).toBeInstanceOf(MoltbookError)
    expect(err.code).toBe('INVALID_RESPONSE')
  })

  it('still returns successfully when capabilities post fails (NFR14 — best-effort)', async () => {
    let callCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // First call (POST /agents) succeeds
          return Promise.resolve(makeSuccessResponse({ agentId: 'agent-nfr14', claimUrl: 'https://moltbook.com/claim/agent-nfr14' }))
        }
        // Second call (POST /agents/{id}/posts) fails
        return Promise.reject(new TypeError('network error'))
      }),
    )

    const result = await registerMoltbookAgent({
      serverConfig: AGENT_CONFIG,
      moltbookApiKey: MOLTBOOK_API_KEY,
    })

    // Must succeed despite capabilities post failure
    expect(result).toEqual({
      agentId: 'agent-nfr14',
      claimUrl: 'https://moltbook.com/claim/agent-nfr14',
    })
  })
})
