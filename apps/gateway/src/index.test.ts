import { describe, it, expect } from 'vitest'
import { createApp } from './app.js'

// Minimal deps for the health endpoint — no Redis or encryption needed
const app = createApp({
  redis: {
    set: async () => 'OK',
    get: async () => null,
    del: async () => 1,
    scan: async () => ['0', []] as [string, string[]],
    mget: async () => [],
    incr: async () => 1,
    incrby: async () => 1,
    pfadd: async () => 1,
    pfcount: async () => 0,
  },
  encryptionKey: 'a'.repeat(64),
  tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
  relayUrl: 'https://x402-relay.aibtc.com',
  testnetRelayUrl: 'https://x402-relay.aibtc.dev',
})

describe('gateway health route', () => {
  it('returns { status: ok }', async () => {
    const res = await app.request('/health')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ status: 'ok' })
  })
})
