// ─── Server-side SDK helpers ────────────────────────────────────────────────
// Functions for programmatic agent management (SDK path — private key signing).

import {
  getAddressFromPrivateKey,
  signMessageHashRsv,
  privateKeyToPublic,
} from '@stacks/transactions'
import { createHash } from 'node:crypto'
import type {
  AgentConfig,
  AgentListResponse,
  CreateAgentOptions,
  TransactionListResponse,
} from '../types/index.js'

// ─── Message signing (SDK path — uses private key, no wallet popup) ─────────

/**
 * Signs a JSON message with a Stacks private key.
 * Returns the signature + derived compressed public key for gateway verification.
 */
function signMessage(message: string, privateKey: string) {
  const hash = createHash('sha256').update(message).digest()
  const signature = signMessageHashRsv({ messageHash: hash, privateKey })
  const publicKey = privateKeyToPublic(privateKey)
  return { signature: signature.data, publicKey }
}

/** Derives a Stacks address from a private key. */
function addressFromKey(privateKey: string, network: 'mainnet' | 'testnet' = 'mainnet') {
  return getAddressFromPrivateKey(privateKey, network)
}

// ─── Agent CRUD ─────────────────────────────────────────────────────────────

/**
 * Creates a new agent on the gateway.
 * The private key is used to derive the ownerAddress and sign the request.
 */
export async function createAgent(
  gatewayUrl: string,
  privateKey: string,
  options: CreateAgentOptions,
): Promise<AgentConfig> {
  const network = options.network ?? 'mainnet'
  const ownerAddress = addressFromKey(privateKey, network)

  const message = JSON.stringify({
    action: 'createAgent',
    name: options.name,
    timestamp: new Date().toISOString(),
  })
  const { signature, publicKey } = signMessage(message, privateKey)

  const res = await fetch(`${gatewayUrl}/api/v1/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...options,
      ownerAddress,
      signature,
      publicKey,
      signedMessage: message,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? `Agent creation failed (${res.status})`)
  }

  return res.json() as Promise<AgentConfig>
}

/** Lists all agents on the gateway (public, paginated). */
export async function listAgents(
  gatewayUrl: string,
  options?: { page?: number; limit?: number },
): Promise<AgentListResponse> {
  const params = new URLSearchParams()
  if (options?.page) params.set('page', String(options.page))
  if (options?.limit) params.set('limit', String(options.limit))

  const res = await fetch(`${gatewayUrl}/api/v1/agents?${params}`)
  if (!res.ok) throw new Error(`Failed to list agents (${res.status})`)
  return res.json() as Promise<AgentListResponse>
}

/** Gets a single agent by ID. */
export async function getAgent(
  gatewayUrl: string,
  agentId: string,
): Promise<AgentConfig> {
  const res = await fetch(`${gatewayUrl}/api/v1/agents/${agentId}`)
  if (!res.ok) throw new Error(`Agent not found (${res.status})`)
  return res.json() as Promise<AgentConfig>
}

/** Updates an agent (requires private key for signing). */
export async function updateAgent(
  gatewayUrl: string,
  privateKey: string,
  agentId: string,
  updates: Partial<Pick<CreateAgentOptions, 'name' | 'description' | 'tools' | 'moltbookName' | 'systemPrompt' | 'starterPrompts'>>,
): Promise<AgentConfig> {
  const message = JSON.stringify({ action: 'updateAgent', agentId, timestamp: new Date().toISOString() })
  const { signature, publicKey } = signMessage(message, privateKey)

  const res = await fetch(`${gatewayUrl}/api/v1/agents/${agentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...updates, signature, publicKey, signedMessage: message }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? `Update failed (${res.status})`)
  }

  return res.json() as Promise<AgentConfig>
}

/** Deletes an agent (requires private key for signing). */
export async function deleteAgent(
  gatewayUrl: string,
  privateKey: string,
  agentId: string,
): Promise<void> {
  const message = JSON.stringify({ action: 'deleteAgent', agentId, timestamp: new Date().toISOString() })
  const { signature, publicKey } = signMessage(message, privateKey)

  const res = await fetch(`${gatewayUrl}/api/v1/agents/${agentId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature, publicKey, signedMessage: message }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? `Delete failed (${res.status})`)
  }
}

/** Lists transaction history from the Explorer (public). */
export async function listTransactions(
  gatewayUrl: string,
  options?: { page?: number; limit?: number; serverId?: string; agentId?: string },
): Promise<TransactionListResponse> {
  const params = new URLSearchParams()
  if (options?.page) params.set('page', String(options.page))
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.serverId) params.set('serverId', options.serverId)
  if (options?.agentId) params.set('agentId', options.agentId)

  const res = await fetch(`${gatewayUrl}/api/v1/servers/transactions?${params}`)
  if (!res.ok) throw new Error(`Failed to list transactions (${res.status})`)
  return res.json() as Promise<TransactionListResponse>
}
