'use client'

import { useRef } from 'react'
import { motion, useInView, useMotionValue, useTransform, animate } from 'motion/react'
import { useEffect } from 'react'
import { Zap, Layers, Shield, Lock } from 'lucide-react'

const stats = [
  {
    value: 144,
    suffix: '+',
    label: 'Live Tools',
    description: 'Across all integrated protocols',
    icon: Zap,
    color: 'text-primary',
    bg: 'bg-primary/10',
  },
  {
    value: 8,
    suffix: '+',
    label: 'DeFi Protocols',
    description: 'ALEX, Velar, Arkadiko & more',
    icon: Layers,
    color: 'text-[var(--stx-secondary)]',
    bg: 'bg-[var(--stx-secondary)]/10',
  },
  {
    value: 100,
    suffix: '%',
    label: 'Bitcoin Secured',
    description: 'Every tx settles on Bitcoin L1',
    icon: Shield,
    color: 'text-[var(--stx-tertiary)]',
    bg: 'bg-[var(--stx-tertiary)]/10',
  },
  {
    value: 0,
    suffix: '',
    label: 'Keys Stored',
    description: 'Fully non-custodial design',
    icon: Lock,
    color: 'text-[var(--stx-bitcoin)]',
    bg: 'bg-[var(--stx-bitcoin)]/10',
  },
]

function AnimatedNumber({ value, suffix }: { value: number; suffix: string }) {
  const motionValue = useMotionValue(0)
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-50px' })
  const rounded = useTransform(motionValue, (v) => Math.round(v))

  useEffect(() => {
    if (isInView) {
      animate(motionValue, value, { duration: 1.8, ease: 'easeOut' })
    }
  }, [isInView, motionValue, value])

  return (
    <span ref={ref} className="tabular-nums">
      <motion.span>{rounded}</motion.span>
      {suffix}
    </span>
  )
}

export function StatsSection() {
  const sectionRef = useRef<HTMLElement>(null)

  return (
    <section
      ref={sectionRef}
      className="relative border-y border-border bg-stx-bg-secondary py-20 overflow-hidden"
    >
      {/* Dot grid overlay */}
      <div className="absolute inset-0 bg-dots opacity-20 pointer-events-none" />

      <div className="relative mx-auto max-w-7xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <p className="text-sm font-mono font-medium text-primary uppercase tracking-widest mb-2">
            By the numbers
          </p>
          <h2 className="text-3xl md:text-4xl font-bold">
            Built for Bitcoin developers
          </h2>
        </motion.div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat, idx) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
              viewport={{ once: true }}
              className="group rounded-xl border border-border bg-card/50 p-6 hover:border-primary/30 hover:bg-card transition-all duration-200 card-hover"
            >
              <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl ${stat.bg} mb-4 group-hover:scale-110 transition-transform duration-200`}>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
              <div className={`text-4xl font-bold font-mono ${stat.color} mb-1`}>
                <AnimatedNumber value={stat.value} suffix={stat.suffix} />
              </div>
              <p className="font-semibold text-foreground text-sm">{stat.label}</p>
              <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
