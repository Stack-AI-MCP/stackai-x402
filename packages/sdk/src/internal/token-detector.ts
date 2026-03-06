import { deserializeTransaction, PayloadType, addressToString } from '@stacks/transactions'
import type { ContractCallPayload } from '@stacks/transactions'
import { TOKEN_REGISTRY } from './token-registry.js'
import type { TokenType } from './token-registry.js'

/**
 * Determines which token was used in a payment transaction by inspecting
 * the deserialized transaction payload.
 *
 * - STX native transfers → `PayloadType.TokenTransfer`
 * - SIP-010 tokens (sBTC, USDCx) → `PayloadType.ContractCall`, matched against
 *   TOKEN_REGISTRY contract addresses for the given network.
 *
 * @param txHex    Hex-encoded serialized Stacks transaction (no 0x prefix)
 * @param network  Network to use for contract address lookup
 * @throws Error if the payload type is unsupported or the contract is unrecognized
 */
export function detectPaymentToken(txHex: string, network: 'mainnet' | 'testnet'): TokenType {
  const tx = deserializeTransaction(txHex)

  if (tx.payload.payloadType === PayloadType.TokenTransfer) {
    return 'STX'
  }

  if (tx.payload.payloadType === PayloadType.ContractCall) {
    const payload = tx.payload as ContractCallPayload
    // Reconstruct the full contractId ("address.name") to match TOKEN_REGISTRY format
    const contractId = `${addressToString(payload.contractAddress)}.${payload.contractName.content}`

    for (const [token, config] of Object.entries(TOKEN_REGISTRY) as [TokenType, (typeof TOKEN_REGISTRY)[TokenType]][]) {
      if (token === 'STX') continue
      if (config[network].contractAddress === contractId) {
        return token
      }
    }

    throw new Error(`Unrecognized contract address in payment transaction: ${contractId}`)
  }

  throw new Error(`Unsupported payload type in payment transaction: ${tx.payload.payloadType}`)
}
