// ─── Agent Management Integration Tests ─────────────────────────────────────
// Requires a running gateway at TEST_GATEWAY_URL and a valid TEST_PRIVATE_KEY.
// Skip in CI by setting CI_SKIP_INTEGRATION=true.
//
// Run: TEST_GATEWAY_URL=http://localhost:3001 TEST_PRIVATE_KEY=<hex> pnpm test tests/integration/

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createAgent,
  getAgent,
  listAgents,
  updateAgent,
  deleteAgent,
} from '../../src/server/index.js'
import type { AgentConfig } from '../../src/types/index.js'

const GATEWAY_URL = process.env.TEST_GATEWAY_URL ?? ''
const TEST_KEY = process.env.TEST_PRIVATE_KEY ?? ''
const SKIP = !GATEWAY_URL || !TEST_KEY || process.env.CI_SKIP_INTEGRATION === 'true'

describe.skipIf(SKIP)('Agent Management (integration)', () => {
  let createdAgent: AgentConfig

  beforeAll(async () => {
    // Verify gateway is reachable
    const res = await fetch(`${GATEWAY_URL}/api/v1/agents?limit=1`).catch(() => null)
    if (!res?.ok) {
      console.warn(`Gateway not reachable at ${GATEWAY_URL} — skipping integration tests`)
    }
  })

  afterAll(async () => {
    // Cleanup: delete the agent we created (best-effort)
    if (createdAgent?.agentId) {
      await deleteAgent(GATEWAY_URL, TEST_KEY, createdAgent.agentId).catch(() => {})
    }
  })

  it('createAgent() returns a valid AgentConfig', async () => {
    createdAgent = await createAgent(GATEWAY_URL, TEST_KEY, {
      name: 'SDK Integration Test Agent',
      description: 'Ephemeral agent created by SDK integration tests — safe to delete',
      tools: [],
      network: 'testnet',
    })

    expect(createdAgent.agentId).toBeDefined()
    expect(typeof createdAgent.agentId).toBe('string')
    expect(createdAgent.agentId.length).toBeGreaterThan(0)
    expect(createdAgent.name).toBe('SDK Integration Test Agent')
    expect(createdAgent.network).toBe('testnet')
    expect(createdAgent.ownerAddress).toBeDefined()
    expect(createdAgent.createdAt).toBeDefined()
  })

  it('getAgent() retrieves the created agent by ID', async () => {
    const fetched = await getAgent(GATEWAY_URL, createdAgent.agentId)

    expect(fetched.agentId).toBe(createdAgent.agentId)
    expect(fetched.name).toBe(createdAgent.name)
    expect(fetched.ownerAddress).toBe(createdAgent.ownerAddress)
  })

  it('listAgents() includes the created agent', async () => {
    const { agents, pagination } = await listAgents(GATEWAY_URL, { limit: 100 })

    expect(Array.isArray(agents)).toBe(true)
    expect(pagination.total).toBeGreaterThanOrEqual(1)

    const found = agents.find((a) => a.agentId === createdAgent.agentId)
    expect(found).toBeDefined()
    expect(found?.name).toBe(createdAgent.name)
  })

  it('updateAgent() updates the agent name and description', async () => {
    const updated = await updateAgent(GATEWAY_URL, TEST_KEY, createdAgent.agentId, {
      name: 'SDK Integration Test Agent (Updated)',
      description: 'Updated description from integration test',
    })

    expect(updated.agentId).toBe(createdAgent.agentId)
    expect(updated.name).toBe('SDK Integration Test Agent (Updated)')
    expect(updated.description).toBe('Updated description from integration test')
    expect(updated.updatedAt).not.toBe(createdAgent.updatedAt)
  })

  it('deleteAgent() removes the agent from the gateway', async () => {
    await deleteAgent(GATEWAY_URL, TEST_KEY, createdAgent.agentId)

    // Verify 404 on subsequent fetch
    await expect(getAgent(GATEWAY_URL, createdAgent.agentId)).rejects.toThrow()

    // Mark as cleaned up so afterAll doesn't retry
    createdAgent = { ...createdAgent, agentId: '' }
  })

  it('createAgent() throws a descriptive error for invalid input', async () => {
    await expect(
      createAgent(GATEWAY_URL, TEST_KEY, {
        name: '',
        description: '',
        tools: [],
        network: 'testnet',
      }),
    ).rejects.toThrow()
  })
})
