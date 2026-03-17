'use client'

import { useState, useEffect, useCallback } from 'react'
import { MessageCircle, Check, ExternalLink, Loader2, X } from 'lucide-react'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'
const BOT_USERNAME = 'StackAI402Bot'

interface TelegramConnectProps {
  walletAddress: string
  /** Compact inline mode (just a text link) vs full card */
  compact?: boolean
}

/**
 * Connect / disconnect Telegram for a wallet address.
 *
 * Flow: User clicks "Connect" → opens t.me/StackAI402Bot?start={address}
 * → bot stores chatId in Redis → this component polls /status and updates.
 */
export function TelegramConnect({ walletAddress, compact }: TelegramConnectProps) {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(true)

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `${GATEWAY_URL}/api/v1/telegram/status?address=${encodeURIComponent(walletAddress)}`,
      )
      if (res.ok) {
        const data = await res.json()
        setConnected(data.connected)
      }
    } catch {
      // Gateway offline — ignore
    } finally {
      setChecking(false)
    }
  }, [walletAddress])

  useEffect(() => {
    if (!walletAddress) return
    checkStatus()

    // Poll every 5s while not connected (user might be linking via Telegram)
    const interval = setInterval(() => {
      if (!connected) checkStatus()
    }, 5000)
    return () => clearInterval(interval)
  }, [walletAddress, connected, checkStatus])

  const handleDisconnect = async () => {
    try {
      await fetch(`${GATEWAY_URL}/api/v1/telegram/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletAddress }),
      })
      setConnected(false)
    } catch {
      // ignore
    }
  }

  const deepLink = `https://t.me/${BOT_USERNAME}?start=${walletAddress}`

  if (checking) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Checking Telegram...</span>
      </div>
    )
  }

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <MessageCircle className="h-4 w-4" />
          <span>Telegram connected</span>
          <Check className="h-3.5 w-3.5" />
        </div>
        <button
          type="button"
          onClick={handleDisconnect}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors"
          title="Disconnect Telegram"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  if (compact) {
    return (
      <a
        href={deepLink}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <MessageCircle className="h-4 w-4" />
        <span>Connect Telegram</span>
        <ExternalLink className="h-3 w-3" />
      </a>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-5 w-5 text-[#0088cc]" />
        <span className="text-sm font-medium">Telegram Notifications</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Get notified when someone pays for your tools, or when your agent posts on Moltbook.
      </p>
      <a
        href={deepLink}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-lg bg-[#0088cc] px-4 py-2 text-sm font-medium text-white hover:bg-[#0077b5] transition-colors"
      >
        <MessageCircle className="h-4 w-4" />
        Connect @{BOT_USERNAME}
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  )
}
