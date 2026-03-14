'use client'

import { motion } from 'motion/react'
import Link from 'next/link'
import { ArrowRight, Shield, Lock, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'

const trustItems = [
  { icon: Shield, label: 'Bitcoin secured' },
  { icon: Lock, label: 'Non-custodial' },
  { icon: Zap, label: 'Open source' },
]

export function CTASection() {
  return (
    <section className="relative py-32 overflow-hidden bg-gradient-to-b from-primary/5 via-background to-background">
      {/* Decorative orbs */}
      <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-96 h-96 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 right-1/4 -translate-y-1/2 w-80 h-80 rounded-full bg-[var(--stx-secondary)]/10 blur-3xl pointer-events-none" />

      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          viewport={{ once: true }}
          className="space-y-8"
        >
          {/* Eyebrow */}
          <span className="inline-block text-xs font-mono font-semibold text-primary uppercase tracking-widest px-3 py-1 rounded-full border border-primary/20 bg-primary/5">
            Ready to start
          </span>

          {/* Headline */}
          <h2 className="font-mono text-4xl md:text-6xl font-bold leading-tight">
            Stop clicking.
            <br />
            <span className="gradient-text">Start talking.</span>
          </h2>

          <p className="text-lg md:text-xl text-muted-foreground max-w-xl mx-auto">
            The entire Bitcoin DeFi ecosystem is waiting. Just ask.
          </p>

          {/* CTA buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              asChild
              size="lg"
              className="gap-2 text-base px-8 py-6 bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_30px_var(--stx-accent-glow)] hover:shadow-[0_0_40px_var(--stx-accent-glow)] transition-all"
            >
              <Link href="/chat">
                Launch Terminal
                <ArrowRight className="h-5 w-5" />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="gap-2 text-base px-8 py-6 border-border hover:border-primary/40 hover:bg-primary/5"
            >
              <Link href="/docs">
                Read the Docs
              </Link>
            </Button>
          </div>

          {/* Trust indicators */}
          <div className="flex items-center justify-center gap-8 flex-wrap pt-4">
            {trustItems.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className="h-4 w-4 text-primary" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
