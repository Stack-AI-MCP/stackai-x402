"use client"

import { RefreshCcw, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils/format"

type ServerDetails = {
  deploymentRef?: string
  license?: string
  isLocal?: boolean
  publishedAt?: string
  repo?: string
  homepage?: string
}

function DetailRow({ label, value, href, isLast }: { label: string; value?: string | boolean; href?: string; isLast?: boolean }) {
  const display = typeof value === "boolean" ? (value ? "Yes" : "No") : (value || "-")
  const displayUppercase = typeof display === "string" ? display.toUpperCase() : display
  return (
    <div className={cn("flex items-center justify-between py-2", isLast && "pb-0")}>
      <span className="text-xs tracking-wider text-muted-foreground font-mono uppercase">{label}</span>
      {href && value ? (
        <a href={href} target="_blank" rel="noreferrer" className="text-xs tracking-wider font-mono underline uppercase text-primary hover:text-primary/80 transition-colors">
          {displayUppercase}
        </a>
      ) : (
        <span className="text-xs tracking-wider font-mono text-foreground uppercase">{displayUppercase}</span>
      )}
    </div>
  )
}

export function ServerDetailsCard({ 
  details, 
  onRefresh, 
  isRefreshing = false 
}: { 
  details: ServerDetails
  onRefresh?: () => void
  isRefreshing?: boolean
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground uppercase font-mono tracking-wider">DETAILS</span>
        {onRefresh && (
          <button 
            type="button"
            className={cn(
              "inline-flex items-center justify-center font-mono text-xs uppercase font-medium tracking-wide bg-muted text-muted-foreground size-7 rounded-md transition-all",
              isRefreshing ? "opacity-50 cursor-not-allowed" : "hover:text-foreground hover:bg-muted/80"
            )}
            onClick={isRefreshing ? undefined : onRefresh}
          >
            {isRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
      <div className="divide-y divide-border/50">
        <DetailRow label="Deployed from" value={details.deploymentRef} />
        <DetailRow label="License" value={details.license} />
        <DetailRow label="Local" value={details.isLocal} />
        <DetailRow label="Published" value={details.publishedAt} />
        <DetailRow label="Source Code" value={details.repo ? "Open" : undefined} href={details.repo} />
        <DetailRow label="Homepage" value={details.homepage ? details.homepage : undefined} href={details.homepage} isLast />
      </div>
    </div>
  )
}
