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
} from '@stacks/transactions'
import { STACKS_MAINNET } from '@stacks/network'

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
  isConnected: boolean
  isConnecting: boolean
  isWalletInstalled: boolean
  balances: WalletBalances | null
  balancesLoading: boolean
  connectWallet: () => Promise<void>
  disconnectWallet: () => void
  refreshBalances: () => Promise<void>
  signMessage: (message: string) => Promise<SignMessageResult>
}

export const X402WalletContext = createContext<X402WalletState | null>(null)

const SBTC_CONTRACT_ADDRESS = 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4'
const SBTC_CONTRACT_NAME = 'sbtc-token'
const USDCX_CONTRACT_ADDRESS = 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE'
const USDCX_CONTRACT_NAME = 'usdcx'

async function fetchStxBalance(address: string): Promise<string> {
  const res = await fetch(`https://api.hiro.so/v2/accounts/${address}`)
  if (!res.ok) throw new Error(`Hiro API error: ${res.status}`)
  const data = await res.json()
  // balance includes locked (stacked) STX — subtract to get spendable
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
): Promise<string> {
  const result = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: 'get-balance',
    functionArgs: [standardPrincipalCV(ownerAddress)],
    senderAddress: ownerAddress,
    network: STACKS_MAINNET,
  })
  const json = cvToJSON(result)
  // SIP-010 get-balance returns (response uint uint)
  const rawValue = json.value?.value ?? json.value ?? '0'
  return rawValue.toString()
}

const PK_STORAGE_KEY = 'x402:publicKey'

export function X402WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [balances, setBalances] = useState<WalletBalances | null>(null)
  const [balancesLoading, setBalancesLoading] = useState(false)

  const checkWalletInstalled = useCallback(() => {
    if (typeof window === 'undefined') return false
    return isStacksWalletInstalled()
  }, [])

  // Poll for connection changes (same pattern as existing useWalletAuth)
  useEffect(() => {
    const checkConnection = () => {
      const connected = stacksIsConnected()
      if (connected) {
        const userData = getLocalStorage()
        const stxAddress = userData?.addresses?.stx?.[0]?.address ?? null
        if (stxAddress && stxAddress !== address) {
          setAddress(stxAddress)
          // Restore publicKey from our own storage (@stacks/connect strips it)
          const storedPk = localStorage.getItem(PK_STORAGE_KEY)
          if (storedPk) {
            setPublicKey(storedPk)
          }
        }
      } else if (address !== null) {
        setAddress(null)
        setBalances(null)
      }
    }

    checkConnection()
    const interval = setInterval(checkConnection, 1000)
    return () => clearInterval(interval)
  }, [address])

  const refreshBalances = useCallback(async () => {
    if (!address) return
    setBalancesLoading(true)
    try {
      const [stx, sbtcRaw, usdcxRaw] = await Promise.allSettled([
        fetchStxBalance(address),
        fetchTokenBalance(SBTC_CONTRACT_ADDRESS, SBTC_CONTRACT_NAME, address),
        fetchTokenBalance(USDCX_CONTRACT_ADDRESS, USDCX_CONTRACT_NAME, address),
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

  // Fetch balances when address changes
  useEffect(() => {
    if (address) {
      refreshBalances()
    }
  }, [address, refreshBalances])

  const connectWallet = useCallback(async () => {
    setIsConnecting(true)
    try {
      const response = await stacksConnect()
      // Filter by STX symbol — connect() returns both STX and BTC addresses
      const stxEntry = response.addresses.find(
        (a) => a.symbol?.toUpperCase() === 'STX',
      )
      const stxAddress = stxEntry?.address ?? response.addresses[0]?.address
      const stxPubKey = stxEntry?.publicKey ?? response.addresses[0]?.publicKey ?? null
      if (stxAddress) {
        setAddress(stxAddress)
        setPublicKey(stxPubKey)
        if (stxPubKey) {
          localStorage.setItem(PK_STORAGE_KEY, stxPubKey)
        }
      }
    } catch (err) {
      console.error('Wallet connection failed:', err)
    } finally {
      setIsConnecting(false)
    }
  }, [])

  const signMessage = useCallback(async (message: string): Promise<SignMessageResult> => {
    if (!address) throw new Error('Wallet not connected')
    const result = await request('stx_signMessage', { message })
    return {
      signature: result.signature,
      publicKey: result.publicKey ?? publicKey ?? '',
    }
  }, [address, publicKey])

  const disconnectWallet = useCallback(() => {
    stacksDisconnect()
    setAddress(null)
    setPublicKey(null)
    setBalances(null)
    localStorage.removeItem(PK_STORAGE_KEY)
  }, [])

  const value = useMemo<X402WalletState>(
    () => ({
      address,
      publicKey,
      isConnected: !!address,
      isConnecting,
      isWalletInstalled: checkWalletInstalled(),
      balances,
      balancesLoading,
      connectWallet,
      disconnectWallet,
      refreshBalances,
      signMessage,
    }),
    [
      address,
      publicKey,
      isConnecting,
      checkWalletInstalled,
      balances,
      balancesLoading,
      connectWallet,
      disconnectWallet,
      refreshBalances,
      signMessage,
    ],
  )

  return (
    <X402WalletContext.Provider value={value}>{children}</X402WalletContext.Provider>
  )
}
