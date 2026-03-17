// ─── Proxy / Utility Integration Tests ──────────────────────────────────────
// Tests that hit real external APIs (Hiro) — network dependent.
// Skip in CI by setting CI_SKIP_INTEGRATION=true.

import { describe, it, expect } from 'vitest'
import { generateAgentWallet, getBalance, discoverAgents } from '../../src/proxy/index.js'

// Integration tests only run when TEST_GATEWAY_URL is explicitly configured.
// Set CI_SKIP_INTEGRATION=true to suppress them in CI even when configured.
const GATEWAY_URL = process.env.TEST_GATEWAY_URL ?? ''
const SKIP = !GATEWAY_URL || process.env.CI_SKIP_INTEGRATION === 'true'

describe.skipIf(SKIP)('generateAgentWallet()', () => {
  it('returns a 64-char hex private key and valid Stacks mainnet address', () => {
    const wallet = generateAgentWallet('mainnet')

    expect(wallet.privateKey).toMatch(/^[a-f0-9]{64}$/)
    expect(wallet.address).toMatch(/^SP/)
    expect(wallet.network).toBe('mainnet')
  })

  it('returns a valid Stacks testnet address when network=testnet', () => {
    const wallet = generateAgentWallet('testnet')

    expect(wallet.privateKey).toMatch(/^[a-f0-9]{64}$/)
    expect(wallet.address).toMatch(/^ST/)
    expect(wallet.network).toBe('testnet')
  })

  it('generates unique keys on each call', () => {
    const w1 = generateAgentWallet()
    const w2 = generateAgentWallet()

    expect(w1.privateKey).not.toBe(w2.privateKey)
    expect(w1.address).not.toBe(w2.address)
  })
})

describe.skipIf(SKIP)('getBalance() — Hiro API', () => {
  // Use a well-known funded mainnet address for a live balance check
  const KNOWN_ADDRESS = 'SP000000000000000000002Q6VF78'

  it('returns balance fields for a valid mainnet address', async () => {
    const result = await getBalance(KNOWN_ADDRESS, 'mainnet')

    expect(result.balance).toBeDefined()
    expect(typeof result.balance).toBe('string')
    expect(result.locked).toBeDefined()
    expect(typeof result.nonce).toBe('number')
    expect(result.nonce).toBeGreaterThanOrEqual(0)
  })

  it('throws a descriptive error for an invalid address', async () => {
    await expect(getBalance('not-a-stacks-address', 'mainnet')).rejects.toThrow()
  })
})

describe.skipIf(SKIP)('discoverAgents() — gateway', () => {
  it('returns an AgentListResponse with agents array and pagination', async () => {
    const result = await discoverAgents(GATEWAY_URL)

    expect(Array.isArray(result.agents)).toBe(true)
    expect(result.pagination).toBeDefined()
    expect(typeof result.pagination.total).toBe('number')
    expect(result.pagination.total).toBeGreaterThanOrEqual(0)
  })

  it('throws when gateway is unreachable', async () => {
    await expect(discoverAgents('http://localhost:19999')).rejects.toThrow()
  })
})
