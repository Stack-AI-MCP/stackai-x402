'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

interface DocCardProps {
  title: string
  description?: string
  href: string
  icon?: React.ReactNode
}

export function DocCard({ title, description, href, icon }: DocCardProps) {
  return (
    <Link href={href} className="doc-card">
      <div className="doc-card-inner">
        <div className="doc-card-header">
          <div className="doc-card-title-row">
            {icon && <div className="doc-card-icon">{icon}</div>}
            <h3 className="doc-card-title">{title}</h3>
          </div>
          <ArrowRight className="doc-card-arrow" />
        </div>
        {description && (
          <p className="doc-card-description">{description}</p>
        )}
      </div>
    </Link>
  )
}

interface DocCardsProps {
  children: React.ReactNode
  cols?: 1 | 2 | 3 | 4
}

export function DocCards({ children, cols = 2 }: DocCardsProps) {
  return (
    <div className="doc-cards" data-cols={cols}>
      {children}
    </div>
  )
}
