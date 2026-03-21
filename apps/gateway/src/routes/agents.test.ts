import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApp } from '../app.js'

// Mock wallet signature verification — real crypto is tested in auth.service.test.ts
vi.mock('../services/auth.service.js', () => ({
  verifyMessageSignature: () => true,
}))

const ENCRYPTION_KEY = 'a'.repeat(64)

function makeRedis() {
  const store = new Map<string, string>()
  const queues = new Map<string, string[]>()
  return {
    set: vi.fn(async (key: string, value: string, ..._rest: unknown[]) => { store.set(key, value); return 'OK' as string | null }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => { store.delete(key); return 1 }),
    scan: vi.fn(async (_c: string, _m: string, pattern: string) => {
      const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
      return ['0', Array.from(store.keys()).filter((k) => re.test(k))] as [string, string[]]
    }),
    mget: vi.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
    incr: vi.fn(async () => 1),
    incrby: vi.fn(async () => 1),
    pfadd: vi.fn(async () => 1),
    pfcount: vi.fn(async () => 0),
    zadd: vi.fn(async () => 1),
    zrevrange: vi.fn(async () => []),
    zcard: vi.fn(async () => 0),
    zrem: vi.fn(async () => 1),
    lpush: vi.fn(async (key: string, value: string) => {
      const q = queues.get(key) ?? []
      q.push(value)
      queues.set(key, q)
      return q.length
    }),
    _store: store,
    _queues: queues,
  }
}

const DEPS = {
  encryptionKey: ENCRYPTION_KEY,
  relayUrl: 'https://relay.example.com',
  testnetRelayUrl: 'https://relay-testnet.example.com',
  tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 } as const,
}

const OWNER_ADDRESS = 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159'

const AUTH_FIELDS = {
  signature: 'deadbeef'.repeat(16) + '01',
  publicKey: '03' + 'ab'.repeat(32),
  signedMessage: JSON.stringify({ action: 'update', timestamp: new Date().toISOString() }),
}

/** Seed an agent directly in Redis so we can test PUT without POST flow */
function seedAgent(redis: ReturnType<typeof makeRedis>, agentId: string, overrides: Record<string, unknown> = {}) {
  const agent = {
    agentId,
    name: 'Test Agent',
    description: 'A test agent',
    ownerAddress: OWNER_ADDRESS,
    tools: [{ serverId: 'srv-1', toolName: 'get-price', price: 0.01 }],
    moltbookName: 'test-bot',
    heartbeatEnabled: true,
    heartbeatIntervalHours: 6,
    network: 'mainnet',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
  redis._store.set(`agent:${agentId}:config`, JSON.stringify(agent))
  return agent
}

// ─── PUT /agents/:agentId — heartbeat toggle queue behavior ──────────────────

describe('PUT /api/v1/agents/:agentId heartbeat-toggle queue', () => {
  let redis: ReturnType<typeof makeRedis>
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    redis = makeRedis()
    app = createApp({ redis, ...DEPS })
  })

  it('queues heartbeat-toggle with heartbeatEnabled=false', async () => {
    const agentId = '01JTEST00000000000000000AA'
    seedAgent(redis, agentId)

    const res = await app.request(`/api/v1/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ heartbeatEnabled: false, ...AUTH_FIELDS }),
    })

    expect(res.status).toBe(200)

    const queued = redis._queues.get('moltbook:agent-registrations')
    expect(queued).toBeDefined()
    const toggleMsg = queued!.map((j) => JSON.parse(j)).find((m) => m.action === 'heartbeat-toggle')
    expect(toggleMsg).toBeDefined()
    expect(toggleMsg.gatewayAgentId).toBe(agentId)
    expect(toggleMsg.heartbeatEnabled).toBe(false)
    expect(toggleMsg.moltbookName).toBe('test-bot')
  })

  it('queues heartbeat-toggle with heartbeatEnabled=true', async () => {
    const agentId = '01JTEST00000000000000000BB'
    seedAgent(redis, agentId, { heartbeatEnabled: false })

    const res = await app.request(`/api/v1/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ heartbeatEnabled: true, ...AUTH_FIELDS }),
    })

    expect(res.status).toBe(200)

    const queued = redis._queues.get('moltbook:agent-registrations')
    const toggleMsg = queued!.map((j) => JSON.parse(j)).find((m) => m.action === 'heartbeat-toggle')
    expect(toggleMsg).toBeDefined()
    expect(toggleMsg.heartbeatEnabled).toBe(true)
  })

  it('does NOT queue heartbeat-toggle when only moltbookApiKey changes', async () => {
    const agentId = '01JTEST00000000000000000CC'
    seedAgent(redis, agentId)

    const res = await app.request(`/api/v1/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moltbookApiKey: 'moltbook_new_key_123', ...AUTH_FIELDS }),
    })

    expect(res.status).toBe(200)

    const queued = redis._queues.get('moltbook:agent-registrations') ?? []
    const toggleMsgs = queued.map((j) => JSON.parse(j)).filter((m) => m.action === 'heartbeat-toggle')
    expect(toggleMsgs).toHaveLength(0)
  })

  it('includes heartbeatIntervalHours in toggle message when both are provided', async () => {
    const agentId = '01JTEST00000000000000000DD'
    seedAgent(redis, agentId)

    const res = await app.request(`/api/v1/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ heartbeatEnabled: true, heartbeatIntervalHours: 2, ...AUTH_FIELDS }),
    })

    expect(res.status).toBe(200)

    const queued = redis._queues.get('moltbook:agent-registrations')!
    const toggleMsg = queued.map((j) => JSON.parse(j)).find((m) => m.action === 'heartbeat-toggle')
    expect(toggleMsg.heartbeatEnabled).toBe(true)
    expect(toggleMsg.heartbeatIntervalHours).toBe(2)
  })
})
