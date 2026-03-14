'use client'

import { motion } from 'motion/react'
import {
  MessageSquare,
  Layers,
  Shield,
  Lock,
  TrendingUp,
  Zap,
} from 'lucide-react'

type ColorVariant = 'accent' | 'secondary' | 'tertiary'

const features: {
  icon: React.FC<{ className?: string }>
  title: string
  description: string
  variant: ColorVariant
}[] = [
  {
    icon: MessageSquare,
    title: 'Natural Language DeFi',
    description:
      'No more clicking through complex interfaces. Just type what you want — swap, lend, stack, bridge — in plain English.',
    variant: 'accent',
  },
  {
    icon: Layers,
    title: '8+ Protocols, One Interface',
    description:
      'ALEX, Velar, Arkadiko, BitFlow, Zest, Granite, Charisma, STX Core — all accessible through a single conversation.',
    variant: 'secondary',
  },
  {
    icon: Shield,
    title: 'Bitcoin-Level Security',
    description:
      'Every transaction settles on Bitcoin through Stacks\' Proof-of-Transfer consensus. Real Bitcoin finality, not a sidechain.',
    variant: 'tertiary',
  },
  {
    icon: Lock,
    title: 'Non-Custodial',
    description:
      'We never hold your keys or tokens. Connect Leather or Xverse, review every transaction before signing.',
    variant: 'accent',
  },
  {
    icon: TrendingUp,
    title: 'Smart Route Optimization',
    description:
      'AI automatically compares rates across DEXes, finds optimal collateral ratios, and calculates the best yield strategies.',
    variant: 'secondary',
  },
  {
    icon: Zap,
    title: 'Open MCP Protocol',
    description:
      'Built on Model Context Protocol. Any Stacks protocol can integrate their tools — composable, permissionless, extensible.',
    variant: 'tertiary',
  },
]

const variantStyles: Record<ColorVariant, { icon: string; iconBg: string; border: string; glow: string }> = {
  accent: {
    icon: 'text-primary',
    iconBg: 'bg-primary/10',
    border: 'hover:border-primary/40',
    glow: 'hover:shadow-[0_0_20px_var(--stx-accent-glow)]',
  },
  secondary: {
    icon: 'text-[var(--stx-secondary)]',
    iconBg: 'bg-[var(--stx-secondary)]/10',
    border: 'hover:border-[var(--stx-secondary)]/40',
    glow: 'hover:shadow-[0_0_20px_rgba(124,58,237,0.15)]',
  },
  tertiary: {
    icon: 'text-[var(--stx-tertiary)]',
    iconBg: 'bg-[var(--stx-tertiary)]/10',
    border: 'hover:border-[var(--stx-tertiary)]/40',
    glow: 'hover:shadow-[0_0_20px_rgba(8,145,178,0.15)]',
  },
}

export function FeaturesSection() {
  return (
    <section className="py-28 bg-background">
      <div className="mx-auto max-w-7xl px-6">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          className="text-center mb-16 max-w-2xl mx-auto"
        >
          <span className="inline-block text-xs font-mono font-semibold text-primary uppercase tracking-widest mb-3 px-3 py-1 rounded-full border border-primary/20 bg-primary/5">
            Capabilities
          </span>
          <h2 className="text-4xl md:text-5xl font-bold mt-4 mb-4">
            Everything Bitcoin DeFi.
            <br />
            <span className="gradient-text">Zero complexity.</span>
          </h2>
          <p className="text-muted-foreground text-lg">
            144+ tools across 8 protocols, accessible through natural conversation.
          </p>
        </motion.div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, idx) => {
            const styles = variantStyles[feature.variant]
            return (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: idx * 0.08 }}
                viewport={{ once: true }}
                className={[
                  'group rounded-xl border border-border bg-card/40 p-6',
                  'hover:bg-card/70 transition-all duration-300',
                  'card-hover',
                  styles.border,
                  styles.glow,
                ].join(' ')}
              >
                <div className={`inline-flex items-center justify-center w-14 h-14 rounded-xl ${styles.iconBg} mb-5 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-200`}>
                  <feature.icon className={`h-6 w-6 ${styles.icon}`} />
                </div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
