'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Wrench, Loader2 } from 'lucide-react'

interface ToolResultProps {
  output: unknown
}

export function ToolResult({ output }: ToolResultProps) {
  const [expanded, setExpanded] = useState(false)
  const formatted =
    typeof output === 'string' ? output : JSON.stringify(output, null, 2)
  const lines = formatted.split('\n')
  const isLong = lines.length > 6

  return (
    <div className="mt-2">
      <pre
        className={`whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed overflow-auto rounded-lg bg-background/60 border border-border/50 p-3 ${
          isLong && !expanded ? 'max-h-[7rem]' : 'max-h-[32rem]'
        }`}
      >
        {formatted}
      </pre>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? 'collapse' : `show ${lines.length - 6} more lines`}
        </button>
      )}
    </div>
  )
}

interface ToolCallCardProps {
  toolName: string
  isRunning: boolean
  children?: React.ReactNode
}

export function ToolCallCard({ toolName, isRunning, children }: ToolCallCardProps) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-xs font-mono font-medium text-muted-foreground">
        <Wrench className="h-3 w-3 text-primary/60" />
        <span className="text-primary/80">{toolName}</span>
        {isRunning && (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-[10px]">running…</span>
          </>
        )}
      </div>
      {children}
    </div>
  )
}
