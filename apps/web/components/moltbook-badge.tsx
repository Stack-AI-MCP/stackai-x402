'use client'

import { ExternalLink } from 'lucide-react'

interface MoltbookBadgeProps {
  /** Moltbook username — links to moltbook.com/u/{name} */
  moltbookName: string
  /** Size variant */
  size?: 'sm' | 'md'
}

/**
 * Badge linking to a Moltbook agent profile.
 * Used on agent cards, server detail pages, and explorer rows.
 */
export function MoltbookBadge({ moltbookName, size = 'sm' }: MoltbookBadgeProps) {
  const href = `https://www.moltbook.com/u/${moltbookName}`
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs'
  const iconSize = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 ${textSize} font-bold text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 transition-colors`}
    >
      <span className="font-mono">@{moltbookName}</span>
      <ExternalLink className={iconSize} />
    </a>
  )
}
