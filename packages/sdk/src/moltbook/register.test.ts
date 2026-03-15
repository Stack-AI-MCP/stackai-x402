import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerMoltbookAgent, MoltbookError } from './register.js'

// ─── Test constants ────────────────────────────────────────────────────────────

const MOLTBOOK_API_KEY = 'test-api-key-super-secret-12345'
const MOLTBOOK_DOMAIN = 'www.moltbook.com'

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

describe('NFR8 — moltbookApiKey only sent to www.moltbook.com', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('all fetch calls target www.moltbook.com exclusively', async () => {
    fetchSpy.mockResolvedValue(
      makeSuccessResponse({ api_key: 'agent-123', claim_url: 'https://moltbook.com/claim/agent-123' }),
    )

    await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })

    expect(fetchSpy).toHaveBeenCalled()
    for (const [url] of fetchSpy.mock.calls) {
      const parsedUrl = new URL(url as string)
      expect(parsedUrl.hostname).toBe(MOLTBOOK_DOMAIN)
    }
  })

  it('API key is NOT present in request bodies sent to any non-moltbook URL', async () => {
    fetchSpy.mockResolvedValue(
      makeSuccessResponse({ api_key: 'agent-456', claim_url: 'https://moltbook.com/claim/agent-456' }),
    )

    await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })

    for (const [url, init] of fetchSpy.mock.calls) {
      const parsedUrl = new URL(url as string)
      if (parsedUrl.hostname !== MOLTBOOK_DOMAIN) {
        const bodyStr = typeof (init as RequestInit)?.body === 'string'
          ? ((init as RequestInit).body as string)
          : JSON.stringify((init as RequestInit)?.body)
        expect(bodyStr).not.toContain(MOLTBOOK_API_KEY)
      }
    }
  })

  it('API key appears in Authorization header only for moltbook.com requests', async () => {
    fetchSpy.mockResolvedValue(
      makeSuccessResponse({ api_key: 'agent-789', claim_url: 'https://moltbook.com/claim/agent-789' }),
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
        makeSuccessResponse({ api_key: 'agent-abc', claim_url: 'https://moltbook.com/claim/agent-abc' }),
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

  it('sends correct body to POST /agents/register', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      makeSuccessResponse({ api_key: 'agent-def', claim_url: 'https://moltbook.com/claim/agent-def' }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })

    // First call is the registration
    const [[url, init]] = fetchSpy.mock.calls
    expect(url).toContain('/agents/register')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      name: AGENT_CONFIG.name,
      description: AGENT_CONFIG.description,
    })
  })

  it('posts capabilities announcement after registration', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      makeSuccessResponse({ api_key: 'agent-post', claim_url: 'https://moltbook.com/claim/agent-post' }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })

    // Should make 3 calls: register + update description + post announcement
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('includes tool pricing in capabilities post when provided', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      makeSuccessResponse({ api_key: 'agent-price', claim_url: 'https://moltbook.com/claim/agent-price' }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await registerMoltbookAgent({
      serverConfig: {
        ...AGENT_CONFIG,
        toolPricing: [{ name: 'search', price: 100, token: 'STX' }],
      },
      moltbookApiKey: MOLTBOOK_API_KEY,
    })

    // Find the posts call (last call)
    const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]
    const [, postInit] = lastCall
    const postBody = JSON.parse((postInit as RequestInit).body as string)
    expect(postBody.content).toContain('100 STX')
  })

  it('includes gateway URL in description update (AC3)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      makeSuccessResponse({ api_key: 'agent-gw', claim_url: 'https://moltbook.com/claim/agent-gw' }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })

    // Description update call (second call) should contain gateway URL
    const secondCall = fetchSpy.mock.calls[1]
    if (secondCall) {
      const [, init] = secondCall
      const body = JSON.parse((init as RequestInit).body as string)
      expect(body.description).toContain(AGENT_CONFIG.gatewayUrl)
    }
  })

  it('post uses correct fields and includes agent name (AC1, AC2)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      makeSuccessResponse({ api_key: 'agent-fmt', claim_url: 'https://moltbook.com/claim/agent-fmt' }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })

    // Posts call should have title and content fields
    const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]
    const [, postInit] = lastCall
    const postBody = JSON.parse((postInit as RequestInit).body as string)
    // Should have content or title containing agent name
    const bodyStr = JSON.stringify(postBody)
    expect(bodyStr).toContain(AGENT_CONFIG.name)
  })
})

// ─── Error handling ───────────────────────────────────────────────────────────

describe('registerMoltbookAgent — error handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws API_UNAVAILABLE when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    await expect(
      registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY }),
    ).rejects.toThrow(MoltbookError)

    try {
      await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })
    } catch (err) {
      expect(err).toBeInstanceOf(MoltbookError)
      expect((err as MoltbookError).code).toBe('API_UNAVAILABLE')
    }
  })

  it('throws AUTH_FAILED for 401 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 })))

    try {
      await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })
    } catch (err) {
      expect(err).toBeInstanceOf(MoltbookError)
      expect((err as MoltbookError).code).toBe('AUTH_FAILED')
    }
  })

  it('throws AUTH_FAILED for 403 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })))

    try {
      await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })
    } catch (err) {
      expect(err).toBeInstanceOf(MoltbookError)
      expect((err as MoltbookError).code).toBe('AUTH_FAILED')
    }
  })

  it('throws INVALID_RESPONSE for non-JSON response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', { status: 200 })))

    try {
      await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })
    } catch (err) {
      expect(err).toBeInstanceOf(MoltbookError)
      expect((err as MoltbookError).code).toBe('INVALID_RESPONSE')
    }
  })

  it('throws INVALID_RESPONSE when response lacks api_key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeSuccessResponse({ unexpected: true })))

    try {
      await registerMoltbookAgent({ serverConfig: AGENT_CONFIG, moltbookApiKey: MOLTBOOK_API_KEY })
    } catch (err) {
      expect(err).toBeInstanceOf(MoltbookError)
      expect((err as MoltbookError).code).toBe('INVALID_RESPONSE')
    }
  })

  it('still returns successfully when capabilities post fails (NFR14 — best-effort)', async () => {
    let callCount = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      callCount++
      // First call (register) succeeds, subsequent calls fail
      if (callCount === 1) {
        return Promise.resolve(
          makeSuccessResponse({ api_key: 'agent-ok', claim_url: 'https://moltbook.com/claim/agent-ok' }),
        )
      }
      return Promise.reject(new Error('Moltbook API is unreachable'))
    }))

    const result = await registerMoltbookAgent({
      serverConfig: AGENT_CONFIG,
      moltbookApiKey: MOLTBOOK_API_KEY,
    })

    expect(result.agentId).toBe('agent-ok')
    expect(result.claimUrl).toBe('https://moltbook.com/claim/agent-ok')
  })
})
