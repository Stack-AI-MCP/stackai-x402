import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock challenge solver
vi.mock('../src/moltbook/challenge-solver.js', () => ({
  createPostVerified: vi.fn().mockResolvedValue({ success: true }),
}))

import { handlePaymentEvent, handleErrorAlert } from '../src/events/event-handler.js'
import { createPostVerified } from '../src/moltbook/challenge-solver.js'
import type { PaymentEventPayload, ErrorAlertPayload, MoltbookAgentRecord } from '../src/types.js'
import type { ContentGenerator } from '../src/ai/types.js'

const MOCK_AGENT: MoltbookAgentRecord = {
  id: 'agent-1',
  gatewayServerId: 'server-xyz',
  moltbookApiKey: 'moltbook_testkey12345678901234',
  moltbookName: 'test-agent',
  moltbookStatus: 'active',
  description: 'Test agent',
  gatewayUrl: 'https://gateway.example.com/api/v1/proxy/server-xyz',
  toolNames: ['search'],
  heartbeatIntervalHours: 6,
  heartbeatEnabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

function mockAgentStore(agent: MoltbookAgentRecord | null = MOCK_AGENT) {
  return {
    findByServerId: vi.fn().mockResolvedValue(agent),
    get: vi.fn().mockResolvedValue(agent),
    list: vi.fn().mockResolvedValue(agent ? [agent] : []),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    setStatus: vi.fn(),
    setLastHeartbeat: vi.fn(),
    enrichWithServerTools: vi.fn().mockImplementation((a: MoltbookAgentRecord) => Promise.resolve(a)),
  } as any
}

function mockContentGenerator(): ContentGenerator {
  return {
    generateSkillMd: vi.fn().mockResolvedValue('# Skill'),
    generateStatusPost: vi.fn().mockResolvedValue({ title: 'Status', content: 'Online' }),
    generateComment: vi.fn().mockResolvedValue('Nice post!'),
    generatePaymentPost: vi.fn().mockResolvedValue({ title: 'Earned 1000000 STX via search', content: 'Just received payment' }),
    generateErrorPost: vi.fn().mockResolvedValue({ title: 'Error rate alert: 15.0% errors detected', content: 'Investigating' }),
  }
}

describe('event-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handlePaymentEvent', () => {
    const PAYMENT: PaymentEventPayload = {
      serverId: 'server-xyz',
      tool: 'search',
      amount: '1000000',
      token: 'STX',
      fromAddress: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
      txid: '0xdeadbeef',
    }

    it('creates a post when agent is linked and active', async () => {
      const store = mockAgentStore()
      const cg = mockContentGenerator()
      await handlePaymentEvent(PAYMENT, store, cg)

      expect(store.findByServerId).toHaveBeenCalledWith('server-xyz')
      expect(cg.generatePaymentPost).toHaveBeenCalledWith(MOCK_AGENT, PAYMENT)
      expect(createPostVerified).toHaveBeenCalledWith(
        'moltbook_testkey12345678901234',
        expect.objectContaining({
          submolt: 'general',
          title: expect.stringContaining('STX'),
        }),
      )
    })

    it('skips when no agent linked to serverId', async () => {
      const store = mockAgentStore(null)
      const cg = mockContentGenerator()
      await handlePaymentEvent(PAYMENT, store, cg)
      expect(createPostVerified).not.toHaveBeenCalled()
    })

    it('skips when agent is pending_claim', async () => {
      const agent = { ...MOCK_AGENT, moltbookStatus: 'pending_claim' as const }
      const store = mockAgentStore(agent)
      const cg = mockContentGenerator()
      await handlePaymentEvent(PAYMENT, store, cg)
      expect(createPostVerified).not.toHaveBeenCalled()
    })

    it('does not throw on post failure (best-effort)', async () => {
      vi.mocked(createPostVerified).mockRejectedValueOnce(new Error('Network error'))
      const store = mockAgentStore()
      const cg = mockContentGenerator()
      await handlePaymentEvent(PAYMENT, store, cg)
    })
  })

  describe('handleErrorAlert', () => {
    const ALERT: ErrorAlertPayload = {
      serverId: 'server-xyz',
      agentId: 'agent-1',
      errorRate: 0.15,
      timestamp: Date.now(),
    }

    it('creates a post about the error alert', async () => {
      const store = mockAgentStore()
      const cg = mockContentGenerator()
      await handleErrorAlert(ALERT, store, cg)

      expect(cg.generateErrorPost).toHaveBeenCalledWith(MOCK_AGENT, ALERT)
      expect(createPostVerified).toHaveBeenCalledWith(
        'moltbook_testkey12345678901234',
        expect.objectContaining({
          title: expect.stringContaining('15.0%'),
        }),
      )
    })

    it('skips when agent not found', async () => {
      const store = mockAgentStore(null)
      const cg = mockContentGenerator()
      await handleErrorAlert(ALERT, store, cg)
      expect(createPostVerified).not.toHaveBeenCalled()
    })
  })
})
