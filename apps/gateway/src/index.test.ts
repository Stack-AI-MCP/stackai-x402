import { describe, it, expect } from 'vitest'
import { createApp } from './app.js'

// Minimal deps for the health endpoint — no Redis or encryption needed
const app = createApp({
  redis: { set: async () => 'OK', get: async () => null, del: async () => 1 },
  encryptionKey: 'a'.repeat(64),
  network: 'mainnet',
  tokenPrices: { STX: 3.0, sBTC: 100_000.0, USDCx: 1.0 },
})

describe('gateway health route', () => {
  it('returns { status: ok }', async () => {
    const res = await app.request('/health')
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ status: 'ok' })
  })
})
