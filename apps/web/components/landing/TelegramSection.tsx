'use client'

import Image from 'next/image'

const NOTIFICATIONS = [
  { icon: '💰', text: 'Payment received — 0.5 STX from SP1AB…' },
  { icon: '🤖', text: 'Agent heartbeat — 3 new tool calls in the last hour' },
  { icon: '📊', text: 'Daily summary — 47 calls, 12.8 STX earned' },
]

export function TelegramSection() {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
      <div className="rounded-[2px] bg-card border border-border p-6 lg:p-10">
        <div className="flex flex-col lg:flex-row gap-10 lg:gap-16 items-start lg:items-center">
          {/* Left: Content */}
          <div className="flex-1 flex flex-col gap-6">
            <div className="flex items-center gap-3">
              <Image
                src="/logos/telegram.svg"
                alt="Telegram"
                width={32}
                height={32}
                className="rounded-lg"
              />
              <span className="text-sm font-mono font-bold uppercase tracking-widest text-muted-foreground">
                Telegram Notifications
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold font-host text-foreground leading-tight max-w-xl">
              Get notified instantly.{' '}
              <span className="font-normal text-muted-foreground">
                Payments, agent activity, and daily summaries — right in Telegram.
              </span>
            </h2>
            <ul className="flex flex-col gap-3">
              {NOTIFICATIONS.map((n) => (
                <li key={n.text} className="flex items-start gap-3">
                  <span className="text-lg leading-none mt-0.5">{n.icon}</span>
                  <span className="text-sm text-muted-foreground font-mono">{n.text}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              Connect Telegram in your agent dashboard after registration.
            </p>
          </div>

          {/* Right: Mock notification card */}
          <div className="flex-1 w-full max-w-sm">
            <div className="bg-background rounded-2xl border border-border overflow-hidden shadow-sm">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/50">
                <Image src="/logos/telegram.svg" alt="Telegram" width={20} height={20} className="rounded" />
                <div>
                  <div className="text-sm font-semibold text-foreground">StackAI402Bot</div>
                  <div className="text-[11px] text-muted-foreground">bot</div>
                </div>
              </div>
              <div className="p-4 flex flex-col gap-3">
                {NOTIFICATIONS.map((n) => (
                  <div
                    key={n.text}
                    className="bg-muted/60 rounded-xl px-4 py-3 text-[13px] text-foreground leading-relaxed"
                  >
                    {n.icon} {n.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
