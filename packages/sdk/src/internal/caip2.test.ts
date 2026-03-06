import { describe, it, expect } from 'vitest'
import { networkToCAIP2 } from './caip2.js'

describe('networkToCAIP2', () => {
  it('returns stacks:1 for mainnet', () => {
    expect(networkToCAIP2('mainnet')).toBe('stacks:1')
  })

  it('returns stacks:2147483648 for testnet', () => {
    expect(networkToCAIP2('testnet')).toBe('stacks:2147483648')
  })

  it('throws a descriptive error for unknown network', () => {
    expect(() => networkToCAIP2('devnet' as never)).toThrow('Unknown network: devnet')
  })
})
