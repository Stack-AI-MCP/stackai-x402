'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils/format'

const faqs = [
  {
    q: 'What is x402?',
    a: 'x402 is an open payment protocol built on the HTTP 402 status code. It enables AI agents and MCP clients to automatically pay for tools and APIs using on-chain micropayments — no subscription, no API key, pay only for what you use.',
  },
  {
    q: 'Which tokens are supported?',
    a: 'The gateway supports STX (Stacks), sBTC (wrapped Bitcoin on Stacks), and USDCx (bridged USDC on Stacks). Server operators choose which tokens they accept when registering.',
  },
  {
    q: 'How do I monetize my MCP server?',
    a: 'Register your MCP server URL on the Register page, set per-tool pricing, and provide your Stacks recipient address. The gateway wraps your server transparently — no code changes required.',
  },
  {
    q: 'How do clients pay?',
    a: 'When a tool call requires payment, the gateway returns a 402 with payment instructions. The client (Leather/Xverse wallet or an x402-aware SDK) signs and submits the payment, then the gateway forwards the call.',
  },
  {
    q: 'Is this non-custodial?',
    a: 'Yes. Payments go directly from the caller to your Stacks address on-chain. The gateway never holds funds.',
  },
  {
    q: 'What is the protocol fee?',
    a: 'A 1% protocol fee is applied to each paid tool call. There are no setup fees, monthly fees, or minimum volumes.',
  },
]

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-5 text-left gap-4"
      >
        <span className="text-sm font-mono font-semibold tracking-wide">{q}</span>
        <ChevronDown
          className={cn('h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open && (
        <p className="pb-5 text-sm text-muted-foreground leading-relaxed">{a}</p>
      )}
    </div>
  )
}

export function FAQSection() {
  return (
    <section className="py-24 max-w-3xl mx-auto">
      <div className="text-center mb-12 space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-primary">FAQ</p>
        <h2 className="text-3xl font-extrabold">Common questions</h2>
      </div>
      <div>
        {faqs.map((item) => (
          <FAQItem key={item.q} {...item} />
        ))}
      </div>
    </section>
  )
}
