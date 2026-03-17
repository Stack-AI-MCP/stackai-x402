'use client'

import { Hero3D, SupportedBySection } from '@/components/landing/Hero3D'
import { ConsumerInfo } from '@/components/landing/ConsumerInfo'
import { DeveloperInfo } from '@/components/landing/DeveloperInfo'
import { FAQSection } from '@/components/landing/FAQSection'
import { TelegramSection } from '@/components/landing/TelegramSection'
import { Footer } from '@/components/landing/footer'
import { ServerCard } from '@/components/x402/ServerCard'
import { Check } from 'lucide-react'
import Link from 'next/link'
import useSWR from 'swr'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'
const fetcher = (url: string) => fetch(url).then(r => r.json()).then(d => d.servers ?? [])

function StatsSection() {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 border-y border-border/50">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
        {[
          { value: '$0.00', label: 'Setup Fee' },
          { value: '1.0%',  label: 'Protocol Fee' },
          { value: '3',     label: 'Payment Tokens' },
          { value: '∞',     label: 'Scalability' },
        ].map(({ value, label }) => (
          <div key={label} className="space-y-2">
            <div className="text-3xl sm:text-4xl font-bold font-mono text-foreground">{value}</div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function GithubInfo() {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
      <div className="rounded-[2px] bg-card border border-border p-6 lg:p-10">
        <div className="flex flex-col lg:flex-row gap-10 lg:gap-16 items-start lg:items-center">
          <div className="flex-1 flex flex-col gap-8">
            <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold font-host text-foreground leading-tight max-w-3xl">
              The most complete gateway.{' '}
              <span className="font-normal text-muted-foreground">Leave a star if you scrolled all this way.</span>
            </h2>
            <div className="flex flex-col gap-3">
              {[
                'Forever free: no fees on micropayments',
                'Open Source under MIT license',
                'Built for Stacks Bitcoin L2 ecosystem',
                'Non-intrusive — zero code changes required',
              ].map((item) => (
                <div key={item} className="flex items-center gap-3">
                  <div className="w-6 h-6 bg-teal-500/10 rounded flex items-center justify-center flex-shrink-0">
                    <Check className="w-3 h-3 text-teal-700 dark:text-teal-400" strokeWidth={2.5} />
                  </div>
                  <span className="font-medium text-foreground">{item}</span>
                </div>
              ))}
            </div>
            <a href="https://github.com/aibtcdev/stackai-x402" target="_blank" rel="noopener noreferrer" className="w-full lg:max-w-[280px]">
              <button className="btn-primary-tall w-full">STAR ON GITHUB</button>
            </a>
          </div>

          {/* Code block */}
          <div className="flex-1 w-full">
            <div className="bg-background rounded-[2px] border border-border overflow-hidden">
              <div className="px-4 py-2 border-b border-border bg-muted/50 flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-full bg-red-400/60" />
                <div className="h-3 w-3 rounded-full bg-yellow-400/60" />
                <div className="h-3 w-3 rounded-full bg-green-400/60" />
                <span className="ml-3 text-[11px] font-mono text-muted-foreground">claude_desktop_config.json</span>
              </div>
              <pre className="p-5 text-xs font-mono leading-6 overflow-x-auto text-muted-foreground">
{`{
  "mcpServers": {
    "stacks-ai": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-proxy"],
      "env": {
        "PROXY_URL": "https://gateway.stacksai.xyz/mcp?id=YOUR_ID"
      }
    }
  }
}`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function LandingPage() {
  const { data: servers = [], isLoading } = useSWR(`${GATEWAY_URL}/api/v1/servers`, fetcher)
  const featured = servers.slice(0, 3)

  return (
    <div className="min-h-screen bg-background">
      <Hero3D />
      <SupportedBySection />
      <ConsumerInfo />

      {/* Featured Servers */}
      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        <div className="mb-8">
          <h2 className="text-lg sm:text-xl lg:text-2xl font-medium font-host text-muted-foreground">
            Featured Servers
          </h2>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-52 bg-card border border-border rounded-[2px] animate-pulse" />
              ))
            : featured.map((s: any) => <ServerCard key={s.serverId} {...{
                id: s.serverId, name: s.name, description: s.description,
                url: s.url ?? '', toolCount: s.toolCount, priceRange: s.priceRange,
                acceptedTokens: s.acceptedTokens, reputationScore: 5,
              }} />)
          }
        </div>
        <div className="flex justify-center mt-10">
          <Link href="/marketplace">
            <button className="btn-primary-tall min-w-[220px]">Browse All Servers</button>
          </Link>
        </div>
      </section>

      <DeveloperInfo />
      <StatsSection />
      <TelegramSection />
      <FAQSection />
      <GithubInfo />

      {/* Final CTA */}
      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center space-y-6">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-medium font-host text-foreground leading-tight">
            Start monetizing your MCP servers today.
          </h2>
          <Link href="/register">
            <button className="btn-primary-tall min-w-[220px] mt-4">GET STARTED</button>
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  )
}
