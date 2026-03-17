import { createHash } from 'node:crypto'
import {
  verifySignature,
  publicKeyToAddress,
  AddressVersion,
} from '@stacks/transactions'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SignedMessage {
  message: string
  signature: string
  publicKey: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum age of a signed message before it's considered expired (5 minutes). */
const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000

/** Prefix used by Stacks wallets (Leather/Xverse) for stx_signMessage. */
const STACKS_MESSAGE_PREFIX = 'Stacks Signed Message:\n'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Encode an integer as a Bitcoin-style variable-length integer. */
function varintBytes(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n])
  if (n <= 0xffff) {
    const buf = Buffer.alloc(3)
    buf[0] = 0xfd
    buf.writeUInt16LE(n, 1)
    return buf
  }
  const buf = Buffer.alloc(5)
  buf[0] = 0xfe
  buf.writeUInt32LE(n, 1)
  return buf
}

/**
 * Hash a message the same way Stacks wallets do for `stx_signMessage`:
 * SHA-256( varint(prefix.length) + prefix + varint(message.length) + message )
 *
 * This is the Bitcoin-style message hashing with "Stacks Signed Message:\n" prefix.
 */
function walletMessageHash(message: string): string {
  const prefixBuf = Buffer.from(STACKS_MESSAGE_PREFIX, 'utf8')
  const msgBuf = Buffer.from(message, 'utf8')
  const full = Buffer.concat([
    varintBytes(prefixBuf.length),
    prefixBuf,
    varintBytes(msgBuf.length),
    msgBuf,
  ])
  return createHash('sha256').update(full).digest('hex')
}

/**
 * Hash a message the way the SDK does for `signMessageHashRsv`:
 * plain SHA-256 of the raw message string.
 */
function sdkMessageHash(message: string): string {
  return createHash('sha256').update(message).digest('hex')
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Verifies that:
 * 1. The signature is valid for the given message and public key.
 * 2. The public key derives to the expected Stacks address.
 * 3. The message timestamp is within the allowed window (replay protection).
 *
 * Supports two signing schemes:
 * - **Wallet signing** (`stx_signMessage`): uses Bitcoin-style prefix hashing
 *   SHA-256( varint(prefixLen) + "Stacks Signed Message:\n" + varint(msgLen) + msg )
 * - **SDK signing** (`signMessageHashRsv`): plain SHA-256(message)
 *
 * We try the wallet format first, then fall back to SDK format.
 */
export function verifyMessageSignature(
  signed: SignedMessage,
  expectedAddress: string,
): boolean {
  const { message, signature, publicKey } = signed

  // ── Timestamp replay protection ──────────────────────────────────────
  try {
    const parsed = JSON.parse(message)
    if (parsed.timestamp) {
      const msgTime = new Date(parsed.timestamp).getTime()
      if (Number.isNaN(msgTime)) return false
      if (Math.abs(Date.now() - msgTime) > MAX_MESSAGE_AGE_MS) return false
    }
  } catch {
    // Non-JSON messages are allowed but must still pass signature check
  }

  // ── Derive address from public key ───────────────────────────────────
  const isMainnet = expectedAddress.startsWith('SP')
  const version = isMainnet
    ? AddressVersion.MainnetSingleSig
    : AddressVersion.TestnetSingleSig

  const derivedAddress = publicKeyToAddress(version, publicKey)
  if (derivedAddress !== expectedAddress) return false

  // ── Verify signature ─────────────────────────────────────────────────
  // RSV format: r (64 hex) + s (64 hex) + v (2 hex) = 130 chars
  // verifySignature expects just r + s (first 128 hex chars)
  const rs = signature.length === 130 ? signature.slice(0, 128) : signature

  // Try wallet-style hash first (browser wallets), then SDK-style (programmatic)
  try {
    if (verifySignature(rs, walletMessageHash(message), publicKey)) return true
  } catch { /* fall through */ }

  try {
    if (verifySignature(rs, sdkMessageHash(message), publicKey)) return true
  } catch { /* fall through */ }

  return false
}
