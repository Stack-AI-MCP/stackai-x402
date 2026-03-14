import { describe, it, expect, vi } from 'vitest'
import { wrapAxios, wrapAxiosWithPayment, decodePaymentRequired, decodePaymentResponse } from './wrap-fetch.js'

// Mock x402-stacks
vi.mock('x402-stacks', () => ({
  wrapAxiosWithPayment: vi.fn((instance: unknown) => instance),
  decodePaymentRequired: vi.fn((header: string | null) => {
    if (!header) return null
    try {
      return JSON.parse(Buffer.from(header, 'base64').toString('utf-8'))
    } catch {
      return null
    }
  }),
  decodePaymentResponse: vi.fn((header: string | null) => {
    if (!header) return null
    try {
      return JSON.parse(Buffer.from(header, 'base64').toString('utf-8'))
    } catch {
      return null
    }
  }),
}))

describe('wrap-fetch re-exports', () => {
  it('exports wrapAxios (alias for wrapAxiosWithPayment)', () => {
    expect(typeof wrapAxios).toBe('function')
    expect(wrapAxios).toBe(wrapAxiosWithPayment)
  })

  it('decodePaymentRequired returns parsed object from base64 JSON header', () => {
    const payload = { x402Version: 2, accepts: [] }
    const header = Buffer.from(JSON.stringify(payload)).toString('base64')
    const result = decodePaymentRequired(header)
    expect(result).toEqual(payload)
  })

  it('decodePaymentRequired returns null for null input', () => {
    expect(decodePaymentRequired(null)).toBeNull()
  })

  it('decodePaymentResponse returns parsed object from base64 JSON header', () => {
    const payload = { success: true, transaction: 'abc123', network: 'stacks:1' }
    const header = Buffer.from(JSON.stringify(payload)).toString('base64')
    const result = decodePaymentResponse(header)
    expect(result).toEqual(payload)
  })
})
