'use client'

import { Bot } from 'lucide-react'
import { motion } from 'motion/react'

interface ChatEmptyStateProps {
  title: string
  starterPrompts: string[]
  isLoading: boolean
  onSelectPrompt: (prompt: string) => void
}

export function ChatEmptyState({
  title,
  starterPrompts,
  isLoading,
  onSelectPrompt,
}: ChatEmptyStateProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-8 px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="text-center space-y-3"
      >
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <Bot className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold font-host">{title}</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Ask anything — free tools run instantly, paid tools show a payment prompt before executing.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15 }}
        className="grid grid-cols-2 gap-2 w-full max-w-lg"
      >
        {starterPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={isLoading}
            onClick={() => onSelectPrompt(prompt)}
            className="rounded-xl border border-border bg-card/50 p-3 text-left text-xs hover:border-primary/40 hover:bg-card card-glow disabled:opacity-50 transition-colors"
          >
            {prompt}
          </button>
        ))}
      </motion.div>
    </div>
  )
}
