import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils/format'
import { HighlighterText } from './HighlighterText'
import { LucideIcon } from 'lucide-react'

interface InfoCardProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon
  label: string
  copy: React.ReactNode
  ctaText?: string
  ctaHref?: string
}

export function InfoCard({ icon: Icon, label, copy, ctaText, ctaHref, className, ...props }: InfoCardProps) {
  return (
    <div className={cn('flex flex-col gap-8 p-6 rounded-[2px] bg-card', className)} {...props}>
      <div className="inline-flex">
        <HighlighterText className="!text-foreground">
          {Icon && <Icon className="size-3 mr-1.5" />}
          {label}
        </HighlighterText>
      </div>
      <p className="font-medium text-foreground leading-relaxed text-base">{copy}</p>
      {ctaText && ctaHref ? (
        <div className="mt-auto pt-8">
          <Link href={ctaHref} target={ctaHref.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">
            <button className="btn-secondary-tall w-full">{ctaText}</button>
          </Link>
        </div>
      ) : (
        <div className="mt-auto pt-8" />
      )}
    </div>
  )
}
