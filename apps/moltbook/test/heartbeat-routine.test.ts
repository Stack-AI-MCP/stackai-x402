import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the SDK client
vi.mock('../src/moltbook/sdk/index.js', () => {
  class MockMoltbookClient {
    agents = {
      getStatus: vi.fn().mockResolvedValue({ status: 'claimed' }),
    }
    feed = {
      get: vi.fn().mockResolvedValue([
        { id: 'post-1', title: 'Bitcoin x402 payments are cool', content: 'Using stacks defi', score: 10, commentCount: 2, authorName: 'test', createdAt: new Date().toISOString() },
        { id: 'post-2', title: 'Random cooking recipe', content: 'How to make pasta', score: 5, commentCount: 0, authorName: 'chef', createdAt: new Date().toISOString() },
        { id: 'post-3', title: 'MCP agent protocol update', content: 'New x402 features', score: 15, commentCount: 3, authorName: 'dev', createdAt: new Date().toISOString() },
      ]),
    }
    posts = {
      upvote: vi.fn().mockResolvedValue({ success: true, action: 'upvoted' }),
    }
  }
  return { MoltbookClient: MockMoltbookClient }
})

// Mock challenge solver
vi.mock('../src/moltbook/challenge-solver.js', () => ({
  createPostVerified: vi.fn().mockResolvedValue({ success: true }),
  createCommentVerified: vi.fn().mockResolvedValue({ success: true }),
}))

import { runHeartbeat } from '../src/scheduler/heartbeat-routine.js'
import { createCommentVerified, createPostVerified } from '../src/moltbook/challenge-solver.js'
import type { MoltbookAgentRecord } from '../src/types.js'
import type { ContentGenerator } from '../src/ai/types.js'

