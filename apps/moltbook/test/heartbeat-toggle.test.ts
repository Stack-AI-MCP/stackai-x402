/**
 * Tests for the heartbeat-toggle queue message handling in RegistrationConsumer.
 *
 * Verifies that when the gateway sends a heartbeat-toggle message:
 * 1. The agent store is updated with the new heartbeatEnabled value
 * 2. The heartbeat engine is started/stopped accordingly
 * 3. Gateway status is refreshed so the UI shows correct state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MoltbookAgentRecord } from '../src/types.js'

// Mock SDK + challenge solver (required for RegistrationConsumer import chain)
vi.mock('../src/moltbook/sdk/index.js', () => ({
  MoltbookClient: class { agents = { register: vi.fn() }; feed = { get: vi.fn() } },
}))
vi.mock('../src/moltbook/challenge-solver.js', () => ({
  createPostVerified: vi.fn(),
  createCommentVerified: vi.fn(),
}))

import { RegistrationConsumer } from '../src/queue/registration-consumer.js'

const AGENT: MoltbookAgentRecord = {
  id: 'moltbook-agent-1',
  gatewayAgentId: 'gateway-agent-1',
  moltbookApiKey: 'moltbook_testkey12345678901234',
  moltbookName: 'test-bot',
  moltbookStatus: 'active',
  description: 'Test agent',
  gatewayUrl: 'https://gateway.example.com',
  toolNames: ['get-price'],
  heartbeatIntervalHours: 6,
  heartbeatEnabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

function mockRedis() {
  return {
    brpop: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    lpush: vi.fn().mockResolvedValue(1),
  } as any
}

function mockStore(agents: MoltbookAgentRecord[] = []) {
  return {
    get: vi.fn().mockImplementation((id: string) =>
      Promise.resolve(agents.find((a) => a.id === id) ?? null),
    ),
    list: vi.fn().mockResolvedValue(agents),
    update: vi.fn().mockImplementation((id: string, updates: Record<string, unknown>) =>
      Promise.resolve({ ...agents.find((a) => a.id === id)!, ...updates }),
    ),
    create: vi.fn(),
    delete: vi.fn(),
    setStatus: vi.fn(),
    setLastHeartbeat: vi.fn(),
    setSkillMd: vi.fn(),
    updateApiKey: vi.fn(),
    findByServerId: vi.fn().mockResolvedValue(null),
    enrichWithServerTools: vi.fn().mockImplementation((a: MoltbookAgentRecord) => Promise.resolve(a)),
  } as any
}

function mockEngine() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    stopAll: vi.fn(),
    isRunning: vi.fn().mockReturnValue(false),
    triggerNow: vi.fn(),
    loadAll: vi.fn(),
    get activeCount() { return 0 },
  } as any
}

function mockContentGenerator() {
  return {
    generateSkillMd: vi.fn().mockResolvedValue('# Skill'),
    generateStatusPost: vi.fn().mockResolvedValue({ title: 'T', content: 'C' }),
    generateComment: vi.fn().mockResolvedValue('Comment'),
    generatePaymentPost: vi.fn().mockResolvedValue({ title: 'P', content: 'C' }),
    generateErrorPost: vi.fn().mockResolvedValue({ title: 'E', content: 'C' }),
  } as any
}

/**
 * Feed a single message and then stop the consumer cleanly.
 * brpop returns the message once, then blocks until consumer.stop() is called.
 */
async function runConsumerOnce(
  redis: ReturnType<typeof mockRedis>,
  store: ReturnType<typeof mockStore>,
  engine: ReturnType<typeof mockEngine>,
  msg: Record<string, unknown>,
) {
  const consumer = new RegistrationConsumer(redis, store, engine, mockContentGenerator(), 'https://gateway.example.com')

  let callCount = 0
  redis.brpop.mockImplementation(async () => {
    callCount++
    if (callCount === 1) {
      return ['moltbook:agent-registrations', JSON.stringify(msg)]
    }
    // After the first message is processed, stop the consumer and wait
    consumer.stop()
    // Return null so the while-loop exits on the running check
    return null
  })

  await consumer.start()
  return consumer
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('RegistrationConsumer — heartbeat-toggle', () => {
  let redis: ReturnType<typeof mockRedis>
  let store: ReturnType<typeof mockStore>
  let engine: ReturnType<typeof mockEngine>

  beforeEach(() => {
    redis = mockRedis()
    store = mockStore([AGENT])
    engine = mockEngine()
  })

  it('pauses heartbeat when heartbeatEnabled=false', async () => {
    await runConsumerOnce(redis, store, engine, {
      gatewayAgentId: 'gateway-agent-1',
      moltbookName: 'test-bot',
      heartbeatEnabled: false,
      action: 'heartbeat-toggle',
    })

    expect(store.update).toHaveBeenCalledWith('moltbook-agent-1', expect.objectContaining({
      heartbeatEnabled: false,
    }))
    expect(engine.stop).toHaveBeenCalledWith('moltbook-agent-1')
    expect(engine.start).not.toHaveBeenCalled()
  })

  it('resumes heartbeat when heartbeatEnabled=true', async () => {
    const pausedAgent = { ...AGENT, heartbeatEnabled: false }
    store = mockStore([pausedAgent])

    await runConsumerOnce(redis, store, engine, {
      gatewayAgentId: 'gateway-agent-1',
      moltbookName: 'test-bot',
      heartbeatEnabled: true,
      action: 'heartbeat-toggle',
    })

    expect(store.update).toHaveBeenCalledWith('moltbook-agent-1', expect.objectContaining({
      heartbeatEnabled: true,
    }))
    expect(engine.start).toHaveBeenCalledWith('moltbook-agent-1', 6) // uses agent's existing interval
    expect(engine.stop).not.toHaveBeenCalled()
  })

  it('updates interval when heartbeatIntervalHours provided', async () => {
    await runConsumerOnce(redis, store, engine, {
      gatewayAgentId: 'gateway-agent-1',
      moltbookName: 'test-bot',
      heartbeatEnabled: true,
      heartbeatIntervalHours: 2,
      action: 'heartbeat-toggle',
    })

    expect(store.update).toHaveBeenCalledWith('moltbook-agent-1', expect.objectContaining({
      heartbeatEnabled: true,
      heartbeatIntervalHours: 2,
    }))
    expect(engine.start).toHaveBeenCalledWith('moltbook-agent-1', 2)
  })

  it('ignores unknown agent without crashing', async () => {
    store = mockStore([]) // no agents

    await runConsumerOnce(redis, store, engine, {
      gatewayAgentId: 'unknown-agent-999',
      moltbookName: 'nonexistent-bot',
      heartbeatEnabled: false,
      action: 'heartbeat-toggle',
    })

    expect(store.update).not.toHaveBeenCalled()
    expect(engine.start).not.toHaveBeenCalled()
    expect(engine.stop).not.toHaveBeenCalled()
  })

  it('writes gateway status after toggle', async () => {
    engine.isRunning.mockReturnValue(false) // paused

    await runConsumerOnce(redis, store, engine, {
      gatewayAgentId: 'gateway-agent-1',
      moltbookName: 'test-bot',
      heartbeatEnabled: false,
      action: 'heartbeat-toggle',
    })

    // writeGatewayStatus calls redis.set with moltbook:status:{gatewayAgentId}
    expect(redis.set).toHaveBeenCalledWith(
      'moltbook:status:gateway-agent-1',
      expect.stringContaining('"heartbeatRunning":false'),
      'EX',
      expect.any(Number),
    )
  })
})
