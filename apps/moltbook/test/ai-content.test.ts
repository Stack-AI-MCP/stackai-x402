import { describe, it, expect } from 'vitest'
import { TemplateContentGenerator } from '../src/ai/template-generator.js'
import type { MoltbookAgentRecord, PaymentEventPayload, ErrorAlertPayload } from '../src/types.js'

const AGENT: MoltbookAgentRecord = {
  id: 'agent-1',
  moltbookApiKey: 'moltbook_testkey12345678901234',
  moltbookName: 'stacks-defi-agent',
  moltbookStatus: 'active',
  description: 'A DeFi agent for Stacks Bitcoin L2',
  gatewayUrl: 'https://gateway.example.com/api/v1/proxy/server-1',
  toolNames: ['swap', 'stake', 'bridge'],
  toolPricing: [
    { name: 'swap', price: 1000, token: 'STX' },
    { name: 'stake', price: 500, token: 'STX' },
  ],
  heartbeatIntervalHours: 6,
  heartbeatEnabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

describe('TemplateContentGenerator', () => {
  const gen = new TemplateContentGenerator()

  describe('generateSkillMd', () => {
    it('generates markdown with agent name and tools', async () => {
      const result = await gen.generateSkillMd(AGENT)
      expect(result).toContain('# stacks-defi-agent')
      expect(result).toContain('A DeFi agent for Stacks Bitcoin L2')
      expect(result).toContain('swap')
      expect(result).toContain('stake')
      expect(result).toContain('x402')
      expect(result).toContain('gateway.example.com')
    })

    it('includes pricing when available', async () => {
      const result = await gen.generateSkillMd(AGENT)
      expect(result).toContain('1000 STX')
      expect(result).toContain('500 STX')
    })

    it('lists tool names when no pricing', async () => {
      const agentNoPricing = { ...AGENT, toolPricing: undefined }
      const result = await gen.generateSkillMd(agentNoPricing)
      expect(result).toContain('- swap')
      expect(result).toContain('- stake')
      expect(result).toContain('- bridge')
    })
  })

  describe('generateStatusPost', () => {
    it('returns title and content', async () => {
      const result = await gen.generateStatusPost(AGENT)
      expect(result.title).toBeTruthy()
      expect(result.content).toBeTruthy()
      expect(result.title).toContain('3 tools')
      expect(result.content).toContain('gateway.example.com')
    })
  })

  describe('generateComment', () => {
    it('returns a comment string', async () => {
      const result = await gen.generateComment(AGENT, 'Bitcoin DeFi news', 'New protocol launched')
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(10)
    })
  })

  describe('generatePaymentPost', () => {
    it('generates post about payment', async () => {
      const payment: PaymentEventPayload = {
        serverId: 'server-1',
        tool: 'swap',
        amount: '5000',
        token: 'STX',
        fromAddress: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
        txid: '0xabc123',
      }
      const result = await gen.generatePaymentPost(AGENT, payment)
      expect(result.title).toContain('5000')
      expect(result.title).toContain('STX')
      expect(result.content).toContain('swap')
    })
  })

  describe('generateErrorPost', () => {
    it('generates error alert post', async () => {
      const alert: ErrorAlertPayload = {
        serverId: 'server-1',
        agentId: 'agent-1',
        errorRate: 0.15,
        timestamp: Date.now(),
      }
      const result = await gen.generateErrorPost(AGENT, alert)
      expect(result.title).toContain('15.0%')
      expect(result.content).toContain('error')
    })
  })
})
