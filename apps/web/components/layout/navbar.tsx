'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Menu, Moon, Sun, X, Github, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WalletButton } from '@/components/x402/WalletButton'
import { useTheme } from '@/components/providers/theme-context'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'

const desktopLinks = [
  { href: '/marketplace',  label: 'BROWSE' },
  { href: '/agents',       label: 'AGENTS' },
  { href: '/register',     label: 'MONETIZE' },
  { href: '/analytics',    label: 'EXPLORER' },
]

const mobileLinks = [
  { href: '/',             label: 'HOME' },
  { href: '/marketplace',  label: 'BROWSE' },
  { href: '/agents',       label: 'AGENTS' },
  { href: '/register',     label: 'MONETIZE' },
  { href: '/chat',         label: 'CHAT' },
  { href: '/analytics',    label: 'EXPLORER' },
]

const linkBase =
  'h-8 px-2 font-mono text-[13px] tracking-wider text-muted-foreground hover:text-foreground hover:underline hover:decoration-dotted underline-offset-2 transition-colors'
const linkActive = 'text-foreground underline decoration-dotted underline-offset-2'

export function GlobalNavbar() {
  const pathname = usePathname()
  const { isDark, toggleTheme } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  // Close menu on route change
  useEffect(() => { setMenuOpen(false) }, [pathname])

  const safeLogoSrc = '/images/stacks.png'

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="sticky top-0 z-40 w-full border-b transition-colors duration-200 bg-background/95 backdrop-blur border-border"
    >
      <div className="w-full px-4">
        {/* 3-col grid on desktop; flex row on mobile */}
        <div className="flex items-center justify-between py-2 md:grid md:grid-cols-3">

          {/* Left: Logo */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center gap-2.5">
              {/* Mobile: just icon */}
              <div className="block md:hidden">
                <Image
                  src={safeLogoSrc}
                  alt="StacksAI"
                  width={32}
                  height={32}
                  className="rounded-lg"
                />
              </div>
              {/* Desktop: icon + wordmark */}
              <div className="hidden md:flex items-center gap-2.5">
                <Image
                  src={safeLogoSrc}
                  alt="StacksAI"
                  width={28}
                  height={28}
                  className="rounded-lg"
                />
                <span className="font-mono text-sm font-semibold tracking-wider text-foreground">
                  x<span className="text-primary">402</span>
                </span>
              </div>
            </Link>
          </div>

          {/* Center: nav links (desktop only) */}
          <div className="hidden md:flex justify-center items-center gap-6">
            {desktopLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={[linkBase, isActive(href) ? linkActive : ''].join(' ')}
              >
                {label}
              </Link>
            ))}
          </div>

          {/* Right: actions */}
          <div className="flex items-center justify-end gap-1">
            {/* GitHub — desktop only */}
            <a
              href="https://github.com/Stack-AI-MCP/stackai-x402"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              aria-label="GitHub"
            >
              <Github className="h-4 w-4" />
            </a>

            {/* Theme toggle — desktop only */}
            <div className="hidden md:flex">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Toggle theme"
                onClick={toggleTheme}
                className="h-8 w-8 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                {mounted && isDark
                  ? <Sun className="h-4 w-4 text-amber-500" />
                  : <Moon className="h-4 w-4" />
                }
              </Button>
            </div>

            {/* Wallet button */}
            <WalletButton />

            {/* Terminal CTA — desktop only */}
            <Button
              asChild
              size="sm"
              className="hidden md:flex gap-1.5 bg-foreground text-background hover:bg-foreground/90 font-mono text-[11px] tracking-wider uppercase rounded-[2px]"
            >
              <Link href="/chat">
                <Terminal className="h-3 w-3" />
                Terminal
              </Link>
            </Button>

            {/* Mobile hamburger */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-8 w-8"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>

        </div>
      </div>

      {/* Mobile dropdown menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="md:hidden border-t border-border bg-background/98 backdrop-blur-sm"
          >
            <div className="px-6 py-4 space-y-2">
              {mobileLinks.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className={[
                    'block py-2 font-mono tracking-wide text-base',
                    isActive(href)
                      ? 'text-foreground underline decoration-dotted underline-offset-4'
                      : 'text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                >
                  {label}
                </Link>
              ))}

              {/* Terminal CTA */}
              <div className="pt-3 border-t border-border/50">
                <Link href="/chat" onClick={() => setMenuOpen(false)}>
                  <Button
                    size="sm"
                    className="w-full gap-1.5 bg-foreground text-background hover:bg-foreground/90 font-mono text-[11px] tracking-wider uppercase rounded-[2px]"
                  >
                    <Terminal className="h-3 w-3" />
                    Terminal
                  </Button>
                </Link>
              </div>

              {/* Theme + GitHub */}
              <div className="flex items-center justify-center gap-3 pt-3">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Toggle theme"
                  onClick={toggleTheme}
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  {mounted && isDark
                    ? <Sun className="h-5 w-5 text-amber-500" />
                    : <Moon className="h-5 w-5" />
                  }
                </Button>
                <a
                  href="https://github.com/Stack-AI-MCP/stackai-x402"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="GitHub"
                >
                  <Github className="h-5 w-5" />
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  )
}
