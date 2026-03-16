import {
  makeUnsignedSTXTokenTransfer,
  makeUnsignedContractCall,
  serializeTransaction,
  uintCV,
  standardPrincipalCV,
  noneCV,
  Pc,
  PostConditionMode,
  type StacksTransactionWire,
} from '@stacks/transactions'
import { c32addressDecode } from 'c32check'
import { STACKS_MAINNET, STACKS_TESTNET } from '@stacks/network'

// Token contracts per network
const TOKEN_CONTRACTS: Record<
  string,
  Record<string, { address: string; name: string; functionName: string; assetName: string }>
> = {
  mainnet: {
    sBTC: {
      address: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
      name: 'sbtc-token',
      functionName: 'transfer',
      assetName: 'sbtc-token',
    },
    USDCx: {
      address: 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE',
      name: 'usdcx',
      functionName: 'transfer',
      assetName: 'usdcx',
    },
  },
  testnet: {
    sBTC: {
      address: 'ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT',
      name: 'sbtc-token',
      functionName: 'transfer',
      assetName: 'sbtc-token',
    },
    USDCx: {
      address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
      name: 'usdcx-v1',
      functionName: 'transfer',
      assetName: 'usdcx-v1',
    },
  },
}

// ── Fee estimation ─────────────────────────────────────────────────────────────

async function estimateFee(txHex: string, hinapiBase: string): Promise<bigint> {
  try {
    const res = await fetch(`${hinapiBase}/v2/fees/transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: txHex, cost_scalar_change_by_byte: 0 }),
      signal: AbortSignal.timeout(5_000),
    })
    if (res.ok) {
      const data = await res.json() as { estimations?: { fee: number }[] }
      // Use median (index 1) estimate; fall back to low (index 0)
      const fee = data.estimations?.[1]?.fee ?? data.estimations?.[0]?.fee ?? 0
      if (fee > 0) return BigInt(fee)
    }
  } catch {
    // fall through to default
  }
  return 200_000n // 0.2 STX safe default if estimation fails
}

// ── Tx builder with auto fee estimation ──────────────────────────────────────

async function buildWithFee(
  signerHash: string,
  hinapiBase: string,
  buildFn: (fee: bigint) => Promise<StacksTransactionWire>,
): Promise<string> {
  // Build once with fee=0 to get the serialized size for accurate estimation
  const txForEstimate = await buildFn(0n)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(txForEstimate.auth as any).spendingCondition.signer = signerHash
  const estimateHex = serializeTransaction(txForEstimate)

  const fee = await estimateFee(estimateHex, hinapiBase)

  // Rebuild with the estimated fee
  const tx = await buildFn(fee)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(tx.auth as any).spendingCondition.signer = signerHash
  return serializeTransaction(tx)
}

// ── Broadcast helper ──────────────────────────────────────────────────────────

/**
 * Broadcast a signed Stacks transaction to the network via Hiro API.
 * Returns the txid on success, throws on failure.
 */
export async function broadcastSignedTx(signedHex: string, network: string): Promise<string> {
  const isMainnet = network === 'stacks:1' || network === 'mainnet'
  const hinapiBase = isMainnet ? 'https://api.hiro.so' : 'https://api.testnet.hiro.so'

  const txBytes = Buffer.from(signedHex, 'hex')
  const res = await fetch(`${hinapiBase}/v2/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: txBytes,
    signal: AbortSignal.timeout(15_000),
  })

  // Hiro returns the txid as a plain JSON string on success,
  // or { error, reason } on failure.
  const body = await res.json() as string | { error: string; reason?: string; reason_data?: unknown }
  if (typeof body === 'string') return body.replace(/"/g, '') // strip surrounding quotes if any
  throw new Error((body as { reason?: string; error?: string }).reason ?? (body as { error: string }).error ?? 'Broadcast failed')
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Builds an unsigned Stacks transaction for x402 payment with auto fee estimation.
 *
 * The fee is estimated from the Hiro API using the actual serialized tx size.
 * The wallet signs this tx (broadcast: false), then the caller broadcasts via
 * broadcastSignedTx() to get a real txid that the gateway verifies on-chain.
 */
export async function buildUnsignedPaymentTx(params: {
  publicKey: string
  senderAddress: string
  recipient: string
  amount: string
  tokenType: string
  network: string
}): Promise<string> {
  const { senderAddress, publicKey, recipient, amount, tokenType, network } = params
  const isMainnet = network === 'stacks:1' || network === 'mainnet'
  const stacksNetwork = isMainnet ? STACKS_MAINNET : STACKS_TESTNET
  const hinapiBase = isMainnet ? 'https://api.hiro.so' : 'https://api.testnet.hiro.so'
  const amountBigInt = BigInt(amount)

  // Decode the sender's Stacks address to get the hash160 of their STX spending key.
  // This is the correct signer field value — it matches what stx_signTransaction
  // signs with, regardless of what publicKey we obtained via other methods.
  const [, signerHash] = c32addressDecode(senderAddress)

  if (tokenType === 'STX') {
    return buildWithFee(signerHash, hinapiBase, (fee) =>
      makeUnsignedSTXTokenTransfer({
        publicKey,
        recipient,
        amount: amountBigInt,
        fee,
        network: stacksNetwork,
      }),
    )
  }

  // SIP-010 fungible token (sBTC, USDCx)
  const networkKey = isMainnet ? 'mainnet' : 'testnet'
  const contract = TOKEN_CONTRACTS[networkKey]?.[tokenType]
  if (!contract) throw new Error(`Unsupported token: ${tokenType} on ${networkKey}`)

  return buildWithFee(signerHash, hinapiBase, (fee) =>
    makeUnsignedContractCall({
      publicKey,
      contractAddress: contract.address,
      contractName: contract.name,
      functionName: contract.functionName,
      functionArgs: [
        uintCV(amountBigInt),
        standardPrincipalCV(senderAddress),
        standardPrincipalCV(recipient),
        noneCV(),
      ],
      fee,
      network: stacksNetwork,
      postConditionMode: PostConditionMode.Deny,
      postConditions: [
        Pc.principal(senderAddress)
          .willSendEq(amountBigInt)
          .ft(`${contract.address}.${contract.name}`, contract.assetName),
      ],
    }),
  )
}
