'use client'

import { useState } from 'react'
import { Wallet, LogOut, ExternalLink, RefreshCw } from 'lucide-react'
import { isStacksWalletInstalled } from '@stacks/connect'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useX402Wallet } from '@/hooks/use-x402-wallet'

const WALLET_LINKS = [
  {
    name: 'Leather',
    url: 'https://leather.io/install-extension',
    description: 'Full-featured Stacks wallet',
  },
  {
    name: 'Xverse',
    url: 'https://www.xverse.app/download',
    description: 'Bitcoin & Stacks wallet',
  },
]

export function WalletButton() {
  const {
    address,
    isConnected,
    isConnecting,
    isWalletInstalled,
    balances,
    balancesLoading,
    connectWallet,
    disconnectWallet,
    refreshBalances,
  } = useX402Wallet()

  const [showInstallDialog, setShowInstallDialog] = useState(false)

  const handleConnect = async () => {
    // Check live — user may have installed wallet after page load
    if (!isStacksWalletInstalled()) {
      setShowInstallDialog(true)
      return
    }
    await connectWallet()
  }

  if (isConnected && address) {
    const truncated = `${address.slice(0, 5)}...${address.slice(-4)}`

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            <span className="font-mono text-xs">{truncated}</span>
            {balances && !balancesLoading && balances.stx !== '--' && (
              <span className="hidden text-xs text-muted-foreground lg:inline">
                {parseFloat(balances.stx).toFixed(2)} STX
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <div className="px-3 py-2">
            <p className="text-xs text-muted-foreground">Connected</p>
            <p className="font-mono text-xs break-all">{address}</p>
          </div>
          <DropdownMenuSeparator />
          {balancesLoading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Loading balances...
            </div>
          ) : balances ? (
            <div className="px-3 py-2 space-y-1">
              <div className="flex justify-between text-sm">
                <span>STX</span>
                <span className="font-mono">
                  {balances.stx === '--' ? '--' : parseFloat(balances.stx).toFixed(6)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span>sBTC</span>
                <span className="font-mono">
                  {balances.sbtc === '--' ? '--' : parseFloat(balances.sbtc).toFixed(8)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span>USDCx</span>
                <span className="font-mono">
                  {balances.usdcx === '--' ? '--' : parseFloat(balances.usdcx).toFixed(2)}
                </span>
              </div>
            </div>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => refreshBalances()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh Balances
          </DropdownMenuItem>
          <DropdownMenuItem onClick={disconnectWallet}>
            <LogOut className="mr-2 h-4 w-4" />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleConnect}
        disabled={isConnecting}
        className="gap-2"
      >
        <Wallet className="h-4 w-4" />
        {isConnecting ? 'Connecting...' : 'Connect Wallet'}
      </Button>

      <Dialog open={showInstallDialog} onOpenChange={setShowInstallDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install a Stacks Wallet</DialogTitle>
            <DialogDescription>
              You need a Stacks-compatible wallet extension to connect. Install
              one of the following:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            {WALLET_LINKS.map((wallet) => (
              <a
                key={wallet.name}
                href={wallet.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-lg border border-border p-4 transition-colors hover:bg-accent"
              >
                <div>
                  <p className="font-medium">{wallet.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {wallet.description}
                  </p>
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </a>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
