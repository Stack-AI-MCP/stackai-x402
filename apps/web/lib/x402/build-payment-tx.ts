import {
  makeUnsignedSTXTokenTransfer,
  makeUnsignedContractCall,
  serializeTransaction,
  uintCV,
  standardPrincipalCV,
  noneCV,
  Pc,
  PostConditionMode,
} from '@stacks/transactions'
import { STACKS_MAINNET, STACKS_TESTNET } from '@stacks/network'

const TOKEN_CONTRACTS: Record<
  string,
  { address: string; name: string; functionName: string; assetName: string }
> = {
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
}

/**
 * Builds an unsigned sponsored Stacks transaction for x402 payment.
 *
 * fee=0 and sponsored=true — the x402 relay pays gas.
 * The returned hex string is passed to wallet signing via
 * `request('stx_signTransaction', { transaction: hex, broadcast: false })`.
 */
export async function buildUnsignedPaymentTx(params: {
  publicKey: string
  senderAddress: string
  recipient: string
  amount: string
  tokenType: string
  network: string
}): Promise<string> {
  const { publicKey, senderAddress, recipient, amount, tokenType, network } = params
  // network may be a CAIP-2 ID ("stacks:1" / "stacks:2147483648") or a plain string
  // "stacks:1" = mainnet, "stacks:2147483648" = testnet
  const isMainnet = network === 'stacks:1' || network === 'mainnet'
  const stacksNetwork = isMainnet ? STACKS_MAINNET : STACKS_TESTNET
  const amountBigInt = BigInt(amount)

  if (tokenType === 'STX') {
    // STX transfer amount is intrinsic to the transaction — no post-conditions needed
    // (makeUnsignedSTXTokenTransfer doesn't accept postConditionMode)
    const tx = await makeUnsignedSTXTokenTransfer({
      publicKey,
      recipient,
      amount: amountBigInt,
      fee: 0n,
      sponsored: true,
      network: stacksNetwork,
    })
    return serializeTransaction(tx)
  }

  // SIP-010 fungible token (sBTC, USDCx)
  const contract = TOKEN_CONTRACTS[tokenType]
  if (!contract) throw new Error(`Unsupported token: ${tokenType}`)

  const tx = await makeUnsignedContractCall({
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
    fee: 0n,
    sponsored: true,
    network: stacksNetwork,
    postConditionMode: PostConditionMode.Deny,
    postConditions: [
      Pc.principal(senderAddress)
        .willSendEq(amountBigInt)
        .ft(`${contract.address}.${contract.name}`, contract.assetName),
    ],
  })
  return serializeTransaction(tx)
}
