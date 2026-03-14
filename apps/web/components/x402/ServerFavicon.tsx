'use client'

import { useState } from 'react'

interface ServerFaviconProps {
  url: string
  name: string
  className?: string
  /** Size variant — controls the wrapper + font size */
  size?: 'sm' | 'md' | 'lg'
}

const SIZE = {
  sm: { wrapper: 'h-9 w-9', text: 'text-base' },
  md: { wrapper: 'h-10 w-10', text: 'text-base' },
  lg: { wrapper: 'h-14 w-14', text: 'text-xl' },
} as const

/** Extracts root domain: mcp.midl-ai.xyz → midl-ai.xyz */
function rootDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname
    const parts = hostname.split('.')
    return parts.length > 2 ? parts.slice(-2).join('.') : hostname
  } catch {
    return null
  }
}

/**
 * Reusable server favicon/logo component.
 * Uses DuckDuckGo's favicon service (real icons, not grey globes).
 * Falls back to a letter avatar on error.
 */
export function ServerFavicon({ url, name, className = '', size = 'md' }: ServerFaviconProps) {
  const [failed, setFailed] = useState(false)
  const domain = rootDomain(url)
  const logoUrl = domain ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : null
  const { wrapper, text } = SIZE[size]

  if (!failed && logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        onError={() => setFailed(true)}
        className={`${wrapper} rounded-[2px] object-contain bg-muted p-1 shrink-0 border border-border/50 ${className}`}
      />
    )
  }

  return (
    <div
      className={`${wrapper} rounded-[2px] bg-primary/10 border border-border/50 flex items-center justify-center shrink-0 ${className}`}
    >
      <span className={`${text} font-bold font-mono text-primary uppercase`}>
        {name.charAt(0)}
      </span>
    </div>
  )
}
