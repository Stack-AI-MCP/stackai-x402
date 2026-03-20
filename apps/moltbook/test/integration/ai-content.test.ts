/**
 * Real AI content generation tests using OpenAI API.
 * Requires OPENAI_API_KEY env var — skipped if not set.
 *
 * Tests that the AI content generator produces real, useful content
 * (not template fallbacks) for skill.md, posts, comments.
 */

import { describe, it, expect } from 'vitest'
import type { MoltbookAgentRecord } from '../../src/types.js'

const OPENAI_KEY = process.env.OPENAI_API_KEY

const AGENT: MoltbookAgentRecord = {
  id: 'ai-test-agent',
  moltbookApiKey: 'moltbook_sk_test00000000000000000',
  moltbookName: 'midl-mcp-server',
  moltbookStatus: 'active',
  description: 'MCP server providing blockchain tools for the MIDL network — BTC/EVM bridging, smart contract deployment, rune management, and balance queries via x402 micropayments.',
  gatewayUrl: 'HTTPS://MCP.MIDL-AI.XYZ/MCP',
  toolNames: [
    'midl_get_network_info', 'midl_get_block', 'midl_get_evm_balance',
    'midl_get_btc_balance', 'midl_deploy_contract', 'midl_bridge_btc_to_evm',
    'midl_bridge_evm_to_btc', 'midl_get_runes', 'midl_transfer_rune',
  ],
  toolPricing: [
    { name: 'midl_get_network_info', price: 0.0001, token: 'STX' },
    { name: 'midl_get_block', price: 0.0001, token: 'STX' },
    { name: 'midl_get_evm_balance', price: 0.0001, token: 'STX' },
    { name: 'midl_get_btc_balance', price: 0.0001, token: 'STX' },
    { name: 'midl_deploy_contract', price: 0.0001, token: 'STX' },
    { name: 'midl_bridge_btc_to_evm', price: 0.0001, token: 'STX' },
    { name: 'midl_bridge_evm_to_btc', price: 0.0001, token: 'STX' },
    { name: 'midl_get_runes', price: 0.0001, token: 'STX' },
    { name: 'midl_transfer_rune', price: 0.0001, token: 'STX' },
  ],
  heartbeatIntervalHours: 6,
  heartbeatEnabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  skillMd: '# MIDL MCP Server\nProvides 29 blockchain tools via x402 protocol on Stacks.',
}

describe.skipIf(!OPENAI_KEY)('AI Content Generation (live OpenAI)', () => {
  async function getGenerator() {
    const { OpenAIContentGenerator } = await import('../../src/ai/openai-generator.js')
    return new OpenAIContentGenerator(OPENAI_KEY!)
  }

  it('generates a skill.md with tool descriptions', async () => {
    const gen = await getGenerator()
    const skillMd = await gen.generateSkillMd(AGENT)

    expect(skillMd).toBeDefined()
    expect(typeof skillMd).toBe('string')
    expect(skillMd.length).toBeGreaterThan(100)
    // Should mention real tools
    expect(skillMd.toLowerCase()).toMatch(/midl|bridge|deploy|balance/i)
    // Should be markdown
    expect(skillMd).toContain('#')
    // Should mention x402 or payment
    expect(skillMd.toLowerCase()).toMatch(/x402|payment|pay/i)
  }, 30_000)

  it('generates a status post with title and content', async () => {
    const gen = await getGenerator()
    const post = await gen.generateStatusPost(AGENT)

    expect(post).toBeDefined()
    expect(post.title).toBeDefined()
    expect(post.title.length).toBeGreaterThan(5)
    expect(post.content).toBeDefined()
    expect(post.content.length).toBeGreaterThan(20)
    // Should mention specific tools or the gateway
    const combined = (post.title + post.content).toLowerCase()
    expect(combined).toMatch(/midl|bridge|deploy|x402|mcp/)
  }, 30_000)

  it('generates a contextual comment that promotes tools', async () => {
    const gen = await getGenerator()
    const comment = await gen.generateComment(
      AGENT,
      'Bitcoin DeFi is growing fast — bridging is the next frontier',
      'More developers are building cross-chain bridges. BTC to EVM is where the action is.',
    )

    expect(comment).toBeDefined()
    expect(typeof comment).toBe('string')
    expect(comment.length).toBeGreaterThan(10)
    expect(comment.length).toBeLessThan(2000)
    // Should mention a specific tool
    expect(comment.toLowerCase()).toMatch(/midl|bridge|tool|gateway/)
  }, 30_000)

  it('generates a payment celebration post', async () => {
    const gen = await getGenerator()
    const post = await gen.generatePaymentPost(AGENT, {
      serverId: 'srv-123',
      tool: 'midl_bridge_btc_to_evm',
      amount: '0.0001',
      token: 'STX',
      fromAddress: 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5',
      txid: 'abc123def456',
    })

    expect(post.title).toBeDefined()
    expect(post.content).toBeDefined()
    expect(post.content.length).toBeGreaterThan(20)
  }, 30_000)

  it('generates an error alert post', async () => {
    const gen = await getGenerator()
    const post = await gen.generateErrorPost(AGENT, {
      serverId: 'srv-123',
      agentId: 'agent-1',
      errorRate: 0.15,
      timestamp: Date.now(),
    })

    expect(post.title).toBeDefined()
    expect(post.content).toBeDefined()
    expect(post.content.length).toBeGreaterThan(20)
  }, 30_000)
})
