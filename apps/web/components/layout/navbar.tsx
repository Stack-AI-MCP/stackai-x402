'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Menu, Moon, Sun, X, Github, Terminal } from 'lucide-react'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetClose,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { WalletButton } from '@/components/x402/WalletButton'
import { useTheme } from '@/components/providers/theme-context'
import { useState, useEffect } from 'react'

const desktopLinks = [
  { href: '/marketplace',  label: 'BROWSE' },
  { href: '/register',     label: 'MONETIZE' },
  { href: '/analytics',    label: 'ANALYTICS' },
]

const mobileLinks = [
  { href: '/',             label: 'HOME' },
  { href: '/marketplace',  label: 'BROWSE' },
  { href: '/register',     label: 'MONETIZE' },
  { href: '/chat',         label: 'CHAT' },
  { href: '/analytics',    label: 'ANALYTICS' },
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

  // Hydration-safe: default to a neutral state before mount
  const logoSrc = mounted
    ? (isDark ? '/images/logo-light.png' : '/images/logo-dark.png')
    : '/images/logo-dark.png'

  // Fallback: if separate logos don't exist, use stacks.png for both
  const safeLogoSrc = '/images/stacks.png'

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')

  return (
    <nav className="sticky top-0 z-40 w-full border-b transition-colors duration-200 bg-background/95 backdrop-blur border-border">
      <div className="w-full px-4">
        {/* 3-col grid on desktop; flex row on mobile */}
        <div className="flex items-center justify-between py-2 sm:grid sm:grid-cols-3">

          {/* Left: Logo */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center gap-2.5">
              {/* Mobile: just icon */}
              <div className="block sm:hidden">
                <Image
                  src={safeLogoSrc}
                  alt="StacksAI"
                  width={32}
                  height={32}
                  className="rounded-lg"
                />
              </div>
              {/* Desktop: icon + wordmark */}
              <div className="hidden sm:flex items-center gap-2.5">
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
          <div className="hidden sm:flex justify-center items-center gap-6">
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
              href="https://github.com/aibtcdev/stackai-x402"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              aria-label="GitHub"
            >
              <Github className="h-4 w-4" />
            </a>

            {/* Theme toggle — desktop only */}
            <div className="hidden sm:flex">
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
              className="hidden sm:flex gap-1.5 bg-foreground text-background hover:bg-foreground/90 font-mono text-[11px] tracking-wider uppercase rounded-[2px]"
            >
              <Link href="/chat">
                <Terminal className="h-3 w-3" />
                Terminal
              </Link>
            </Button>

            {/* Mobile hamburger */}
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="sm:hidden h-8 w-8"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>

              <SheetContent
                side="right"
                className="p-0 w-screen max-w-none h-screen sm:hidden bg-background [&>button.absolute.right-4.top-4]:hidden"
              >
                {/* Mobile header */}
                <SheetHeader className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2.5" onClick={() => setMenuOpen(false)}>
                      <Image src={safeLogoSrc} alt="StacksAI" width={32} height={32} className="rounded-lg" />
                      <span className="font-mono text-base font-semibold tracking-wider text-foreground">
                        x<span className="text-primary">402</span>
                      </span>
                    </Link>
                    <SheetClose asChild>
                      <Button variant="ghost" size="icon" className="text-foreground" aria-label="Close menu">
                        <X className="h-5 w-5" />
                      </Button>
                    </SheetClose>
                  </div>
                </SheetHeader>

                {/* Mobile nav links */}
                <div className="px-8 pt-6 space-y-7">
                  {mobileLinks.map(({ href, label }) => (
                    <SheetClose key={href} asChild>
                      <Link
                        href={href}
                        className={[
                          'block font-mono tracking-wide text-lg',
                          isActive(href)
                            ? 'text-foreground underline decoration-dotted underline-offset-4'
                            : 'text-muted-foreground hover:text-foreground',
                        ].join(' ')}
                      >
                        {label}
                      </Link>
                    </SheetClose>
                  ))}
                </div>

                {/* Mobile bottom: theme toggle + links */}
                <div className="absolute inset-x-0 bottom-0 p-5">
                  <div className="flex items-center justify-center gap-3">
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
                    <nav className="flex items-center gap-1">
                      <Link href="/docs" className={linkBase} onClick={() => setMenuOpen(false)}>DOCS</Link>
                      <a href="https://github.com/aibtcdev/stacks-ai" target="_blank" rel="noreferrer" className={linkBase}>GITHUB</a>
                    </nav>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>

        </div>
      </div>
    </nav>
  )
}
