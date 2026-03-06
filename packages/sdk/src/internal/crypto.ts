import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
// 12 bytes is the NIST SP 800-38D recommended IV size for AES-GCM.
// Using any other size forces OpenSSL to run GHASH(IV) internally,
// adding computation and reducing collision-resistance guarantees.
const IV_BYTES = 12
const KEY_BYTES = 32
const HEX_RE = /^[0-9a-fA-F]+$/

function parseKey(keyHex: string): Buffer {
  if (keyHex.length !== KEY_BYTES * 2) {
    throw new Error(
      `keyHex must be ${KEY_BYTES * 2} hex chars (32 bytes), got ${keyHex.length}`,
    )
  }
  if (!HEX_RE.test(keyHex)) {
    throw new Error('keyHex contains non-hexadecimal characters')
  }
  return Buffer.from(keyHex, 'hex')
}

/**
 * Encrypts plaintext with AES-256-GCM.
 * Output format: `${iv_hex}:${authTag_hex}:${ciphertext_hex}`
 */
export function encrypt(plaintext: string, keyHex: string): string {
  const key = parseKey(keyHex)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

/**
 * Decrypts a ciphertext produced by `encrypt`.
 * Input format: `${iv_hex}:${authTag_hex}:${ciphertext_hex}`
 */
export function decrypt(ciphertext: string, keyHex: string): string {
  const key = parseKey(keyHex)
  const parts = ciphertext.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format — expected iv:authTag:data')
  }
  const [ivHex, authTagHex, dataHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const data = Buffer.from(dataHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  return decrypted.toString('utf8')
}
