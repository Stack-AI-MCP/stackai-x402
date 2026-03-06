import {
  makeSTXTokenTransfer,
  makeContractCall,
  serializeTransaction,
  getAddressFromPrivateKey,
  standardPrincipalCV,
  uintCV,
  noneCV,
  PostConditionMode,
} from '@stacks/transactions'
import { TOKEN_REGISTRY } from './token-registry.js'
import type { TokenType } from './token-registry.js'

// Stacks private keys are 32 bytes (64 hex chars) or 33 bytes with compression flag (66 hex chars, ends in "01")
const SENDER_KEY_RE = /^[0-9a-fA-F]{64}([0-9a-fA-F]{2})?$/
const RECIPIENT_RE = /^S[TPMN]/

export interface PaymentTransactionParams {
  /** Agent's hex-encoded private key (32 bytes / 64 hex chars) — NEVER sent to the gateway */
  senderKey: string
  /** Stacks address of the payment recipient (SP/ST/SM/SN prefix) */
  recipient: string
  /** Amount in the token's smallest unit (micro-STX, sat-sBTC, micro-USDCx) — must be > 0 */
  amount: bigint
  tokenType: TokenType
  network: 'mainnet' | 'testnet'
}

function validate(params: PaymentTransactionParams): void {
  if (!SENDER_KEY_RE.test(params.senderKey)) {
    throw new Error(
      `senderKey must be 64 hex chars (uncompressed) or 66 hex chars (compressed, ends in "01"), got ${params.senderKey.length} chars`,
    )
  }
  if (!RECIPIENT_RE.test(params.recipient)) {
    throw new Error(
      `recipient must be a valid Stacks address (SP/ST/SM/SN prefix), got "${params.recipient}"`,
    )
  }
  if (params.amount <= 0n) {
    throw new Error(`amount must be > 0, got ${params.amount}`)
  }
}

/**
 * Builds a signed sponsored Stacks transaction for the given token payment.
 *
 * CRITICAL: All transactions have fee=0n and sponsored=true. The x402-relay
 * pays the gas fee. Any non-sponsored transaction is rejected by the relay.
 *
 * @returns Lowercase hex-encoded serialized transaction (no 0x prefix), ready
 *          to be base64-encoded as the `payment-signature` header.
 */
export async function buildPaymentTransaction(
  params: PaymentTransactionParams,
): Promise<string> {
  validate(params)

  const { senderKey, recipient, amount, tokenType, network } = params

  if (tokenType === 'STX') {
    const tx = await makeSTXTokenTransfer({
      recipient,
      amount,
      fee: 0n,
      sponsored: true,
      senderKey,
      network,
    })
    return serializeTransaction(tx).toLowerCase()
  }

  // SIP-010 fungible token path (sBTC, USDCx)
  const config = TOKEN_REGISTRY[tokenType]
  const networkConfig = config[network]

  if (!networkConfig.contractAddress || !networkConfig.functionName) {
    throw new Error(
      `Token ${tokenType} has no contract address configured for network ${network}`,
    )
  }

  // Token registry stores addresses as "contractPrincipal.contractName"
  const lastDot = networkConfig.contractAddress.lastIndexOf('.')
  if (lastDot === -1) {
    throw new Error(
      `Malformed contract address for ${tokenType}: "${networkConfig.contractAddress}" (expected "address.contractName")`,
    )
  }
  const contractAddress = networkConfig.contractAddress.slice(0, lastDot)
  const contractName = networkConfig.contractAddress.slice(lastDot + 1)

  // SIP-010 transfer: (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34)))
  const sender = getAddressFromPrivateKey(senderKey, network)

  const tx = await makeContractCall({
    contractAddress,
    contractName,
    functionName: networkConfig.functionName,
    functionArgs: [
      uintCV(amount),
      standardPrincipalCV(sender),
      standardPrincipalCV(recipient),
      noneCV(),
    ],
    fee: 0n,
    sponsored: true,
    senderKey,
    network,
    postConditionMode: PostConditionMode.Allow,
  })

  return serializeTransaction(tx).toLowerCase()
}
