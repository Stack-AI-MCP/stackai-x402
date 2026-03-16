'use client'

import { useRef, useEffect } from 'react'
import { Send, Loader2, Terminal } from 'lucide-react'

interface ChatInputProps {
  value: string
  onChange: (val: string) => void
  onSubmit: () => void
  isLoading: boolean
  placeholder?: string
  starterChips?: string[]
}

const DEFAULT_CHIPS = ['Bridge sBTC', 'Swap tokens', 'Deploy contract', 'Query protocol']

export function ChatInput({
  value,
  onChange,
  onSubmit,
  isLoading,
  placeholder = 'Ask something...',
  starterChips = DEFAULT_CHIPS,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea up to 200px
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [value])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !isLoading) onSubmit()
    }
  }

  return (
    <div
      className="rounded-2xl border border-border/80 p-4 transition-all duration-200
        focus-within:border-primary/60"
      style={{
        backgroundColor: 'hsl(var(--background-secondary))',
      }}
      // inline style for the glow because Tailwind JIT can't pick up CSS var() in box-shadow
      onFocus={() => {}}
      tabIndex={-1}
    >
      {/* Input row */}
      <div className="flex items-start gap-3">
        <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-primary/60" />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={isLoading}
          className="flex-1 resize-none overflow-hidden bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
          style={{ maxHeight: '200px' }}
        />
      </div>

      {/* Bottom row: chips + send button */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {starterChips.map((chip) => (
            <button
              key={chip}
              type="button"
              disabled={isLoading}
              onClick={() => onChange(chip)}
              className="rounded-full border border-border/60 px-2.5 py-0.5 text-[11px] font-mono text-muted-foreground
                hover:border-primary/40 hover:text-foreground transition-colors disabled:opacity-40"
            >
              {chip}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:block text-[10px] font-mono text-muted-foreground/50">⌘↵</span>
          <button
            type="button"
            disabled={isLoading || !value.trim()}
            onClick={onSubmit}
            aria-label="Send message"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white
              hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
