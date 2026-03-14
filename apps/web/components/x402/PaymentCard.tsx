'use client'

import { useState } from 'react'
import { Check, X, ExternalLink, Loader2, ChevronDown, RefreshCw } from 'lucide-react'

export type PaymentStatus = 'pending' | 'signing' | 'approved' | 'settled' | 'rejected' | 'error'

// V2 Coinbase-compatible format from gateway
export interface PaymentAccept {
  scheme: string
  network: string
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds: number
}

export interface PaymentRequirement {
  x402Version: 2
  resource: { url: string }
  accepts: PaymentAccept[]
}

interface PaymentCardProps {
  toolName: string
  payment: PaymentRequirement
  status: PaymentStatus
  error?: string
  errorCode?: string
  txid?: string
  onApprove: (tokenType: string) => void
  onReject: () => void
}

const TOKEN_DECIMALS: Record<string, number> = {
  STX: 6,
  sBTC: 8,
  USDCx: 6,
}

const TOKEN_LABELS: Record<string, string> = {
  STX: 'STX',
  sBTC: 'sBTC',
  USDCx: 'USDCx',
}

function formatTokenAmount(raw: string, tokenType: string): string {
  const decimals = TOKEN_DECIMALS[tokenType] ?? 6
  const value = Number(raw) / Math.pow(10, decimals)
  return value.toFixed(decimals <= 2 ? 2 : decimals > 6 ? 8 : 6)
}

function getErrorMessage(errorCode?: string, fallbackMessage?: string): {
  message: string
  showNetworkLink: boolean
} {
  switch (errorCode) {
    case 'NETWORK_MISMATCH':
      return {
        message: 'Network mismatch — switch to Stacks mainnet in your wallet settings',
        showNetworkLink: true,
      }
    case 'AMOUNT_MISMATCH':
      return {
        message: 'Amount mismatch — payment amount did not meet the required cost',
        showNetworkLink: false,
      }
    case 'RELAY_UNAVAILABLE':
    case 'RELAY_FAILED':
      return {
        message: 'Relay unavailable — try again later',
        showNetworkLink: false,
      }
    case 'REPLAY_DETECTED':
      return {
        message: 'Payment already processed — refresh the page',
        showNetworkLink: false,
      }
    case 'INSUFFICIENT_BALANCE':
      return {
        message: 'Insufficient balance — add funds to your wallet before retrying',
        showNetworkLink: false,
      }
    default:
      return {
        message: fallbackMessage ?? 'Payment failed',
        showNetworkLink: false,
      }
  }
}

function explorerUrl(txid: string, network: string): string {
  // network is CAIP-2: "stacks:1" = mainnet, "stacks:2147483648" = testnet
  const isMainnet = network === 'stacks:1' || network === 'mainnet'
  const base = 'https://explorer.hiro.so/txid'
  return `${base}/${txid}${isMainnet ? '' : '?chain=testnet'}`
}

export function PaymentCard({
  toolName,
  payment,
  status,
  error,
  errorCode,
  txid,
  onApprove,
  onReject,
}: PaymentCardProps) {
  // Build token list from accepts array
  const tokens = payment.accepts.map((a) => a.asset)
  const [selectedToken, setSelectedToken] = useState(tokens[0] ?? 'STX')

  // Get selected accept entry
  const selectedAccept = payment.accepts.find((a) => a.asset === selectedToken) ?? payment.accepts[0]

  const errorInfo = status === 'error' ? getErrorMessage(errorCode, error) : null

  if (status === 'settled' && txid) {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-green-600">
          <Check className="h-4 w-4" />
          Payment settled — {toolName}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <a
            href={explorerUrl(txid, selectedAccept?.network ?? 'stacks:1')}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-primary hover:underline"
          >
            View on Explorer <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    )
  }

  if (status === 'rejected') {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <X className="h-4 w-4" />
          Payment rejected — {toolName}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="text-sm font-medium">Payment required — {toolName}</div>

      <div className="mt-3 space-y-2 text-xs">
        {/* Token selector + cost */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Token</span>
          {tokens.length === 1 ? (
            <span className="font-medium">{TOKEN_LABELS[selectedToken] ?? selectedToken}</span>
          ) : (
            <div className="relative">
              <select
                value={selectedToken}
                onChange={(e) => setSelectedToken(e.target.value)}
                disabled={status !== 'pending' && status !== 'error'}
                className="appearance-none rounded border border-input bg-background py-1 pl-2 pr-6 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {tokens.map((t) => (
                  <option key={t} value={t}>
                    {TOKEN_LABELS[t] ?? t}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Cost</span>
          <span className="font-medium">
            {formatTokenAmount(selectedAccept?.amount ?? '0', selectedToken)}{' '}
            {TOKEN_LABELS[selectedToken] ?? selectedToken}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Recipient</span>
          <span className="font-mono text-[10px]">
            {(selectedAccept?.payTo ?? '').slice(0, 8)}...{(selectedAccept?.payTo ?? '').slice(-6)}
          </span>
        </div>
      </div>

      {/* Error */}
      {errorInfo && (
        <div className="mt-2 space-y-1 rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          <div>{errorInfo.message}</div>
          {errorInfo.showNetworkLink && (
            <a
              href="https://leather.io/guides/change-network"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-primary hover:underline"
            >
              Wallet network settings <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onApprove(selectedToken)}
          disabled={status === 'signing' || status === 'approved'}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === 'signing' ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Signing...
            </>
          ) : status === 'approved' ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Processing...
            </>
          ) : status === 'error' ? (
            <>
              <RefreshCw className="h-3 w-3" />
              Retry
            </>
          ) : (
            'Approve'
          )}
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={status !== 'pending' && status !== 'error'}
          className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  )
}
