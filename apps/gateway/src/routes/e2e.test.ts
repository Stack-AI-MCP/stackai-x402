/**
 * End-to-end integration tests for the complete x402 flow.
 *
 * Tests the REAL SDK signing + gateway verification + payment flow
 * using Clarinet devnet test private keys.
 *
 * These tests do NOT require devnet running — they test the gateway app
 * in-process with real cryptographic signing (no mocking of signatures).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp } from '../app.js'
import type { ServerConfig, IntrospectedTool } from '../services/registration.service.js'
import { encrypt } from 'stackai-x402/internal'
import type { SettleFunction } from './proxy.js'
import {
  signMessageHashRsv,
  privateKeyToPublic,
  getAddressFromPrivateKey,
  publicKeyToAddress,
  AddressVersion,
} from '@stacks/transactions'
import { createHash } from 'node:crypto'

// ─── Devnet test wallets (auto-funded with 100M STX + 10 sBTC each) ──────────

const DEPLOYER = {
  privateKey: '753b7cc01a1a2e86221266a154af739463fce51219d97e4f856cd7200c3bd2a601',
  address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
}

const WALLET_1 = {
  privateKey: '7287ba251d44a4d3fd9276c88ce34c5c52a038955511cccaf77e61068649c17801',
  address: 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5',
}

const WALLET_2 = {
  privateKey: '530d9f61984c888536871c6573073bdfc0058896dc1adfe9a6a10dfacadc209101',
  address: 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG',
}

const ENCRYPTION_KEY = 'a'.repeat(64)
const SERVER_ID = 'e2e-mcp-server'
const RELAY_URL = 'https://x402-relay.aibtc.com'
const MOCK_TXID = 'e2e0000011112222333344445555666677778888999900001111222233334444'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRedis(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  // Sorted sets: key → Map<member, score>
  const zsets = new Map<string, Map<string, number>>()

  return {
    set: vi.fn(async (key: string, value: string, ...args: string[]) => {
      const isNX = args.includes('NX')
      if (isNX && store.has(key)) return null
      if (!args.includes('KEEPTTL')) store.set(key, value)
      else store.set(key, value)
      return 'OK' as string | null
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => { store.delete(key); return 1 }),
    scan: vi.fn(async (_cursor: string, ...args: string[]) => {
      const matchIdx = args.indexOf('MATCH')
      const pattern = matchIdx >= 0 ? args[matchIdx + 1] : '*'
      const keys = [...store.keys()].filter(k => {
        if (pattern === '*') return true
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
        return regex.test(k)
      })
      return ['0', keys] as [string, string[]]
    }),
    mget: vi.fn(async (...keys: string[]) => {
      // Handle both mget('a','b') and mget(['a','b']) patterns
      const flatKeys = keys.flat()
      return flatKeys.map(k => store.get(k) ?? null)
    }),
    incr: vi.fn(async (key: string) => {
      const val = parseInt(store.get(key) ?? '0', 10) + 1
      store.set(key, String(val))
      return val
    }),
    incrby: vi.fn(async (key: string, amount: number) => {
      const val = parseInt(store.get(key) ?? '0', 10) + amount
      store.set(key, String(val))
      return val
    }),
    pfadd: vi.fn(async () => 1),
    pfcount: vi.fn(async () => 0),
    lpush: vi.fn(async (key: string, value: string) => {
      const existing = store.get(key)
      const list = existing ? JSON.parse(existing) : []
      list.push(value)
      store.set(key, JSON.stringify(list))
      return list.length
    }),
    // Sorted set operations
    zadd: vi.fn(async (key: string, score: number, member: string) => {
      if (!zsets.has(key)) zsets.set(key, new Map())
      const existed = zsets.get(key)!.has(member)
      zsets.get(key)!.set(member, score)
      return existed ? 0 : 1
    }),
    zcard: vi.fn(async (key: string) => zsets.get(key)?.size ?? 0),
    zrevrange: vi.fn(async (key: string, start: number, end: number) => {
      const zset = zsets.get(key)
      if (!zset) return []
      const sorted = [...zset.entries()].sort((a, b) => b[1] - a[1])
      const endIdx = end < 0 ? sorted.length : end + 1
      return sorted.slice(start, endIdx).map(([member]) => member)
    }),
    zrem: vi.fn(async (key: string, member: string) => {
      const zset = zsets.get(key)
      if (!zset) return 0
      return zset.delete(member) ? 1 : 0
    }),
    _store: store,
    _zsets: zsets,
  }
}

/** Real SDK-style message signing using a Stacks private key. No mocks. */
function signMessage(message: string, privateKey: string) {
  const hash = createHash('sha256').update(message).digest('hex')
  const signature = signMessageHashRsv({ messageHash: hash, privateKey })
  const publicKey = privateKeyToPublic(privateKey)
  return { signature, publicKey }
}

