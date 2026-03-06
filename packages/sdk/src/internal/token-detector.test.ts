import { describe, it, expect, beforeAll } from 'vitest'
import {
  randomPrivateKey,
  getAddressFromPrivateKey,
  makeContractCall,
  serializeTransaction,
  uintCV,
  standardPrincipalCV,
  noneCV,
  PostConditionMode,
} from '@stacks/transactions'
import { buildPaymentTransaction } from './payment-builder.js'
import { detectPaymentToken } from './token-detector.js'

// ─── Test fixtures ────────────────────────────────────────────────────────────

const SENDER_KEY = randomPrivateKey()
const MAINNET_RECIPIENT = 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159'
const TESTNET_RECIPIENT = getAddressFromPrivateKey(SENDER_KEY, 'testnet')
const AMOUNT = 1_000_000n

let stxMainnetHex: string
let stxTestnetHex: string
let sbtcMainnetHex: string
let sbtcTestnetHex: string
let usdcxMainnetHex: string
/** ContractCall to a contract address that is NOT in TOKEN_REGISTRY */
let unknownContractHex: string

beforeAll(async () => {
  ;[stxMainnetHex, stxTestnetHex, sbtcMainnetHex, sbtcTestnetHex, usdcxMainnetHex, unknownContractHex] =
    await Promise.all([
      buildPaymentTransaction({
        senderKey: SENDER_KEY,
        recipient: MAINNET_RECIPIENT,
        amount: AMOUNT,
        tokenType: 'STX',
        network: 'mainnet',
      }),
      buildPaymentTransaction({
        senderKey: SENDER_KEY,
        recipient: TESTNET_RECIPIENT,
        amount: AMOUNT,
        tokenType: 'STX',
        network: 'testnet',
      }),
      buildPaymentTransaction({
        senderKey: SENDER_KEY,
        recipient: MAINNET_RECIPIENT,
        amount: 1_000n,
        tokenType: 'sBTC',
        network: 'mainnet',
      }),
      buildPaymentTransaction({
        senderKey: SENDER_KEY,
        recipient: TESTNET_RECIPIENT,
        amount: 1_000n,
        tokenType: 'sBTC',
        network: 'testnet',
      }),
      buildPaymentTransaction({
        senderKey: SENDER_KEY,
        recipient: MAINNET_RECIPIENT,
        amount: AMOUNT,
        tokenType: 'USDCx',
        network: 'mainnet',
      }),
      // Build a ContractCall to a contract that is NOT in TOKEN_REGISTRY.
      // Uses MAINNET_RECIPIENT as the contractAddress principal (valid c32 format)
      // and an arbitrary contract name that will never match any registered token.
      makeContractCall({
        contractAddress: MAINNET_RECIPIENT,
        contractName: 'not-in-registry',
        functionName: 'transfer',
        functionArgs: [
          uintCV(AMOUNT),
          standardPrincipalCV(MAINNET_RECIPIENT),
          standardPrincipalCV(MAINNET_RECIPIENT),
          noneCV(),
        ],
        fee: 0n,
        sponsored: true,
        senderKey: SENDER_KEY,
        network: 'mainnet',
        postConditionMode: PostConditionMode.Allow,
      }).then((tx) => serializeTransaction(tx).toLowerCase()),
    ])
})

// ─── STX (TokenTransfer payload) ──────────────────────────────────────────────

describe('detectPaymentToken — STX', () => {
  it('detects STX from a mainnet TokenTransfer transaction', () => {
    expect(detectPaymentToken(stxMainnetHex, 'mainnet')).toBe('STX')
  })

  it('detects STX from a testnet TokenTransfer transaction', () => {
    expect(detectPaymentToken(stxTestnetHex, 'testnet')).toBe('STX')
  })
})

// ─── sBTC (ContractCall payload) ──────────────────────────────────────────────

describe('detectPaymentToken — sBTC', () => {
  it('detects sBTC from a mainnet ContractCall transaction', () => {
    expect(detectPaymentToken(sbtcMainnetHex, 'mainnet')).toBe('sBTC')
  })

  it('detects sBTC from a testnet ContractCall transaction', () => {
    expect(detectPaymentToken(sbtcTestnetHex, 'testnet')).toBe('sBTC')
  })
})

// ─── USDCx (ContractCall payload) ────────────────────────────────────────────

describe('detectPaymentToken — USDCx', () => {
  it('detects USDCx from a mainnet ContractCall transaction', () => {
    expect(detectPaymentToken(usdcxMainnetHex, 'mainnet')).toBe('USDCx')
  })
})

// ─── Error cases ──────────────────────────────────────────────────────────────

describe('detectPaymentToken — error cases', () => {
  it('throws on unrecognized contract address (contract not in TOKEN_REGISTRY)', () => {
    expect(() => detectPaymentToken(unknownContractHex, 'mainnet')).toThrow(
      'Unrecognized contract address in payment transaction',
    )
  })

  it('throws on invalid hex input (deserialization fails)', () => {
    expect(() => detectPaymentToken('notvalidhex!!!', 'mainnet')).toThrow()
  })
})
