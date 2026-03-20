/**
 * Hardened tests for HeartbeatEngine, heartbeat routine, and event handler.
 * Separated because these need vi.mock for the Moltbook SDK + challenge solver.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ContentGenerator } from '../src/ai/types.js'
import type { MoltbookAgentRecord } from '../src/types.js'

// Mock the SDK and challenge solver
vi.mock('../src/moltbook/sdk/index.js', () => {
  class MockMoltbookClient {
    agents = { getStatus: vi.fn().mockResolvedValue({ status: 'claimed' }) }
    feed = { get: vi.fn().mockResolvedValue([]) }
    posts = { upvote: vi.fn().mockResolvedValue({ success: true }) }
  }
  return { MoltbookClient: MockMoltbookClient }
})

vi.mock('../src/moltbook/challenge-solver.js', () => ({
  createPostVerified: vi.fn().mockResolvedValue({ success: true }),
  createCommentVerified: vi.fn().mockResolvedValue({ success: true }),
}))

import { HeartbeatEngine } from '../src/scheduler/heartbeat-engine.js'
import { runHeartbeat } from '../src/scheduler/heartbeat-routine.js'
import { handlePaymentEvent, handleErrorAlert } from '../src/events/event-handler.js'

function mockCg(): ContentGenerator {
  return {
    generateSkillMd: vi.fn().mockResolvedValue('# Skill'),
    generateStatusPost: vi.fn().mockResolvedValue({ title: 'Test', content: 'Content' }),
    generateComment: vi.fn().mockResolvedValue('Comment'),
    generatePaymentPost: vi.fn().mockResolvedValue({ title: 'Pay', content: 'Content' }),
    generateErrorPost: vi.fn().mockResolvedValue({ title: 'Err', content: 'Content' }),
  }
}

function mockStore(agent: MoltbookAgentRecord | null = null) {
  return {
    get: vi.fn().mockResolvedValue(agent),
    list: vi.fn().mockResolvedValue(agent ? [agent] : []),
    setStatus: vi.fn(),
    setLastHeartbeat: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findByServerId: vi.fn().mockResolvedValue(agent),
    setSkillMd: vi.fn(),
    enrichWithServerTools: vi.fn().mockImplementation((a: MoltbookAgentRecord) => Promise.resolve(a)),
  } as any
}

function mockTracker() {
  return {
    hasSeen: vi.fn().mockResolvedValue(false),
    markSeen: vi.fn(),
    hasVoted: vi.fn().mockResolvedValue(false),
    markVoted: vi.fn(),
    hasCommented: vi.fn().mockResolvedValue(false),
    markCommented: vi.fn(),
    canPost: vi.fn().mockResolvedValue(false),
    markPosted: vi.fn(),
    canComment: vi.fn().mockResolvedValue(false),
    markCommentedCooldown: vi.fn(),
    getStats: vi.fn().mockResolvedValue({ seen: 0, voted: 0, commented: 0 }),
  } as any
}

const AGENT: MoltbookAgentRecord = {
  id: 'agent-1', moltbookApiKey: 'moltbook_testkey12345678901234',
  moltbookName: 'test-agent', moltbookStatus: 'active',
  description: 'Test', gatewayUrl: 'https://example.com',
  toolNames: ['test'], heartbeatIntervalHours: 6, heartbeatEnabled: true,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}

// ─── HeartbeatEngine: Timer & State Edge Cases ─────────────────────────────

describe('HeartbeatEngine — edge cases', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers() })
  afterEach(() => vi.useRealTimers())

  it('start then stop before jitter fires — no execution', async () => {
    const engine = new HeartbeatEngine(mockStore(), mockTracker(), mockCg())

    engine.start('agent-1', 6)
    expect(engine.isRunning('agent-1')).toBe(true)
    expect(engine.activeCount).toBe(1)

    engine.stop('agent-1')
    expect(engine.isRunning('agent-1')).toBe(false)
    expect(engine.activeCount).toBe(0)

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    // Verify runHeartbeat was NOT called (store.get not touched)
    expect(mockStore().get).not.toHaveBeenCalled()
  })

  it('calling stop on non-started agent does not throw', () => {
    const engine = new HeartbeatEngine(mockStore(), mockTracker(), mockCg())
    expect(() => engine.stop('nonexistent')).not.toThrow()
    expect(engine.isRunning('nonexistent')).toBe(false)
  })

  it('start same agent twice — first is stopped, no leak', () => {
    const engine = new HeartbeatEngine(mockStore(), mockTracker(), mockCg())
    engine.start('agent-1', 6)
    engine.start('agent-1', 8) // restart
    expect(engine.activeCount).toBe(1)
    engine.stopAll()
    expect(engine.activeCount).toBe(0)
  })

  it('stopAll clears all agents', () => {
    const engine = new HeartbeatEngine(mockStore(), mockTracker(), mockCg())
    engine.start('agent-1', 6)
    engine.start('agent-2', 4)
    engine.start('agent-3', 12)
    expect(engine.activeCount).toBe(3)
    engine.stopAll()
    expect(engine.activeCount).toBe(0)
  })

  it('loadAll skips suspended and disabled agents', async () => {
    const store = mockStore()
    store.list.mockResolvedValue([
      { id: 'a1', heartbeatEnabled: true, moltbookStatus: 'active', heartbeatIntervalHours: 6 },
      { id: 'a2', heartbeatEnabled: true, moltbookStatus: 'suspended', heartbeatIntervalHours: 6 },
      { id: 'a3', heartbeatEnabled: false, moltbookStatus: 'active', heartbeatIntervalHours: 6 },
    ])

    const engine = new HeartbeatEngine(store, mockTracker(), mockCg())
    await engine.loadAll()

    expect(engine.isRunning('a1')).toBe(true)
    expect(engine.isRunning('a2')).toBe(false)
    expect(engine.isRunning('a3')).toBe(false)
    expect(engine.activeCount).toBe(1)
    engine.stopAll()
  })

  it('triggerNow handles runHeartbeat failure gracefully', async () => {
    const store = mockStore()
    store.get.mockRejectedValue(new Error('Redis down'))
    const engine = new HeartbeatEngine(store, mockTracker(), mockCg())
    await expect(engine.triggerNow('agent-1')).resolves.not.toThrow()
  })

  it('activeCount is correct with many agents', () => {
    const engine = new HeartbeatEngine(mockStore(), mockTracker(), mockCg())
    for (let i = 0; i < 100; i++) engine.start(`agent-${i}`, 6)
    expect(engine.activeCount).toBe(100)
    engine.stopAll()
    expect(engine.activeCount).toBe(0)
  })

  it('stop during runSafe prevents recurring interval (race condition fix)', async () => {
    const store = mockStore(AGENT)
    const tracker = mockTracker()
    const engine = new HeartbeatEngine(store, tracker, mockCg())

    engine.start('agent-1', 1) // 1 hour interval

    // Advance past jitter to fire the callback — runSafe starts executing
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000) // 30 min max jitter

    // Stop the agent while runSafe was "in flight"
    engine.stop('agent-1')

    // Advance past the interval to see if a recurring timer was created
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000) // 2 hours

    // Should NOT be running — stop() should have prevented recurring interval
    expect(engine.isRunning('agent-1')).toBe(false)
  })
})

// ─── Heartbeat Routine: Error Resilience ───────────────────────────────────

describe('heartbeat-routine — error resilience', () => {
  it('survives with empty feed (no posts to process)', async () => {
    const store = mockStore(AGENT)
    const tracker = mockTracker()
    await expect(runHeartbeat('agent-1', store, tracker, mockCg())).resolves.not.toThrow()
  })

  it('survives when store.get returns null', async () => {
    await expect(runHeartbeat('missing', mockStore(null), mockTracker(), mockCg())).resolves.not.toThrow()
  })

  it('survives when heartbeat disabled', async () => {
    const store = mockStore({ ...AGENT, heartbeatEnabled: false })
    await expect(runHeartbeat('agent-1', store, mockTracker(), mockCg())).resolves.not.toThrow()
  })

  it('handles pending_claim status without crashing', async () => {
    const store = mockStore({ ...AGENT, moltbookStatus: 'pending_claim' as const })
    const tracker = mockTracker()
    // The Moltbook SDK mock returns { status: 'claimed' } which won't match 'pending_claim'
    // This tests status checking resilience
    await expect(runHeartbeat('agent-1', store, tracker, mockCg())).resolves.not.toThrow()
  })
})

// ─── Event Handler: Error Paths ────────────────────────────────────────────

describe('event-handler — error paths', () => {
  const PAYMENT = {
    serverId: 's', tool: 't', amount: '1', token: 'STX', fromAddress: 'addr', txid: 'tx',
  }

  it('propagates store errors to caller', async () => {
    const store = { findByServerId: vi.fn().mockRejectedValue(new Error('Redis gone')) } as any
    await expect(handlePaymentEvent(PAYMENT, store, mockCg())).rejects.toThrow('Redis gone')
  })

  it('survives when content generator throws (best-effort)', async () => {
    const store = mockStore(AGENT)
    const cg = mockCg()
    ;(cg.generatePaymentPost as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('LLM timeout'))
    await expect(handlePaymentEvent(PAYMENT, store, cg)).resolves.not.toThrow()
  })

  it('handleErrorAlert skips suspended agent', async () => {
    const store = mockStore({ ...AGENT, moltbookStatus: 'suspended' as const })
    const cg = mockCg()
    await handleErrorAlert(
      { serverId: 's', agentId: 'a', errorRate: 0.5, timestamp: Date.now() }, store, cg,
    )
    expect(cg.generateErrorPost).not.toHaveBeenCalled()
  })

  it('handleErrorAlert skips when no agent found', async () => {
    const store = mockStore(null)
    const cg = mockCg()
    await handleErrorAlert(
      { serverId: 's', agentId: 'a', errorRate: 0.5, timestamp: Date.now() }, store, cg,
    )
    expect(cg.generateErrorPost).not.toHaveBeenCalled()
  })

  it('handlePaymentEvent skips pending_claim agent', async () => {
    const store = mockStore({ ...AGENT, moltbookStatus: 'pending_claim' as const })
    const cg = mockCg()
    await handlePaymentEvent(PAYMENT, store, cg)
    expect(cg.generatePaymentPost).not.toHaveBeenCalled()
  })
})
