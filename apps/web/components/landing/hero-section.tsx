'use client'

import { motion } from 'motion/react'
import Link from 'next/link'
import { ArrowRight, Terminal, MessageSquare, Sparkles, Box, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const protocols = [
  { name: 'ALEX', description: 'AMM & Orderbook DEX', color: 'from-blue-500/20 to-cyan-500/20', border: 'border-blue-500/30' },
  { name: 'Velar', description: 'Multi-chain DEX', color: 'from-purple-500/20 to-pink-500/20', border: 'border-purple-500/30' },
  { name: 'BitFlow', description: 'Stable-focused DEX', color: 'from-orange-500/20 to-yellow-500/20', border: 'border-orange-500/30' },
  { name: 'Charisma', description: 'Composable Vaults', color: 'from-green-500/20 to-emerald-500/20', border: 'border-green-500/30' },
  { name: 'Arkadiko', description: 'Lending & USDA', color: 'from-red-500/20 to-orange-500/20', border: 'border-red-500/30' },
  { name: 'Zest', description: 'Bitcoin Capital Markets', color: 'from-indigo-500/20 to-purple-500/20', border: 'border-indigo-500/30' },
  { name: 'Granite', description: 'Multi-collateral Lending', color: 'from-slate-500/20 to-gray-500/20', border: 'border-slate-500/30' },
  { name: 'STX Core', description: 'Stacking & sBTC', color: 'from-yellow-500/20 to-orange-400/20', border: 'border-yellow-500/30' },
]

const conversations = [
  { user: 'Swap 100 STX for sBTC', ai: 'Best rate on ALEX: 0.0042 sBTC. Execute?' },
  { user: "What's the stacking APY?", ai: 'Current PoX cycle: 8.2% APY in BTC rewards' },
  { user: 'Lend 5000 USDA on Arkadiko', ai: 'Rate: 12.5% APY. Collateral needed: 150%' },
]

const statusDots = [
  { label: '144+ tools', color: 'bg-primary' },
  { label: '8 protocols', color: 'bg-[var(--stx-tertiary)]' },
  { label: 'sBTC ready', color: 'bg-[var(--stx-bitcoin)]' },
  { label: 'BTC secured', color: 'bg-green-500' },
]

export function HeroSection() {
  return (
    <section className="relative min-h-[90vh] flex items-center overflow-hidden bg-gradient-to-br from-background via-background to-primary/5">
        {/* Dot grid overlay */}
        <div className="absolute inset-0 bg-dots opacity-30 pointer-events-none" />

        <div className="container mx-auto px-6 py-24 max-w-7xl relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center w-full">

            {/* Left — Content */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              className="space-y-8"
            >
              {/* Badge */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, delay: 0.1 }}
              >
                <Badge
                  variant="outline"
                  className="gap-1.5 border-primary/30 bg-primary/5 text-primary px-3 py-1 text-xs font-medium"
                >
                  <Zap className="h-3 w-3" />
                  First Comprehensive MCP for Bitcoin DeFi
                </Badge>
              </motion.div>

              {/* Headline */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="space-y-2"
              >
                <h1 className="font-mono text-5xl md:text-7xl font-bold leading-[1.05] tracking-tight">
                  Talk to
                  <br />
                  <span className="gradient-text">Bitcoin.</span>
                </h1>
                <p className="text-lg md:text-xl text-muted-foreground max-w-md leading-relaxed">
                  Trade, lend, and stack across the entire Bitcoin DeFi ecosystem — through natural conversation.
                </p>
              </motion.div>

              {/* Terminal preview */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.35 }}
                className="rounded-xl border border-primary/20 bg-card/60 backdrop-blur-sm p-5 space-y-4 shadow-[0_0_30px_rgba(247,147,26,0.08)]"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground border-b border-border pb-3">
                  <Terminal className="h-3.5 w-3.5 text-primary" />
                  <span className="font-mono">stacks-ai-terminal</span>
                  <div className="ml-auto flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
                  </div>
                </div>
                <div className="space-y-3">
                  {conversations.map((conv, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.4, delay: idx * 0.25 + 0.6 }}
                      className="space-y-1"
                    >
                      <div className="flex items-start gap-2">
                        <span className="font-mono text-xs text-primary mt-0.5">$</span>
                        <span className="font-mono text-xs text-foreground">{conv.user}</span>
                      </div>
                      <div className="flex items-start gap-2 ml-3">
                        <MessageSquare className="h-3 w-3 text-[var(--stx-tertiary)] mt-0.5 shrink-0" />
                        <span className="text-xs text-[var(--stx-tertiary)]/80">{conv.ai}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>

              {/* CTAs */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.5 }}
                className="flex flex-col sm:flex-row gap-3"
              >
                <Button
                  asChild
                  size="lg"
                  className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_20px_rgba(247,147,26,0.3)] hover:shadow-[0_0_30px_rgba(247,147,26,0.4)] transition-all"
                >
                  <Link href="/chat">
                    <Terminal className="h-4 w-4" />
                    Launch Terminal
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="gap-2 border-border hover:border-primary/40 hover:bg-primary/5"
                >
                  <Link href="/docs">
                    View Docs
                  </Link>
                </Button>
              </motion.div>

              {/* Status row */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.65 }}
                className="flex flex-wrap items-center gap-4"
              >
                {statusDots.map(({ label, color }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${color} animate-pulse`} />
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                ))}
              </motion.div>
            </motion.div>

            {/* Right — Protocol cards */}
            <motion.div
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="hidden lg:block relative h-[580px]"
            >
              {/* Background glow */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/5 via-transparent to-[var(--stx-secondary)]/5 blur-2xl" />

              {protocols.map((protocol, idx) => {
                const floatY   = idx % 2 === 0 ? [-6, -14, -6] : [-10, -4, -10]
                const floatRot = idx % 3 === 0 ? [-0.8, 0.8, -0.8] : idx % 3 === 1 ? [0.6, -0.6, 0.6] : [0, 0.5, 0]
                const dur      = 3.5 + idx * 0.35
                return (
                  <motion.div
                    key={protocol.name}
                    initial={{ opacity: 0, scale: 0.9, y: 24 }}
                    animate={{
                      opacity: 1,
                      scale: 1,
                      y: floatY,
                      rotate: floatRot,
                    }}
                    transition={{
                      opacity: { duration: 0.45, delay: idx * 0.08 + 0.4 },
                      scale:   { duration: 0.45, delay: idx * 0.08 + 0.4 },
                      y:       { duration: dur, delay: idx * 0.18, repeat: Infinity, ease: 'easeInOut' },
                      rotate:  { duration: dur * 1.1, delay: idx * 0.18, repeat: Infinity, ease: 'easeInOut' },
                    }}
                    whileHover={{ scale: 1.08, rotate: 0, transition: { duration: 0.2 } }}
                    className="absolute cursor-default"
                    style={{
                      left: `${(idx % 3) * 34}%`,
                      top:  `${Math.floor(idx / 3) * 27}%`,
                    }}
                  >
                    <div
                      className={`w-44 rounded-xl border ${protocol.border} bg-gradient-to-br ${protocol.color} p-4 backdrop-blur-sm transition-shadow duration-300 hover:shadow-[0_0_20px_var(--stx-accent-glow)]`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Box className="h-4 w-4 text-primary" />
                        <span className="font-semibold text-sm text-foreground">{protocol.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{protocol.description}</p>
                      <div className="flex items-center gap-1 mt-2 text-xs text-green-400">
                        <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                        <span>Live</span>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </motion.div>
          </div>
        </div>
      </section>
  )
}
