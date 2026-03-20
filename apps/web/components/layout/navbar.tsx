'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Menu, Moon, Sun, X, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WalletButton } from '@/components/x402/WalletButton'
import { useTheme } from '@/components/providers/theme-context'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'

const DOCS_URL = 'https://x402-docs.stacks-ai.app/'

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

  const safeLogoSrc = '/images/x402-icon.svg'

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
        <div className="flex items-center justify-between py-2 lg:grid lg:grid-cols-3">

          {/* Left: Logo */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center gap-2.5">
              {/* Mobile: icon + compact wordmark */}
              <div className="flex lg:hidden items-center gap-2">
                <Image
                  src={safeLogoSrc}
                  alt="x402"
                  width={28}
                  height={23}
                  className="dark:invert"
                />
                <span className="font-mono text-base font-bold tracking-wide text-foreground">
                  x<span className="text-primary">402</span>
                </span>
              </div>
              {/* Desktop: icon + wordmark */}
              <div className="hidden lg:flex items-center gap-2.5">
                <Image
                  src={safeLogoSrc}
                  alt="x402"
                  width={32}
                  height={26}
                  className="dark:invert"
                />
                <span className="font-mono text-lg font-extrabold tracking-wide text-foreground">
                  x<span className="text-primary">402</span>
                </span>
              </div>
            </Link>
          </div>

          {/* Center: nav links (lg desktop only) */}
          <div className="hidden lg:flex justify-center items-center gap-6">
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
            {/* Docs — large desktop only */}
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden lg:flex h-8 items-center gap-1.5 px-2 font-mono text-[13px] tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Documentation"
            >
              <BookOpen className="h-3.5 w-3.5" />
              DOCS
            </a>

            {/* Theme toggle — large desktop only */}
            <div className="hidden lg:flex">
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

            {/* Wallet button — hidden on small mobile, shown from sm up */}
            <div className="hidden sm:block">
              <WalletButton />
            </div>

            {/* Hamburger menu — shown below lg */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden h-8 w-8"
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
            className="lg:hidden border-t border-border bg-background/98 backdrop-blur-sm"
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

              {/* Docs link */}
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 py-2 font-mono tracking-wide text-base text-muted-foreground hover:text-foreground"
              >
                <BookOpen className="h-4 w-4" />
                DOCS
              </a>

              {/* Wallet (visible on smallest screens via mobile menu) */}
              <div className="sm:hidden pt-3 border-t border-border/50">
                <WalletButton />
              </div>

              {/* Theme toggle */}
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
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  )
}
