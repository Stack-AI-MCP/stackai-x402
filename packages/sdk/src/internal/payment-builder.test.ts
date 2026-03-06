import { describe, it, expect, beforeAll } from 'vitest'
import {
  deserializeTransaction,
  randomPrivateKey,
  AuthType,
  PayloadType,
  addressToString,
  getAddressFromPrivateKey,
} from '@stacks/transactions'
import { TOKEN_REGISTRY } from './token-registry.js'
import { buildPaymentTransaction } from './payment-builder.js'

const SENDER_KEY = randomPrivateKey()
// Valid mainnet recipient (SP prefix = mainnet single-sig)
const MAINNET_RECIPIENT = 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159'
// Derive a valid testnet recipient from the sender key (ST prefix = testnet single-sig)
const TESTNET_RECIPIENT = getAddressFromPrivateKey(SENDER_KEY, 'testnet')

describe('buildPaymentTransaction', () => {
  describe('STX', () => {
    let stxHex: string
    let stxHexTestnet: string

    beforeAll(async () => {
      ;[stxHex, stxHexTestnet] = await Promise.all([
        buildPaymentTransaction({
          senderKey: SENDER_KEY,
          recipient: MAINNET_RECIPIENT,
          amount: 1_000_000n,
          tokenType: 'STX',
          network: 'mainnet',
        }),
        buildPaymentTransaction({
          senderKey: SENDER_KEY,
          recipient: TESTNET_RECIPIENT,
          amount: 1_000_000n,
          tokenType: 'STX',
          network: 'testnet',
        }),
      ])
    })

    it('returns a lowercase hex string', () => {
      expect(stxHex).toMatch(/^[0-9a-f]+$/)
    })

    it('produces a sponsored transaction with fee=0n (mainnet)', () => {
      const tx = deserializeTransaction(stxHex)
      expect(tx.auth.authType).toBe(AuthType.Sponsored)
      expect(tx.auth.spendingCondition.fee).toBe(0n)
    })

    it('produces a sponsored transaction with fee=0n (testnet)', () => {
      const tx = deserializeTransaction(stxHexTestnet)
      expect(tx.auth.authType).toBe(AuthType.Sponsored)
      expect(tx.auth.spendingCondition.fee).toBe(0n)
    })

    it('encodes a TokenTransfer payload', () => {
      const tx = deserializeTransaction(stxHex)
      expect(tx.payload.payloadType).toBe(PayloadType.TokenTransfer)
    })
  })

  describe('sBTC', () => {
    let sbtcMainnetHex: string
    let sbtcTestnetHex: string

    beforeAll(async () => {
      ;[sbtcMainnetHex, sbtcTestnetHex] = await Promise.all([
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
      ])
    })

    it('produces sponsored ContractCall with fee=0n (mainnet)', () => {
      const tx = deserializeTransaction(sbtcMainnetHex)
      expect(tx.auth.authType).toBe(AuthType.Sponsored)
      expect(tx.auth.spendingCondition.fee).toBe(0n)
      expect(tx.payload.payloadType).toBe(PayloadType.ContractCall)
    })

    it('produces sponsored ContractCall with fee=0n (testnet)', () => {
      const tx = deserializeTransaction(sbtcTestnetHex)
      expect(tx.auth.authType).toBe(AuthType.Sponsored)
      expect(tx.auth.spendingCondition.fee).toBe(0n)
      expect(tx.payload.payloadType).toBe(PayloadType.ContractCall)
    })

    it('targets the correct sBTC contract address and function (mainnet)', () => {
      const tx = deserializeTransaction(sbtcMainnetHex)
      if (tx.payload.payloadType !== PayloadType.ContractCall) throw new Error('not a contract call')
      const [expectedAddress, expectedName] =
        TOKEN_REGISTRY.sBTC.mainnet.contractAddress!.split('.')
      expect(addressToString(tx.payload.contractAddress)).toBe(expectedAddress)
      expect(tx.payload.contractName.content).toBe(expectedName)
      expect(tx.payload.functionName.content).toBe('transfer')
    })

    it('targets the correct sBTC contract address and function (testnet)', () => {
      const tx = deserializeTransaction(sbtcTestnetHex)
      if (tx.payload.payloadType !== PayloadType.ContractCall) throw new Error('not a contract call')
      const [expectedAddress, expectedName] =
        TOKEN_REGISTRY.sBTC.testnet.contractAddress!.split('.')
      expect(addressToString(tx.payload.contractAddress)).toBe(expectedAddress)
      expect(tx.payload.contractName.content).toBe(expectedName)
      expect(tx.payload.functionName.content).toBe('transfer')
    })
  })

  describe('USDCx', () => {
    let usdcxMainnetHex: string
    let usdcxTestnetHex: string

    beforeAll(async () => {
      ;[usdcxMainnetHex, usdcxTestnetHex] = await Promise.all([
        buildPaymentTransaction({
          senderKey: SENDER_KEY,
          recipient: MAINNET_RECIPIENT,
          amount: 1_000_000n,
          tokenType: 'USDCx',
          network: 'mainnet',
        }),
        buildPaymentTransaction({
          senderKey: SENDER_KEY,
          recipient: TESTNET_RECIPIENT,
          amount: 1_000_000n,
          tokenType: 'USDCx',
          network: 'testnet',
        }),
      ])
    })

    it('produces sponsored ContractCall with fee=0n (mainnet)', () => {
      const tx = deserializeTransaction(usdcxMainnetHex)
      expect(tx.auth.authType).toBe(AuthType.Sponsored)
      expect(tx.auth.spendingCondition.fee).toBe(0n)
      expect(tx.payload.payloadType).toBe(PayloadType.ContractCall)
    })

    it('produces sponsored ContractCall with fee=0n (testnet)', () => {
      const tx = deserializeTransaction(usdcxTestnetHex)
      expect(tx.auth.authType).toBe(AuthType.Sponsored)
      expect(tx.auth.spendingCondition.fee).toBe(0n)
      expect(tx.payload.payloadType).toBe(PayloadType.ContractCall)
    })

    it('targets the correct USDCx contract address and function (mainnet)', () => {
      const tx = deserializeTransaction(usdcxMainnetHex)
      if (tx.payload.payloadType !== PayloadType.ContractCall) throw new Error('not a contract call')
      const [expectedAddress, expectedName] =
        TOKEN_REGISTRY.USDCx.mainnet.contractAddress!.split('.')
      expect(addressToString(tx.payload.contractAddress)).toBe(expectedAddress)
      expect(tx.payload.contractName.content).toBe(expectedName)
      expect(tx.payload.functionName.content).toBe('transfer')
    })

    it('targets the correct USDCx contract address and function (testnet)', () => {
      const tx = deserializeTransaction(usdcxTestnetHex)
      if (tx.payload.payloadType !== PayloadType.ContractCall) throw new Error('not a contract call')
      const [expectedAddress, expectedName] =
        TOKEN_REGISTRY.USDCx.testnet.contractAddress!.split('.')
      expect(addressToString(tx.payload.contractAddress)).toBe(expectedAddress)
      expect(tx.payload.contractName.content).toBe(expectedName)
      expect(tx.payload.functionName.content).toBe('transfer')
    })
  })

  describe('input validation', () => {
    // Use a fixed 64-char key for validation tests so each test isolates one parameter
    const VALID_KEY = 'a'.repeat(64)

    it('throws on senderKey that is too short', async () => {
      await expect(
        buildPaymentTransaction({
          senderKey: 'tooshort',
          recipient: MAINNET_RECIPIENT,
          amount: 1_000n,
          tokenType: 'STX',
          network: 'mainnet',
        }),
      ).rejects.toThrow('senderKey must be')
    })

    it('throws on recipient with invalid prefix', async () => {
      await expect(
        buildPaymentTransaction({
          senderKey: VALID_KEY,
          recipient: '0xdeadbeef',
          amount: 1_000n,
          tokenType: 'STX',
          network: 'mainnet',
        }),
      ).rejects.toThrow('recipient must be a valid Stacks address')
    })

    it('throws on amount === 0n', async () => {
      await expect(
        buildPaymentTransaction({
          senderKey: VALID_KEY,
          recipient: MAINNET_RECIPIENT,
          amount: 0n,
          tokenType: 'STX',
          network: 'mainnet',
        }),
      ).rejects.toThrow('amount must be > 0')
    })
  })
})
