// ─── Client Integration Tests ────────────────────────────────────────────────
// Tests the x402-enabled axios client (createAgentClient).
// Real 402 flows require TEST_PRIVATE_KEY + a funded testnet address.
// Skip in CI by setting CI_SKIP_INTEGRATION=true.

import { describe, it, expect } from 'vitest'
import { createAgentClient } from '../../src/client/index.js'
import { generateAgentWallet } from '../../src/proxy/index.js'

const TEST_KEY = process.env.TEST_PRIVATE_KEY ?? ''
const GATEWAY_URL = process.env.TEST_GATEWAY_URL ?? ''
const SKIP = !GATEWAY_URL || process.env.CI_SKIP_INTEGRATION === 'true'

describe.skipIf(SKIP)('createAgentClient()', () => {
  it('returns an axios instance with payment interceptors', () => {
    const wallet = generateAgentWallet('testnet')
    const client = createAgentClient(wallet.privateKey, 'testnet')

    // Axios instance has get/post/interceptors
    expect(typeof client.get).toBe('function')
    expect(typeof client.post).toBe('function')
    expect(client.interceptors).toBeDefined()
  })

  it('can call a free endpoint without triggering 402', async () => {
    const wallet = generateAgentWallet('testnet')
    const client = createAgentClient(wallet.privateKey, 'testnet')

    // /api/v1/agents is a free public endpoint
    const res = await client.get(`${GATEWAY_URL}/api/v1/agents?limit=1`)
    expect(res.status).toBe(200)
    expect(res.data).toHaveProperty('agents')
  })
})

describe.skipIf(!TEST_KEY || SKIP)('createAgentClient() — authenticated calls', () => {
  it('creates a client from a real private key', () => {
    const client = createAgentClient(TEST_KEY, 'testnet')

    expect(typeof client.get).toBe('function')
    expect(client.interceptors).toBeDefined()
  })

  it('handles 404 from gateway without crashing', async () => {
    const client = createAgentClient(TEST_KEY, 'testnet')

    await expect(
      client.get(`${GATEWAY_URL}/api/v1/agents/nonexistent-agent-id-xyz`),
    ).rejects.toThrow()
  })
})
