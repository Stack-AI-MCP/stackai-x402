'use client'

import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import {
  connect as stacksConnect,
  disconnect as stacksDisconnect,
  isConnected as stacksIsConnected,
  getLocalStorage,
  isStacksWalletInstalled,
  request,
} from '@stacks/connect'
import {
  fetchCallReadOnlyFunction,
  standardPrincipalCV,
  cvToJSON,
  publicKeyToAddress,
} from '@stacks/transactions'
import { STACKS_MAINNET, STACKS_TESTNET } from '@stacks/network'

export interface WalletBalances {
  stx: string
  sbtc: string
  usdcx: string
}

export interface SignMessageResult {
  signature: string
  publicKey: string
}

export interface X402WalletState {
  address: string | null
  publicKey: string | null
  network: 'mainnet' | 'testnet'
  isConnected: boolean
  isConnecting: boolean
  isWalletInstalled: boolean
  balances: WalletBalances | null
  balancesLoading: boolean
  connectWallet: () => Promise<void>
  disconnectWallet: () => void
  refreshBalances: () => Promise<void>
  signMessage: (message: string) => Promise<SignMessageResult>
  /** Returns the verified signing public key, prompting the wallet if not yet stored. */
  getSigningPublicKey: () => Promise<string>
}

export const X402WalletContext = createContext<X402WalletState | null>(null)

// ── Contract addresses per network ──────────────────────────────────────────