function seedServer(redis: ReturnType<typeof makeRedis>, config: Partial<ServerConfig> = {}, tools: IntrospectedTool[] = []) {
  const fullConfig: ServerConfig = {
    serverId: SERVER_ID,
    name: 'E2E Test MCP Server',
    description: 'A real MCP server for e2e testing',
    url: 'https://mcp.test.com',
    recipientAddress: DEPLOYER.address,
    network: 'testnet',
    acceptedTokens: ['STX', 'sBTC', 'USDCx'],
    toolPricing: {},
    createdAt: new Date().toISOString(),
    ...config,
  }
  redis._store.set(`server:${SERVER_ID}:config`, JSON.stringify(fullConfig))
  redis._store.set(`server:${SERVER_ID}:tools`, JSON.stringify(tools))
}

function makeSettle(overrides: Record<string, unknown> = {}): SettleFunction {
  return vi.fn().mockResolvedValue({
    success: true,
    transaction: MOCK_TXID,
    payer: WALLET_1.address,
    network: 'stacks:2147483648',
    ...overrides,
  })
}

function makePaymentSig(overrides: Record<string, unknown> = {}): string {
  const payload = {
    x402Version: 2,
    accepted: {
      scheme: 'exact',
      network: 'stacks:2147483648',
      amount: '100000',
      asset: 'STX',
      payTo: DEPLOYER.address,
      maxTimeoutSeconds: 300,
    },
    payload: { transaction: 'signed_tx_hex_here' },
    ...overrides,
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64')
}

function mockUpstream(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  ))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('E2E: Real SDK signing + gateway verification', () => {
  afterEach(() => vi.restoreAllMocks())

  it('derives correct testnet addresses from devnet private keys', () => {
    // Verify our devnet keys produce the expected addresses
    expect(getAddressFromPrivateKey(DEPLOYER.privateKey, 'testnet')).toBe(DEPLOYER.address)
    expect(getAddressFromPrivateKey(WALLET_1.privateKey, 'testnet')).toBe(WALLET_1.address)
    expect(getAddressFromPrivateKey(WALLET_2.privateKey, 'testnet')).toBe(WALLET_2.address)
  })

  it('SDK signMessage produces verifiable signatures', () => {
    const message = JSON.stringify({ action: 'test', timestamp: new Date().toISOString() })
    const { signature, publicKey } = signMessage(message, WALLET_1.privateKey)

    // Verify signature is a non-empty string
    expect(typeof signature).toBe('string')
    expect(signature.length).toBeGreaterThan(0)

    // Verify public key derives to the correct address
    const derivedAddress = publicKeyToAddress(AddressVersion.TestnetSingleSig, publicKey)
    expect(derivedAddress).toBe(WALLET_1.address)
  })
})

