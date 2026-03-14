'use client'

import { motion } from 'motion/react'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'

const MCP_CLIENTS = [
  { name: 'Claude',    src: '/logos/mcp-clients/claude.svg',                          bg: '#D97757' },
  { name: 'Cursor',    src: '/logos/mcp-clients/cursor-cube.svg',                     bg: '#F6F6F2' },
  { name: 'ChatGPT',   src: '/logos/mcp-clients/OpenAI-black-monoblossom.svg',        bg: '#FFFFFF' },
  { name: 'DeepSeek',  src: '/logos/mcp-clients/DeepSeek-icon.svg',                  bg: '#FFFFFF' },
  { name: 'Gemini',    src: '/logos/mcp-clients/Google_Gemini_icon_2025.svg',         bg: '#FFFFFF' },
  { name: 'Grok',      src: '/logos/mcp-clients/Grok_Logomark_Light.svg',             bg: '#000000' },
  { name: 'Replicate', src: '/logos/mcp-clients/replicate.svg',                      bg: '#D83D23' },
]

export function Hero3D() {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-12 sm:py-20 lg:py-28">
      <div className="flex flex-col lg:grid lg:grid-cols-2 gap-10 lg:gap-16 lg:items-center">
        {/* Left: Content */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col gap-5 max-w-xl"
        >
          <div className="inline-flex items-center gap-2 self-start px-3 py-1 bg-muted rounded-[2px] text-[11px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            First x402 MCP Gateway on Stacks
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold font-host text-foreground leading-tight">
            Developers can&apos;t monetize MCP servers.{' '}
            <span className="text-muted-foreground font-normal">
              AI agents can&apos;t pay for premium tools.
            </span>
          </h1>

          <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
            First no-code x402 payment gateway for MCP servers on Stacks Bitcoin L2.
            Paste, price, share. Start earning in 3 minutes.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 pt-2">
            <Link href="/marketplace" className="flex-1 sm:flex-none">
              <button className="btn-primary-tall w-full sm:min-w-[200px] flex items-center justify-center gap-2">
                BROWSE SERVERS
                <ArrowRight className="h-4 w-4" />
              </button>
            </Link>
            <Link href="/register" className="flex-1 sm:flex-none">
              <button className="btn-secondary-tall w-full sm:min-w-[200px]">
                MONETIZE SERVERS
              </button>
            </Link>
          </div>
        </motion.div>

        {/* Right: MCP client logo grid */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="grid grid-cols-4 gap-3 lg:gap-4"
        >
          {MCP_CLIENTS.map((client, i) => (
            <motion.div
              key={client.name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.1 + i * 0.05 }}
              className="flex flex-col items-center gap-2"
            >
              <div
                className="flex items-center justify-center rounded-2xl w-16 h-16 border border-border/50 shadow-sm"
                style={{ backgroundColor: client.bg }}
              >
                <Image
                  src={client.src}
                  alt={client.name}
                  width={36}
                  height={36}
                  className="object-contain"
                />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground">{client.name}</span>
            </motion.div>
          ))}
          {/* Stacks / sBTC pill to fill last cell */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.45 }}
            className="flex flex-col items-center gap-2"
          >
            <div className="flex items-center justify-center rounded-2xl w-16 h-16 border border-border/50 bg-card shadow-sm">
              <span className="text-2xl">₿</span>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground">sBTC</span>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

const ECOSYSTEM_ITEMS = [
  'Stacks', 'Bitcoin', 'sBTC', 'STX', 'USDCx', 'x402', 'Claude', 'Cursor',
  'ChatGPT', 'DeepSeek', 'Gemini', 'Grok', 'Replicate', 'Leather', 'Xverse', 'aibtcdev',
]

export function SupportedBySection() {
  const items = [...ECOSYSTEM_ITEMS, ...ECOSYSTEM_ITEMS]
  return (
    <div className="py-10 border-y border-border/50 overflow-hidden">
      <p className="text-center text-[10px] font-mono font-bold uppercase tracking-[0.35em] text-muted-foreground mb-7">
        POWERED BY THE ECOSYSTEM
      </p>
      <div className="relative">
        <div className="flex gap-10 animate-scroll-carousel" style={{ width: 'max-content' }}>
          {items.map((name, i) => (
            <div
              key={`${name}-${i}`}
              className="shrink-0 flex items-center gap-2 text-sm font-mono font-bold tracking-wider text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              <span className="h-1 w-1 rounded-full bg-primary/50" />
              {name.toUpperCase()}
            </div>
          ))}
        </div>
        <div className="absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-background to-transparent pointer-events-none" />
        <div className="absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-background to-transparent pointer-events-none" />
      </div>
    </div>
  )
}
