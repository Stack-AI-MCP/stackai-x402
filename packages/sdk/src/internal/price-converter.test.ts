import { describe, it, expect } from 'vitest'
import { usdToMicro } from './price-converter.js'

describe('usdToMicro', () => {
  it('converts USD to microSTX (6 decimals)', () => {
    // $0.50 USD at $0.50/STX = 1 STX = 1_000_000 microSTX
    expect(usdToMicro(0.5, 'STX', 0.5)).toBe(1_000_000n)
  })

  it('converts USD to satoshis for sBTC (8 decimals)', () => {
    // $100 USD at $100_000/sBTC = 0.001 sBTC = 100_000 satoshis
    expect(usdToMicro(100, 'sBTC', 100_000)).toBe(100_000n)
  })

  it('converts USD to micro-USDCx (6 decimals)', () => {
    // $1 USD at $1/USDCx = 1_000_000 micro-USDCx
    expect(usdToMicro(1, 'USDCx', 1)).toBe(1_000_000n)
  })

  it('handles fractional cents', () => {
    // $0.01 USD at $0.50/STX = 0.02 STX = 20_000 microSTX
    expect(usdToMicro(0.01, 'STX', 0.5)).toBe(20_000n)
  })

  it('returns a bigint', () => {
    expect(typeof usdToMicro(1, 'STX', 1)).toBe('bigint')
  })

  it('throws for non-positive priceUSD', () => {
    expect(() => usdToMicro(1, 'STX', 0)).toThrow('priceUSD must be a positive finite number')
    expect(() => usdToMicro(1, 'STX', -1)).toThrow('priceUSD must be a positive finite number')
  })

  it('throws for non-finite priceUSD', () => {
    expect(() => usdToMicro(1, 'STX', Infinity)).toThrow('priceUSD must be a positive finite number')
    expect(() => usdToMicro(1, 'STX', NaN)).toThrow('priceUSD must be a positive finite number')
  })

  it('throws for negative usdAmount', () => {
    expect(() => usdToMicro(-1, 'STX', 1)).toThrow('usdAmount must be a non-negative finite number')
  })

  it('throws for non-finite usdAmount', () => {
    expect(() => usdToMicro(Infinity, 'STX', 1)).toThrow('usdAmount must be a non-negative finite number')
    expect(() => usdToMicro(NaN, 'STX', 1)).toThrow('usdAmount must be a non-negative finite number')
  })
})
