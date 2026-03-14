'use client'

import { ThemeProvider } from '@/components/providers/theme-context'
import { X402WalletProvider } from '@/contexts/x402-wallet-context'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <X402WalletProvider>
        {children}
      </X402WalletProvider>
    </ThemeProvider>
  )
}
