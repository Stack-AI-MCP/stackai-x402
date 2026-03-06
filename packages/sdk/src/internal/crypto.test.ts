import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from './crypto.js'

const TEST_KEY = 'a'.repeat(64) // 32 bytes as hex

describe('AES-256-GCM encrypt/decrypt', () => {
  it('round-trips plaintext correctly', () => {
    const plaintext = 'hello, stacks!'
    expect(decrypt(encrypt(plaintext, TEST_KEY), TEST_KEY)).toBe(plaintext)
  })

  it('round-trips empty string', () => {
    expect(decrypt(encrypt('', TEST_KEY), TEST_KEY)).toBe('')
  })

  it('round-trips unicode and special characters', () => {
    const plaintext = '{"amount":"1000","token":"sBTC","emoji":"🚀"}'
    expect(decrypt(encrypt(plaintext, TEST_KEY), TEST_KEY)).toBe(plaintext)
  })

  it('produces different IVs on each call', () => {
    const plaintext = 'same-input'
    const c1 = encrypt(plaintext, TEST_KEY)
    const c2 = encrypt(plaintext, TEST_KEY)
    const iv1 = c1.split(':')[0]
    const iv2 = c2.split(':')[0]
    expect(iv1).not.toBe(iv2)
  })

  it('output has iv:authTag:ciphertext format', () => {
    const parts = encrypt('test', TEST_KEY).split(':')
    expect(parts).toHaveLength(3)
    // IV is 12 bytes = 24 hex chars (NIST SP 800-38D recommended size for AES-GCM)
    expect(parts[0]).toHaveLength(24)
    // GCM auth tag is 16 bytes = 32 hex chars
    expect(parts[1]).toHaveLength(32)
  })

  it('throws on wrong key length', () => {
    expect(() => encrypt('test', 'tooshort')).toThrow('keyHex must be 64 hex chars')
  })

  it('throws on non-hex key characters', () => {
    expect(() => encrypt('test', 'z'.repeat(64))).toThrow('non-hexadecimal characters')
  })

  it('throws on tampered ciphertext', () => {
    const c = encrypt('secret', TEST_KEY)
    const parts = c.split(':')
    // corrupt the ciphertext portion
    parts[2] = 'deadbeef'
    expect(() => decrypt(parts.join(':'), TEST_KEY)).toThrow()
  })
})