const CONTRACTS = {
  mainnet: {
    sbtc: { address: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4', name: 'sbtc-token' },
    usdcx: { address: 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE', name: 'usdcx' },
  },
  testnet: {
    sbtc: { address: 'ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT', name: 'sbtc-token' },
    usdcx: { address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM', name: 'usdcx-v1' },
  },
} as const

const HIRO_API = {
  mainnet: 'https://api.hiro.so',
  testnet: 'https://api.testnet.hiro.so',
} as const

// ── Detect network from Stacks address prefix ──────────────────────────────

function detectNetwork(address: string): 'mainnet' | 'testnet' {
  if (address.startsWith('SP') || address.startsWith('SM')) return 'mainnet'
  return 'testnet'
}

// ── Verify a public key actually derives to the given Stacks address ─────────
// Uses publicKeyToAddress from @stacks/transactions (official SDK function).
// This ensures the key we stored matches the wallet's actual signing key.

function verifyPublicKeyMatchesAddress(pubKey: string, address: string): boolean {
  try {
    const net = detectNetwork(address)
    // publicKeyToAddress(publicKey, network) — public key is first arg
    const derived = publicKeyToAddress(pubKey, net)
    return derived === address
  } catch {
    return false
  }
}

// ── Balance fetchers ────────────────────────────────────────────────────────

async function fetchStxBalance(address: string, network: 'mainnet' | 'testnet'): Promise<string> {
  const baseUrl = HIRO_API[network]
  const res = await fetch(`${baseUrl}/v2/accounts/${address}`)
  if (!res.ok) throw new Error(`Hiro API error: ${res.status}`)
  const data = await res.json()
  const totalMicroStx = BigInt(data.balance)
  const lockedMicroStx = BigInt(data.locked || '0')
  const availableMicroStx = totalMicroStx - lockedMicroStx
  const stx = Number(availableMicroStx) / 1_000_000
  return stx.toFixed(6)
}

async function fetchTokenBalance(
  contractAddress: string,
  contractName: string,
  ownerAddress: string,
  network: 'mainnet' | 'testnet',
): Promise<string> {
  const stacksNetwork = network === 'mainnet' ? STACKS_MAINNET : STACKS_TESTNET
  const result = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: 'get-balance',
    functionArgs: [standardPrincipalCV(ownerAddress)],
    senderAddress: ownerAddress,
    network: stacksNetwork,
  })
  const json = cvToJSON(result)
  const rawValue = json.value?.value ?? json.value ?? '0'
  return rawValue.toString()
}

// ── Storage keys ─────────────────────────────────────────────────────────────
// Store address + public key together so we can re-validate on restore.

const PK_STORAGE_KEY = 'x402:publicKey'
const ADDR_STORAGE_KEY = 'x402:address'

export function X402WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [balances, setBalances] = useState<WalletBalances | null>(null)
  const [balancesLoading, setBalancesLoading] = useState(false)

  const network = useMemo(() => (address ? detectNetwork(address) : 'mainnet'), [address])

  const checkWalletInstalled = useCallback(() => {
    if (typeof window === 'undefined') return false
    return isStacksWalletInstalled()
  }, [])

  // ── Restore session on mount ───────────────────────────────────────────────
  useEffect(() => {
    const checkConnection = () => {
      const connected = stacksIsConnected()
      if (connected) {
        const userData = getLocalStorage()
        const stxAddress = userData?.addresses?.stx?.[0]?.address ?? null
        if (stxAddress && stxAddress !== address) {
          setAddress(stxAddress)
          // Restore the public key we verified at connect time.
          // Only restore if the stored key+address pair still matches.
          const storedPk = localStorage.getItem(PK_STORAGE_KEY)
          const storedAddr = localStorage.getItem(ADDR_STORAGE_KEY)
          if (storedPk && storedAddr === stxAddress && verifyPublicKeyMatchesAddress(storedPk, stxAddress)) {
            setPublicKey(storedPk)
          } else {
            // Stale or mismatched — clear so the user re-verifies on next payment
            localStorage.removeItem(PK_STORAGE_KEY)
            localStorage.removeItem(ADDR_STORAGE_KEY)
            setPublicKey(null)
          }
        }
      } else if (address !== null) {
        setAddress(null)
        setBalances(null)
        setPublicKey(null)
      }
    }

    checkConnection()
    const interval = setInterval(checkConnection, 1000)
    return () => clearInterval(interval)
  }, [address])

  const refreshBalances = useCallback(async () => {
    if (!address) return
    setBalancesLoading(true)
    const net = detectNetwork(address)
    const contracts = CONTRACTS[net]
    try {
      const [stx, sbtcRaw, usdcxRaw] = await Promise.allSettled([
        fetchStxBalance(address, net),
        fetchTokenBalance(contracts.sbtc.address, contracts.sbtc.name, address, net),
        fetchTokenBalance(contracts.usdcx.address, contracts.usdcx.name, address, net),
      ])

      setBalances({
        stx: stx.status === 'fulfilled' ? stx.value : '--',
        sbtc:
          sbtcRaw.status === 'fulfilled'
            ? (Number(sbtcRaw.value) / 1e8).toFixed(8)
            : '--',
        usdcx:
          usdcxRaw.status === 'fulfilled'
            ? (Number(usdcxRaw.value) / 1e6).toFixed(2)
            : '--',
      })
    } catch (err) {
      console.error('Failed to fetch balances:', err)
    } finally {
      setBalancesLoading(false)
    }
  }, [address])

  useEffect(() => {
    if (address) refreshBalances()
  }, [address, refreshBalances])

  // ── Connect wallet ─────────────────────────────────────────────────────────
  // After connecting, we sign a small verification message.
  // stx_signMessage always returns the publicKey for the current account's
  // signing key — this is the ONLY reliable source for the key used in
  // stx_signTransaction. We verify it with publicKeyToAddress before storing.

  const connectWallet = useCallback(async () => {
    setIsConnecting(true)
    try {
      const response = await stacksConnect()
      const stxEntry = response.addresses.find((a) => a.symbol?.toUpperCase() === 'STX')
      const stxAddress = stxEntry?.address ?? response.addresses[0]?.address
      if (!stxAddress) throw new Error('No STX address returned from wallet')
      setAddress(stxAddress)
      // publicKey is fetched on-demand via signMessage (see getSigningPublicKey below)
    } catch (err) {
      console.error('Wallet connection failed:', err)
    } finally {
      setIsConnecting(false)
    }
  }, [])

  const signMessage = useCallback(
    async (message: string): Promise<SignMessageResult> => {
      if (!address) throw new Error('Wallet not connected')
      const result = await request('stx_signMessage', { message })
      // stx_signMessage always returns the key for the current account — store it
      if (result.publicKey) {
        const pk = result.publicKey
        if (verifyPublicKeyMatchesAddress(pk, address)) {
          setPublicKey(pk)
          localStorage.setItem(PK_STORAGE_KEY, pk)
          localStorage.setItem(ADDR_STORAGE_KEY, address)
          console.log('[x402] Stored verified publicKey from signMessage')
        } else {
          console.warn('[x402] signMessage publicKey does not match address — not stored')
          console.log('[x402] publicKey:', pk)
          console.log('[x402] address:', address)
          console.log('[x402] derived:', publicKeyToAddress(pk, detectNetwork(address)))
        }
      }
      return {
        signature: result.signature,
        publicKey: result.publicKey ?? publicKey ?? '',
      }
    },
    [address, publicKey],
  )

  // Returns verified signing publicKey. If not cached, prompts wallet via stx_signMessage.
  // Used by payment flows to guarantee the key matches what stx_signTransaction will use.
  const getSigningPublicKey = useCallback(async (): Promise<string> => {
    if (!address) throw new Error('Wallet not connected')
    if (publicKey) return publicKey
    // Not cached — get it now via sign message
    const result = await signMessage(`StackAI x402: authorize ${address}`)
    if (!result.publicKey) throw new Error('Wallet did not return a public key')
    return result.publicKey
  }, [address, publicKey, signMessage])

  const disconnectWallet = useCallback(() => {
    stacksDisconnect()
    setAddress(null)
    setPublicKey(null)
    setBalances(null)
    localStorage.removeItem(PK_STORAGE_KEY)
    localStorage.removeItem(ADDR_STORAGE_KEY)
  }, [])

  const value = useMemo<X402WalletState>(
    () => ({
      address,
      publicKey,
      network,
      isConnected: !!address,
      isConnecting,
      isWalletInstalled: checkWalletInstalled(),
      balances,
      balancesLoading,
      connectWallet,
      disconnectWallet,
      refreshBalances,
      signMessage,
      getSigningPublicKey,
    }),
    [
      address,
      publicKey,
      network,
      isConnecting,
      checkWalletInstalled,
      balances,
      balancesLoading,
      connectWallet,
      disconnectWallet,
      refreshBalances,
      signMessage,
      getSigningPublicKey,
    ],
  )

  return <X402WalletContext.Provider value={value}>{children}</X402WalletContext.Provider>
}
