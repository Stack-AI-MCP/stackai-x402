'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { label: 'MARKETPLACE', href: '/marketplace' },
  { label: 'CHAT',        href: '/chat' },
  { label: 'REGISTER',    href: '/register' },
  { label: 'COMPOSER',    href: '/composer' },
  { label: 'ANALYTICS',  href: '/analytics' },
] as const

const linkBase =
  'h-8 px-2 font-mono text-[12px] tracking-wider text-muted-foreground hover:text-foreground hover:underline hover:decoration-dotted underline-offset-4 transition-colors whitespace-nowrap'
const linkActive = 'text-foreground underline decoration-dotted underline-offset-4'

export function TabNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname()

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/')

  if (mobile) {
    return (
      <nav
        className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-2 border-t border-border bg-background px-4"
        role="tablist"
      >
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={[linkBase, isActive(tab.href) ? linkActive : ''].join(' ')}
            role="tab"
            aria-selected={isActive(tab.href)}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    )
  }

  return (
    <nav
      className="flex items-center gap-2 overflow-x-auto scrollbar-hide"
      role="tablist"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={[linkBase, isActive(tab.href) ? linkActive : ''].join(' ')}
          role="tab"
          aria-selected={isActive(tab.href)}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
