'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Check, MessageSquare, CheckCircle2, Wrench, Play } from 'lucide-react'
import { TokenBadge } from './TokenBadge'
import { ServerFavicon } from './ServerFavicon'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'

export interface ServerCardProps {
  id: string
  name: string
  description: string
  url: string
  toolCount: number
  priceRange: { min: number; max: number }
  acceptedTokens: string[]
  reputationScore: number
  network?: 'mainnet' | 'testnet'
  featured?: boolean
  approved?: boolean
}

function formatPrice(price: number): string {
  if (price === 0) return 'Free'
  if (price < 0.001) return `$${price.toFixed(6)}`
  if (price < 0.01) return `$${price.toFixed(4)}`
  return `$${price.toFixed(2)}`
}

export function ServerCard({
  id,
  name,
  description,
  url,
  toolCount,
  priceRange,
  acceptedTokens,
  network,
  featured,
  approved,
}: ServerCardProps) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)

  const mcpUrl = `${GATEWAY_URL}/mcp?id=${id}`

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(mcpUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleChat = (e: React.MouseEvent) => {
    e.stopPropagation()
    router.push(`/chat/${id}`)
  }

  const handleNavigate = () => router.push(`/marketplace/${id}`)

  return (
    <div
      onClick={handleNavigate}
      className="group rounded-xl border border-border bg-card hover:border-primary/40 cursor-pointer flex flex-col card-glow"
    >
      {/* Main card body */}
      <div className="p-5 flex-1 space-y-4">
        {/* Header: favicon + name + verified */}
        <div className="flex items-start gap-3">
          <ServerFavicon url={url} name={name} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-mono text-sm font-bold text-foreground tracking-wide leading-tight truncate">
                {name}
              </h3>
              {approved && (
                <div className="flex items-center gap-1 text-teal-500 shrink-0">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-mono uppercase tracking-wider">Verified</span>
                </div>
              )}
            </div>
            {/* Stats inline */}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
                <Wrench className="h-2.5 w-2.5" />
                {toolCount} TOOLS
              </span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-[10px] font-mono text-muted-foreground">
                {priceRange.min === 0 && priceRange.max === 0
                  ? 'Free'
                  : priceRange.min === priceRange.max
                    ? formatPrice(priceRange.min)
                    : `${formatPrice(priceRange.min)} – ${formatPrice(priceRange.max)}`}
              </span>
              {network === 'testnet' && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-widest bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-md">
                    TESTNET
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        {description && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {description}
          </p>
        )}

        {/* Token badges */}
        {acceptedTokens.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {acceptedTokens.map((token) => (
              <TokenBadge key={token} token={token} />
            ))}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-border/50" />

      {/* Action row */}
      <div className="px-3 py-2 flex items-center gap-1">
        <button
          onClick={handleCopy}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all rounded-lg"
          title="Copy MCP endpoint URL"
        >
          {copied
            ? <><Check className="h-3 w-3 text-teal-500" />COPIED</>
            : <><Copy className="h-3 w-3" />COPY URL</>
          }
        </button>
        <div className="w-px h-4 bg-border/50" />
        <button
          onClick={handleChat}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all rounded-lg"
        >
          <MessageSquare className="h-3 w-3" />
          CHAT →
        </button>
        <div className="w-px h-4 bg-border/50" />
        <button
          onClick={handleNavigate}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-primary hover:bg-primary/5 transition-all rounded-lg"
        >
          <Play className="h-3 w-3" />
          EXPLORE
        </button>
      </div>
    </div>
  )
}