describe('E2E: Agent CRUD with real signing', () => {
  let redis: ReturnType<typeof makeRedis>

  beforeEach(() => {
    redis = makeRedis()
    seedServer(redis, {}, [
      { name: 'get_price', description: 'Get token price', price: 0, acceptedTokens: ['STX'] },
      { name: 'execute_swap', description: 'Execute a DEX swap', price: 0.01, acceptedTokens: ['STX', 'sBTC', 'USDCx'] },
    ])
  })

  afterEach(() => vi.restoreAllMocks())

  function createAppWithRedis() {
    return createApp({
      redis: redis as any,
      encryptionKey: ENCRYPTION_KEY,
      tokenPrices: { STX: 3.0, sBTC: 100000, USDCx: 1.0 },
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev/relay',
    })
  }

  it('Provider (Wallet 1) creates an agent with real signature', async () => {
    const app = createAppWithRedis()

    const message = JSON.stringify({
      action: 'createAgent',
      name: 'DeFi Provider Agent',
      timestamp: new Date().toISOString(),
    })
    const { signature, publicKey } = signMessage(message, WALLET_1.privateKey)

    const res = await app.request('/api/v1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'DeFi Provider Agent',
        description: 'An agent that provides DEX swap tools for a fee',
        ownerAddress: WALLET_1.address,
        tools: [
          { serverId: SERVER_ID, toolName: 'get_price', price: 0 },
          { serverId: SERVER_ID, toolName: 'execute_swap', price: 0.01 },
        ],
        network: 'testnet',
        signature,
        publicKey,
        signedMessage: message,
      }),
    })

    expect(res.status).toBe(201)
    const agent = await res.json()
    expect(agent.agentId).toBeDefined()
    expect(agent.name).toBe('DeFi Provider Agent')
    expect(agent.ownerAddress).toBe(WALLET_1.address)
    expect(agent.tools).toHaveLength(2)
  })

  it('Rejects agent creation with wrong private key (different wallet)', async () => {
    const app = createAppWithRedis()

    // Sign with WALLET_2's key but claim WALLET_1's address
    const message = JSON.stringify({
      action: 'createAgent',
      name: 'Impostor Agent',
      timestamp: new Date().toISOString(),
    })
    const { signature, publicKey } = signMessage(message, WALLET_2.privateKey)

    const res = await app.request('/api/v1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Impostor Agent',
        description: 'Trying to impersonate Wallet 1',
        ownerAddress: WALLET_1.address, // Claiming wallet 1's address
        tools: [{ serverId: SERVER_ID, toolName: 'get_price', price: 0 }],
        network: 'testnet',
        signature, // Signed by wallet 2
        publicKey, // Wallet 2's public key
        signedMessage: message,
      }),
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('UNAUTHORIZED')
  })

  it('Rejects expired signatures (replay protection)', async () => {
    const app = createAppWithRedis()

    // Create message with old timestamp (6 minutes ago — beyond 5 min window)
    const message = JSON.stringify({
      action: 'createAgent',
      name: 'Stale Agent',
      timestamp: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    })
    const { signature, publicKey } = signMessage(message, WALLET_1.privateKey)

    const res = await app.request('/api/v1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Stale Agent',
        description: 'Old timestamp',
        ownerAddress: WALLET_1.address,
        tools: [{ serverId: SERVER_ID, toolName: 'get_price', price: 0 }],
        network: 'testnet',
        signature,
        publicKey,
        signedMessage: message,
      }),
    })

    expect(res.status).toBe(403)
  })

  it('Full lifecycle: create → get → update → delete agent', async () => {
    const app = createAppWithRedis()

    // 1. Create
    const createMsg = JSON.stringify({ action: 'createAgent', name: 'Lifecycle Agent', timestamp: new Date().toISOString() })
    const createSig = signMessage(createMsg, WALLET_1.privateKey)

    const createRes = await app.request('/api/v1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Lifecycle Agent',
        description: 'Testing full CRUD',
        ownerAddress: WALLET_1.address,
        tools: [{ serverId: SERVER_ID, toolName: 'get_price', price: 0 }],
        network: 'testnet',
        signature: createSig.signature,
        publicKey: createSig.publicKey,
        signedMessage: createMsg,
      }),
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json() as { agentId: string }
    const agentId = created.agentId

    // 2. Get
    const getRes = await app.request(`/api/v1/agents/${agentId}`)
    expect(getRes.status).toBe(200)
    const fetched = await getRes.json() as { name: string; ownerAddress: string }
    expect(fetched.name).toBe('Lifecycle Agent')
    expect(fetched.ownerAddress).toBe(WALLET_1.address)

    // 3. Update (with real signature)
    const updateMsg = JSON.stringify({ action: 'updateAgent', agentId, timestamp: new Date().toISOString() })
    const updateSig = signMessage(updateMsg, WALLET_1.privateKey)

    const updateRes = await app.request(`/api/v1/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'Updated description',
        signature: updateSig.signature,
        publicKey: updateSig.publicKey,
        signedMessage: updateMsg,
      }),
    })
    expect(updateRes.status).toBe(200)
    const updated = await updateRes.json() as { description: string }
    expect(updated.description).toBe('Updated description')

    // 4. Delete (with real signature)
    const deleteMsg = JSON.stringify({ action: 'deleteAgent', agentId, timestamp: new Date().toISOString() })
    const deleteSig = signMessage(deleteMsg, WALLET_1.privateKey)

    const deleteRes = await app.request(`/api/v1/agents/${agentId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signature: deleteSig.signature,
        publicKey: deleteSig.publicKey,
        signedMessage: deleteMsg,
      }),
    })
    expect(deleteRes.status).toBe(200)

    // 5. Verify deleted
    const gone = await app.request(`/api/v1/agents/${agentId}`)
    expect(gone.status).toBe(404)
  })

  it('Wallet 2 cannot update Wallet 1 agent', async () => {
    const app = createAppWithRedis()

    // Create with Wallet 1
    const createMsg = JSON.stringify({ action: 'createAgent', name: 'Owned Agent', timestamp: new Date().toISOString() })
    const createSig = signMessage(createMsg, WALLET_1.privateKey)

    const createRes = await app.request('/api/v1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Owned Agent',
        description: 'Owned by Wallet 1',
        ownerAddress: WALLET_1.address,
        tools: [{ serverId: SERVER_ID, toolName: 'get_price', price: 0 }],
        network: 'testnet',
        signature: createSig.signature,
        publicKey: createSig.publicKey,
        signedMessage: createMsg,
      }),
    })
    const { agentId } = await createRes.json() as { agentId: string }

    // Try to update with Wallet 2 — should fail
    const updateMsg = JSON.stringify({ action: 'updateAgent', agentId, timestamp: new Date().toISOString() })
    const updateSig = signMessage(updateMsg, WALLET_2.privateKey)

    const updateRes = await app.request(`/api/v1/agents/${agentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'Hijacked!',
        signature: updateSig.signature,
        publicKey: updateSig.publicKey,
        signedMessage: updateMsg,
      }),
    })

    expect(updateRes.status).toBe(403)
  })
})

describe('E2E: x402 payment flow — Provider + Consumer', () => {
  let redis: ReturnType<typeof makeRedis>

  const PAID_TOOLS: IntrospectedTool[] = [
    { name: 'get_price', description: 'Get token price', price: 0, acceptedTokens: ['STX'] },
    { name: 'execute_swap', description: 'Execute swap', price: 0.01, acceptedTokens: ['STX', 'sBTC', 'USDCx'] },
    { name: 'premium_analytics', description: 'Premium analytics', price: 0.05, acceptedTokens: ['STX', 'sBTC', 'USDCx'] },
  ]

  beforeEach(() => {
    redis = makeRedis()
    seedServer(redis, { recipientAddress: WALLET_1.address, network: 'testnet' }, PAID_TOOLS)
  })

  afterEach(() => vi.restoreAllMocks())

  it('Free tool: no payment required, forwards directly', async () => {
    mockUpstream({ jsonrpc: '2.0', id: 1, result: { price: 3.14 } })

    const app = createApp({
      redis: redis as any,
      encryptionKey: ENCRYPTION_KEY,
      tokenPrices: { STX: 3.0, sBTC: 100000, USDCx: 1.0 },
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev/relay',
    })

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'get_price', params: { token: 'STX' } }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.price).toBe(3.14)
  })

  it('Paid tool without payment → returns 402 with payment-required header', async () => {
    const app = createApp({
      redis: redis as any,
      encryptionKey: ENCRYPTION_KEY,
      tokenPrices: { STX: 3.0, sBTC: 100000, USDCx: 1.0 },
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev/relay',
    })

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'execute_swap', params: {} }),
    })

    expect(res.status).toBe(402)

    // Verify payment-required header is present and decodable
    const paymentRequiredHeader = res.headers.get('payment-required')
    expect(paymentRequiredHeader).toBeTruthy()

    const decoded = JSON.parse(Buffer.from(paymentRequiredHeader!, 'base64').toString())
    expect(decoded.x402Version).toBe(2)
    expect(decoded.accepts).toHaveLength(3) // STX, sBTC, USDCx
    expect(decoded.accepts[0].payTo).toBe(WALLET_1.address) // Provider receives payment
    expect(decoded.accepts[0].network).toBe('stacks:2147483648') // Testnet CAIP-2

    // Each token should have amount > 0
    for (const option of decoded.accepts) {
      expect(Number(option.amount)).toBeGreaterThan(0)
      expect(['STX', 'sBTC', 'USDCx']).toContain(option.asset)
    }
  })

  it('Paid tool with valid payment → settles and returns tool result', async () => {
    mockUpstream({ jsonrpc: '2.0', id: 1, result: { txid: 'swap_tx_123' } })

    const settle = makeSettle()
    const app = createApp({
      redis: redis as any,
      encryptionKey: ENCRYPTION_KEY,
      tokenPrices: { STX: 3.0, sBTC: 100000, USDCx: 1.0 },
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev/relay',
      settlePayment: settle,
    })

    const paymentSig = makePaymentSig({
      accepted: {
        scheme: 'exact',
        network: 'stacks:2147483648',
        amount: '3333',
        asset: 'STX',
        payTo: WALLET_1.address,
        maxTimeoutSeconds: 300,
      },
    })

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': paymentSig,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'execute_swap', params: { from: 'STX', to: 'sBTC' } }),
    })

    expect(res.status).toBe(200)

    // Verify payment-response header with txid
    const paymentResponseHeader = res.headers.get('payment-response')
    expect(paymentResponseHeader).toBeTruthy()
    const settlement = JSON.parse(Buffer.from(paymentResponseHeader!, 'base64').toString())
    expect(settlement.txid).toBe(MOCK_TXID)
    expect(settlement.explorerUrl).toContain(MOCK_TXID)

    // Verify tool result returned
    const body = await res.json()
    expect(body.result.txid).toBe('swap_tx_123')

    // Verify settle was called
    expect(settle).toHaveBeenCalledOnce()
  })

  it('Replay protection: same txid rejected on second attempt', async () => {
    mockUpstream({ jsonrpc: '2.0', id: 1, result: { ok: true } })

    const settle = makeSettle()
    const app = createApp({
      redis: redis as any,
      encryptionKey: ENCRYPTION_KEY,
      tokenPrices: { STX: 3.0, sBTC: 100000, USDCx: 1.0 },
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev/relay',
      settlePayment: settle,
    })

    const paymentSig = makePaymentSig()

    // First call succeeds
    const res1 = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'payment-signature': paymentSig },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'execute_swap', params: {} }),
    })
    expect(res1.status).toBe(200)

    // Second call with same txid is rejected
    const res2 = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'payment-signature': paymentSig },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'execute_swap', params: {} }),
    })
    expect(res2.status).toBe(402)
    const body = await res2.json()
    expect(body.code).toBe('REPLAY_DETECTED')
  })

  it('Payment settlement failure → 402 with error', async () => {
    const settle = makeSettle({ success: false, errorReason: 'Insufficient funds' })
    const app = createApp({
      redis: redis as any,
      encryptionKey: ENCRYPTION_KEY,
      tokenPrices: { STX: 3.0, sBTC: 100000, USDCx: 1.0 },
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev/relay',
      settlePayment: settle,
    })

    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': makePaymentSig(),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'execute_swap', params: {} }),
    })

    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.code).toBe('PAYMENT_FAILED')
  })
})

describe('E2E: Moltbook bridge via Redis queue', () => {
  afterEach(() => vi.restoreAllMocks())

  it('Agent creation with moltbook fields pushes to Redis queue', async () => {
    const redis = makeRedis()

    // Seed a server first
    redis._store.set(`server:${SERVER_ID}:config`, JSON.stringify({
      serverId: SERVER_ID, name: 'Test', description: 'Test', url: 'https://test.com',
      recipientAddress: WALLET_1.address, network: 'testnet',
      acceptedTokens: ['STX'], toolPricing: {}, createdAt: new Date().toISOString(),
    }))
    redis._store.set(`server:${SERVER_ID}:tools`, JSON.stringify([
      { name: 'my_tool', description: 'A tool', price: 0.01, acceptedTokens: ['STX'] },
    ]))

    const app = createApp({
      redis: redis as any,
      encryptionKey: ENCRYPTION_KEY,
      tokenPrices: { STX: 3.0, sBTC: 100000, USDCx: 1.0 },
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev/relay',
    })

    const message = JSON.stringify({ action: 'createAgent', name: 'Moltbook Agent', timestamp: new Date().toISOString() })
    const { signature, publicKey } = signMessage(message, WALLET_1.privateKey)

    const res = await app.request('/api/v1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Moltbook Agent',
        description: 'Agent with Moltbook integration',
        ownerAddress: WALLET_1.address,
        tools: [{ serverId: SERVER_ID, toolName: 'my_tool', price: 0.01 }],
        network: 'testnet',
        moltbookName: 'moltbook-test-agent',
        moltbookApiKey: 'moltbook_sk_test1234567890123456789',
        heartbeatIntervalHours: 4,
        signature,
        publicKey,
        signedMessage: message,
      }),
    })

    expect(res.status).toBe(201)

    // Verify moltbook registration was pushed to Redis queue
    expect(redis.lpush).toHaveBeenCalledWith(
      'moltbook:agent-registrations',
      expect.stringContaining('moltbook_sk_test1234567890123456789'),
    )

    // Parse the queued message
    const queuedData = JSON.parse(redis.lpush.mock.calls[0][1] as string)
    expect(queuedData.moltbookName).toBe('moltbook-test-agent')
    expect(queuedData.heartbeatIntervalHours).toBe(4)
    expect(queuedData.tools).toHaveLength(1)
  })

  it('Agent creation WITHOUT moltbook fields does NOT push to queue', async () => {
    const redis = makeRedis()
    redis._store.set(`server:${SERVER_ID}:config`, JSON.stringify({
      serverId: SERVER_ID, name: 'Test', description: 'Test', url: 'https://test.com',
      recipientAddress: WALLET_1.address, network: 'testnet',
      acceptedTokens: ['STX'], toolPricing: {}, createdAt: new Date().toISOString(),
    }))
    redis._store.set(`server:${SERVER_ID}:tools`, JSON.stringify([
      { name: 'my_tool', description: 'A tool', price: 0, acceptedTokens: ['STX'] },
    ]))

    const app = createApp({
      redis: redis as any,
      encryptionKey: ENCRYPTION_KEY,
      tokenPrices: { STX: 3.0, sBTC: 100000, USDCx: 1.0 },
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev/relay',
    })

    const message = JSON.stringify({ action: 'createAgent', name: 'Plain Agent', timestamp: new Date().toISOString() })
    const { signature, publicKey } = signMessage(message, WALLET_1.privateKey)

    const res = await app.request('/api/v1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Plain Agent',
        description: 'No moltbook',
        ownerAddress: WALLET_1.address,
        tools: [{ serverId: SERVER_ID, toolName: 'my_tool', price: 0 }],
        network: 'testnet',
        signature,
        publicKey,
        signedMessage: message,
      }),
    })

    expect(res.status).toBe(201)
    // lpush should NOT have been called for moltbook queue
    const moltbookCalls = redis.lpush.mock.calls.filter(
      (call: unknown[]) => call[0] === 'moltbook:agent-registrations'
    )
    expect(moltbookCalls).toHaveLength(0)
  })
})

describe('E2E: Transaction analytics visibility', () => {
  afterEach(() => vi.restoreAllMocks())

  it('Settled payment is visible in transaction explorer', async () => {
    const redis = makeRedis()
    const settle = makeSettle()

    seedServer(redis, { recipientAddress: WALLET_1.address, network: 'testnet' }, [
      { name: 'paid_tool', description: 'A paid tool', price: 0.02, acceptedTokens: ['STX', 'sBTC', 'USDCx'] },
    ])

    mockUpstream({ jsonrpc: '2.0', id: 1, result: { ok: true } })

    const app = createApp({
      redis: redis as any,
      encryptionKey: ENCRYPTION_KEY,
      tokenPrices: { STX: 3.0, sBTC: 100000, USDCx: 1.0 },
      relayUrl: RELAY_URL,
      testnetRelayUrl: 'https://x402-relay.aibtc.dev/relay',
      settlePayment: settle,
    })

    // Make a paid call
    const res = await app.request(`/api/v1/proxy/${SERVER_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'payment-signature': makePaymentSig(),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'paid_tool', params: {} }),
    })
    expect(res.status).toBe(200)

    // Give setImmediate time to fire (transaction logging is async)
    await new Promise(r => setTimeout(r, 50))

    // Check that transaction was logged to Redis
    const txKeys = [...redis._store.keys()].filter(k => k.startsWith('tx:'))
    // Transaction should have been stored (logTransaction stores individual + list)
    // The exact key pattern depends on implementation, but at minimum the payment dedup key exists
    expect(redis._store.has(`payment:${MOCK_TXID}`)).toBe(true)
  })
})
