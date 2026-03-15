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

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Verifies that:
 * 1. The signature is valid for the given message and public key.
 * 2. The public key derives to the expected Stacks address.
 * 3. The message timestamp is within the allowed window (replay protection).
 *
 * The SDK signs messages by SHA-256 hashing the raw string and calling
 * `signMessageHashRsv({ messageHash, privateKey })`. We verify the same way:
 * hash the message with SHA-256 and pass the hash to `verifyMessageSignatureRsv`.
 *
 * For browser wallet signing (`stx_signMessage`), the wallet also SHA-256 hashes
 * the message string internally, so both paths produce compatible signatures.
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
  // Stacks addresses: SP = mainnet (AddressVersion 22), ST = testnet (AddressVersion 26)
  const isMainnet = expectedAddress.startsWith('SP')
  const version = isMainnet
    ? AddressVersion.MainnetSingleSig
    : AddressVersion.TestnetSingleSig

  const derivedAddress = publicKeyToAddress(version, publicKey)
  if (derivedAddress !== expectedAddress) return false

  // ── Verify signature ─────────────────────────────────────────────────
  // SDK signs with: signMessageHashRsv({ messageHash: sha256(message), privateKey })
  // So we must verify against the same SHA-256 hash of the raw message string.
  const messageHash = createHash('sha256').update(message).digest('hex')

  try {
    // signMessageHashRsv returns RSV format: r (64 hex) + s (64 hex) + v (2 hex)
    // verifySignature expects just r + s (first 128 hex chars)
    const rs = signature.length === 130 ? signature.slice(0, 128) : signature
    return verifySignature(rs, messageHash, publicKey)
  } catch {
    return false
  }
}