const MOCK_AGENT: MoltbookAgentRecord = {
  id: 'agent-1',
  moltbookApiKey: 'moltbook_testkey12345678901234',
  moltbookName: 'test-agent',
  moltbookStatus: 'active',
  description: 'Test agent',
  gatewayUrl: 'https://gateway.example.com/api/v1/proxy/server-1',
  toolNames: ['search', 'analyze'],
  heartbeatIntervalHours: 6,
  heartbeatEnabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

function mockAgentStore(agent: MoltbookAgentRecord | null = MOCK_AGENT) {
  return {
    get: vi.fn().mockResolvedValue(agent),
    setStatus: vi.fn().mockResolvedValue(undefined),
    setLastHeartbeat: vi.fn().mockResolvedValue(undefined),
    findByServerId: vi.fn().mockResolvedValue(agent),
    list: vi.fn().mockResolvedValue(agent ? [agent] : []),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    enrichWithServerTools: vi.fn().mockImplementation((a: MoltbookAgentRecord) => Promise.resolve(a)),
  } as any
}

function mockTracker() {
  return {
    hasSeen: vi.fn().mockResolvedValue(false),
    markSeen: vi.fn().mockResolvedValue(undefined),
    hasVoted: vi.fn().mockResolvedValue(false),
    markVoted: vi.fn().mockResolvedValue(undefined),
    hasCommented: vi.fn().mockResolvedValue(false),
    markCommented: vi.fn().mockResolvedValue(undefined),
    canPost: vi.fn().mockResolvedValue(true),
    markPosted: vi.fn().mockResolvedValue(undefined),
    canComment: vi.fn().mockResolvedValue(true),
    markCommentedCooldown: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockResolvedValue({ seen: 0, voted: 0, commented: 0 }),
  } as any
}

function mockContentGenerator(): ContentGenerator {
  return {
    generateSkillMd: vi.fn().mockResolvedValue('# Skill'),
    generateStatusPost: vi.fn().mockResolvedValue({ title: 'Status update', content: 'Online and serving' }),
    generateComment: vi.fn().mockResolvedValue('Interesting post! I have tools that could help.'),
    generatePaymentPost: vi.fn().mockResolvedValue({ title: 'Payment received', content: 'Thanks!' }),
    generateErrorPost: vi.fn().mockResolvedValue({ title: 'Error alert', content: 'Investigating' }),
  }
}

// Helper to run heartbeat with auto-advancing fake timers
async function runWithTimers(fn: () => Promise<void>): Promise<void> {
  const promise = fn()
  // Keep advancing timers until the promise resolves
  for (let i = 0; i < 20; i++) {
    await vi.advanceTimersByTimeAsync(25_000)
  }
  return promise
}

describe('heartbeat-routine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips when agent not found', async () => {
    const store = mockAgentStore(null)
    const tracker = mockTracker()
    const cg = mockContentGenerator()
    await runHeartbeat('missing-id', store, tracker, cg)
    expect(tracker.hasSeen).not.toHaveBeenCalled()
  })

  it('skips when heartbeat is disabled', async () => {
    const agent = { ...MOCK_AGENT, heartbeatEnabled: false }
    const store = mockAgentStore(agent)
    const tracker = mockTracker()
    const cg = mockContentGenerator()
    await runHeartbeat('agent-1', store, tracker, cg)
    expect(tracker.hasSeen).not.toHaveBeenCalled()
  })

  it('marks relevant posts as seen and upvotes them', async () => {
    const store = mockAgentStore()
    const tracker = mockTracker()
    const cg = mockContentGenerator()
    await runWithTimers(() => runHeartbeat('agent-1', store, tracker, cg))

    // post-1 and post-3 are relevant (contain keywords), post-2 is not
    expect(tracker.markSeen).toHaveBeenCalledWith('agent-1', 'post-1')
    expect(tracker.markSeen).toHaveBeenCalledWith('agent-1', 'post-2')
    expect(tracker.markSeen).toHaveBeenCalledWith('agent-1', 'post-3')

    // Should upvote relevant posts
    expect(tracker.markVoted).toHaveBeenCalledWith('agent-1', 'post-1')
    expect(tracker.markVoted).toHaveBeenCalledWith('agent-1', 'post-3')
  })

  it('comments on highly relevant posts using AI content', async () => {
    const store = mockAgentStore()
    const tracker = mockTracker()
    const cg = mockContentGenerator()
    await runWithTimers(() => runHeartbeat('agent-1', store, tracker, cg))

    // post-1 and post-3 have multiple keywords → highly relevant → should comment
    expect(cg.generateComment).toHaveBeenCalled()
    expect(createCommentVerified).toHaveBeenCalled()
    expect(tracker.markCommented).toHaveBeenCalled()
  })

  it('posts a status update using AI content when cooldown allows', async () => {
    const store = mockAgentStore()
    const tracker = mockTracker()
    const cg = mockContentGenerator()
    await runWithTimers(() => runHeartbeat('agent-1', store, tracker, cg))

    expect(cg.generateStatusPost).toHaveBeenCalledWith(MOCK_AGENT)
    expect(createPostVerified).toHaveBeenCalled()
    expect(tracker.markPosted).toHaveBeenCalledWith('agent-1')
  })

  it('skips status post when cooldown active', async () => {
    const store = mockAgentStore()
    const tracker = mockTracker()
    tracker.canPost.mockResolvedValue(false)
    const cg = mockContentGenerator()
    await runWithTimers(() => runHeartbeat('agent-1', store, tracker, cg))

    expect(tracker.canPost).toHaveBeenCalledWith('agent-1')
    expect(cg.generateStatusPost).not.toHaveBeenCalled()
  })

  it('updates last heartbeat timestamp', async () => {
    const store = mockAgentStore()
    const tracker = mockTracker()
    const cg = mockContentGenerator()
    await runWithTimers(() => runHeartbeat('agent-1', store, tracker, cg))

    expect(store.setLastHeartbeat).toHaveBeenCalledWith('agent-1', expect.any(String))
  })

  it('skips already-seen posts', async () => {
    const store = mockAgentStore()
    const tracker = mockTracker()
    tracker.hasSeen.mockResolvedValue(true)
    const cg = mockContentGenerator()
    await runWithTimers(() => runHeartbeat('agent-1', store, tracker, cg))

    // Should still mark seen posts (they're checked), but not vote
    expect(tracker.markVoted).not.toHaveBeenCalled()
  })
})
