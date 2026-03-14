'use client'

import { HighlighterText } from './HighlighterText'
import { InfoCard } from './InfoCard'
import { ChartLine, DoorOpen, PiggyBank } from 'lucide-react'

export function ConsumerInfo() {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
      <div className="flex flex-col gap-12">
        <div className="flex flex-col gap-4">
          <div className="inline-flex">
            <HighlighterText>CONSUME MCP SERVERS</HighlighterText>
          </div>
          <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold font-host text-foreground leading-tight max-w-4xl">
            Pay cents per tool call.{' '}
            <span className="font-normal text-muted-foreground">
              Instead of expensive subscriptions. Consume any paid MCP with a single account.
            </span>
          </h2>
        </div>

        {/* Live server example card */}
        <div className="rounded-[2px] bg-card border border-border p-6 flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <div className="flex-1">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-1">Server example</p>
            <h3 className="font-host font-semibold text-lg text-foreground">Stacks AI MCP Gateway</h3>
            <p className="text-sm text-muted-foreground mt-0.5">via StacksAI x402 · <span className="text-primary font-mono">~$0.001 /tool call</span></p>
          </div>
          <a href="/marketplace">
            <button className="btn-primary-tall !h-10 !px-6 !text-xs">BROWSE ALL</button>
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <InfoCard
            icon={ChartLine}
            label="USAGE BASED"
            copy="Forget subscriptions and pay only for what you use. Pay per tool call."
          />
          <InfoCard
            icon={DoorOpen}
            label="NO LOCK IN"
            copy="Withdraw your funds at any time. Your keys, your funds."
          />
          <InfoCard
            icon={PiggyBank}
            label="NO PLATFORM FEE"
            copy="1% protocol fee only. No setup fees, no monthly minimum, no hidden costs."
          />
        </div>
      </div>
    </section>
  )
}
