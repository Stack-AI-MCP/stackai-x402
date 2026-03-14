import * as React from 'react'
import { cn } from '@/lib/utils/format'

interface HighlighterTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode
}

export function HighlighterText({ children, className, ...props }: HighlighterTextProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-mono text-xs uppercase font-medium tracking-wide px-2 py-1 rounded-[2px] bg-muted text-muted-foreground',
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}
