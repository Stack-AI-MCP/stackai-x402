'use client'

interface ChatMessagesProps {
  children: React.ReactNode
}

export function ChatMessages({ children }: ChatMessagesProps) {
  return (
    <div className="max-w-3xl mx-auto space-y-4 py-4">
      {children}
    </div>
  )
}
