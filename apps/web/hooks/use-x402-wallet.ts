'use client'

import { useContext } from 'react'
import { X402WalletContext } from '@/contexts/x402-wallet-context'

/**
 * Hook to access X402 wallet state and actions.
 * Must be used within X402WalletProvider.
 */
export function useX402Wallet() {
  const context = useContext(X402WalletContext)
  if (!context) {
    throw new Error('useX402Wallet must be used within X402WalletProvider')
  }
  return context
}
