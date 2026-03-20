'use client'

import { Bot, User } from 'lucide-react'
import { ChatMarkdown } from './chat-markdown'

interface ChatMessageProps {
  role: 'user' | 'assistant'
  children: React.ReactNode
}

export function ChatMessage({ role, children }: ChatMessageProps) {
  const isUser = role === 'user'

  return (
    <div className="group flex gap-3 hover:bg-muted/30 rounded-xl px-3 py-3 -mx-3 transition-colors">
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
          isUser
            ? 'bg-primary/10 border-primary/20 text-primary'
            : 'bg-muted border-border text-muted-foreground'
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
          {isUser ? 'You' : 'Assistant'}
        </span>
        {children}
      </div>
    </div>
  )
}

interface ChatMessageTextProps {
  text: string
  role: 'user' | 'assistant'
}

export function ChatMessageText({ text, role }: ChatMessageTextProps) {
  if (role === 'assistant') {
    return <ChatMarkdown content={text} />
  }
  return <div className="whitespace-pre-wrap text-sm leading-relaxed">{text}</div>
}
