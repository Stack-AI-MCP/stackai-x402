// ─── SDK proxy helpers ──────────────────────────────────────────────────────
// Utility functions for agent developers: wallet generation, balance checks,
// and agent discovery.

import { getAddressFromPrivateKey } from '@stacks/transactions'
import { randomBytes } from 'node:crypto'
import type { AgentListResponse } from '../types/index.js'

// ─── Wallet generation ──────────────────────────────────────────────────────

export interface GeneratedWallet {
  /** Hex-encoded private key (64 chars). */
  privateKey: string
  /** Stacks address derived from the private key. */
  address: string
  /** Network the address is valid for. */
  network: 'mainnet' | 'testnet'
}

/**
 * Generates a fresh Stacks wallet for autonomous agent use.
 * Uses Node.js crypto for secure random key generation.
 *
 * The returned private key should be stored securely (env var, vault, etc.).
 */
export function generateAgentWallet(network: 'mainnet' | 'testnet' = 'mainnet'): GeneratedWallet {
  const privateKey = randomBytes(32).toString('hex')
  const address = getAddressFromPrivateKey(privateKey, network)

  return { privateKey, address, network }
}

// ─── Balance check ──────────────────────────────────────────────────────────

export interface StxBalance {
  /** Available (unlocked) STX balance in microSTX. */
  balance: string
  /** Locked (stacked) STX in microSTX. */
  locked: string
  /** Current nonce for transaction ordering. */
  nonce: number
}

/**
 * Fetches the STX balance for a Stacks address from the Hiro API.
 * Returns the spendable balance (total minus locked/stacked).
 */
export async function getBalance(
  stxAddress: string,
  network: 'mainnet' | 'testnet' = 'mainnet',
): Promise<StxBalance> {
  const baseUrl = network === 'mainnet'
    ? 'https://api.hiro.so'
    : 'https://api.testnet.hiro.so'

  const res = await fetch(`${baseUrl}/v2/accounts/${stxAddress}`, {
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    throw new Error(`Hiro API error: ${res.status}`)
  }

  const data = await res.json() as {
    balance: string
    locked: string
    nonce: number
  }

  return {
    balance: data.balance,
    locked: data.locked,
    nonce: data.nonce,
  }
}

// ─── Agent discovery ────────────────────────────────────────────────────────

/**
 * Discovers all agents registered on a gateway.
 * Useful for autonomous agents finding services to interact with.
 */
export async function discoverAgents(
  gatewayUrl: string,
): Promise<AgentListResponse> {
  const res = await fetch(`${gatewayUrl}/api/v1/agents?limit=100`, {
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    throw new Error(`Failed to discover agents (${res.status})`)
  }

  return res.json() as Promise<AgentListResponse>
}
