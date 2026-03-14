'use client'

import Image from 'next/image'
import Link from 'next/link'
import { HighlighterText } from './HighlighterText'
import { InfoCard } from './InfoCard'
import { PackageOpen, ShieldCheck, Globe } from 'lucide-react'
import { useRef } from 'react'

const AI_CLIENTS = [
  { name: 'ChatGPT',  src: '/logos/mcp-clients/OpenAI-black-monoblossom.svg', bg: '#FFFFFF' },
  { name: 'Cursor',   src: '/logos/mcp-clients/cursor-cube.svg',              bg: '#F6F6F2' },
  { name: 'Claude',   src: '/logos/mcp-clients/claude.svg',                   bg: '#D97757' },
  { name: 'Grok',     src: '/logos/mcp-clients/Grok_Logomark_Light.svg',      bg: '#000000' },
  { name: 'Gemini',   src: '/logos/mcp-clients/Google_Gemini_icon_2025.svg',  bg: '#FFFFFF' },
]

export function DeveloperInfo() {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
      <div className="flex flex-col gap-12">
        <div className="flex flex-col gap-4">
          <div className="inline-flex">
            <HighlighterText>PROVIDE PAID ENDPOINTS</HighlighterText>
          </div>
          <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold font-host text-foreground leading-tight max-w-3xl">
            No-code MCP monetization.{' '}
            <span className="font-normal text-muted-foreground">
              Paste your URL, set prices, start earning. Built for Stacks Bitcoin L2.
            </span>
          </h2>
        </div>

        {/* Visual proxy diagram */}
        <div className="rounded-[2px] bg-card border border-border p-6 lg:p-10 flex flex-col gap-8">
          <div className="inline-flex">
            <HighlighterText className="!text-foreground">STACKSAI X402 PROXY</HighlighterText>
          </div>

          {/* Diagram */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6 py-4">
            {/* Left: Your app */}
            <div className="flex flex-col items-center gap-2">
              <div className="w-14 h-14 rounded-full bg-muted border border-border flex items-center justify-center text-2xl">
                👤
              </div>
              <span className="text-xs font-mono text-muted-foreground">YOUR APP</span>
            </div>

            {/* Arrow + label */}
            <div className="flex flex-col items-center gap-1 flex-1">
              <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/40 to-transparent relative">
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[10px] font-mono bg-background px-2 text-muted-foreground">x402 payment</span>
                </div>
              </div>
            </div>

            {/* Center: StacksAI Gateway */}
            <div className="flex flex-col items-center gap-2">
              <div className="w-20 h-20 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
                <span className="font-mono text-[10px] font-bold text-primary text-center leading-tight">STACKS<br/>AI</span>
              </div>
              <span className="text-xs font-mono text-muted-foreground">GATEWAY</span>
            </div>

            {/* Arrow */}
            <div className="flex flex-col items-center gap-1 flex-1">
              <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
            </div>

            {/* Right: AI clients */}
            <div className="flex flex-col items-center gap-3">
              <div className="flex flex-col gap-2">
                {AI_CLIENTS.map((client) => (
                  <div
                    key={client.name}
                    className="w-10 h-10 rounded-full border border-border/50 flex items-center justify-center"
                    style={{ backgroundColor: client.bg }}
                  >
                    <Image src={client.src} alt={client.name} width={22} height={22} className="object-contain" />
                  </div>
                ))}
              </div>
              <span className="text-xs font-mono text-muted-foreground">AI CLIENTS</span>
            </div>
          </div>

          {/* CTA row */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-6">
            <p className="font-medium leading-relaxed text-base lg:max-w-[50%]">
              <span className="text-foreground">Register your API/MCP and any AI client can consume it.</span>{' '}
              <span className="text-muted-foreground">We handle x402 payments: you just get paid.</span>
            </p>
            <div className="flex flex-col sm:flex-row gap-4 lg:flex-1">
              <Link href="/register" className="flex-1">
                <button className="btn-primary-tall w-full">Register (No Code)</button>
              </Link>
              <a href="https://github.com/aibtcdev/stacks-ai" target="_blank" rel="noopener noreferrer" className="flex-1">
                <button className="btn-secondary-tall w-full">View Source</button>
              </a>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <InfoCard
            icon={PackageOpen}
            label="OPEN SOURCE"
            copy="Forever free. No fees. Developers can audit the entire code."
            ctaText="SOURCE CODE"
            ctaHref="https://github.com/aibtcdev/stacks-ai"
          />
          <InfoCard
            icon={ShieldCheck}
            label="NON INTRUSIVE"
            copy="Wraps around your MCP/API so you can start charging with zero refactor."
          />
          <InfoCard
            icon={Globe}
            label="STACKS NATIVE"
            copy="Built for Stacks Bitcoin L2. Accepts sBTC, STX, and USDCx micropayments."
          />
        </div>
      </div>
    </section>
  )
}
