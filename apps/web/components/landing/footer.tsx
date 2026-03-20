'use client'

import Link from 'next/link'
import Image from 'next/image'
import { Github, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/components/providers/theme-context'

const productLinks = [
  { href: '/marketplace', label: 'MARKETPLACE' },
  { href: '/register',    label: 'MONETIZE' },
  { href: '/analytics',   label: 'ANALYTICS' },
  { href: '/composer',    label: 'COMPOSER' },
  { href: '/chat',        label: 'TERMINAL' },
]

const resourceLinks = [
  { href: 'https://x402-docs.stacks-ai.app',           label: 'DOCUMENTATION', external: true },
  { href: 'https://github.com/Stack-AI-MCP/stackai-x402', label: 'GITHUB', external: true },
  { href: 'https://stacksai.xyz',                      label: 'STACKSAI', external: true },
  { href: 'https://docs.stacks.co',                    label: 'STACKS DOCS', external: true },
]

export function Footer() {
  const year = new Date().getFullYear()
  const { isDark, toggleTheme } = useTheme()

  return (
    <footer className="bg-background border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="col-span-2">
            <Link href="/" className="inline-flex items-center gap-2.5 mb-5">
              <Image
                src="/images/stacks.png"
                alt="StacksAI"
                width={28}
                height={28}
                className="rounded-lg"
              />
              <span className="font-mono text-sm font-semibold tracking-wider text-foreground">
                x<span className="text-primary">402</span>
              </span>
            </Link>
            <p className="text-sm text-muted-foreground max-w-xs mb-6 leading-relaxed">
              The first no-code x402 payment gateway for MCP servers on Stacks Bitcoin L2. Accept sBTC, STX, and USDCx micropayments.
            </p>
            <div className="flex items-center gap-3">
              <a
                href="https://github.com/Stack-AI-MCP/stackai-x402"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center w-8 h-8 border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                aria-label="GitHub"
              >
                <Github className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          {/* Product */}
          <div>
            <h3 className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-foreground mb-5">
              Product
            </h3>
            <ul className="space-y-3">
              {productLinks.map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="text-[11px] font-mono tracking-wide text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-foreground mb-5">
              Resources
            </h3>
            <ul className="space-y-3">
              {resourceLinks.map(({ href, label, external }) => (
                <li key={href}>
                  {external ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-mono tracking-wide text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {label}
                    </a>
                  ) : (
                    <Link
                      href={href}
                      className="text-[11px] font-mono tracking-wide text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-[11px] font-mono text-muted-foreground">
            &copy; {year} StacksAI — Built for Stacks Vibe Hackathon 2026
          </p>
          {/* Theme toggle — matches Cronos402 footer */}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={toggleTheme}
            className="h-8 w-8 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            {isDark
              ? <Sun className="h-4 w-4 text-amber-500" />
              : <Moon className="h-4 w-4" />
            }
          </Button>
        </div>
      </div>
    </footer>
  )
}
