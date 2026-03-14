import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateString?: string) {
  if (!dateString) return ""
  return new Date(dateString).toLocaleString()
}

export function formatRelative(dateString?: string) {
  if (!dateString) return ""
  const ms = Date.now() - new Date(dateString).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function formatAddress(address: string) {
  if (!address || address.length < 12) {
    return { start: address, middle: '', end: '' }
  }
  const start = address.slice(0, 6)
  const middle = address.slice(6, -6)
  const end = address.slice(-6)
  return { start, middle, end }
}

export function safeParseNumber(val: unknown): number {
  const n = Number(val)
  return Number.isFinite(n) ? n : 0
}

export function safeToFixed(val: unknown, decimals = 2): string {
  return safeParseNumber(val).toFixed(decimals)
}

export function formatVolume(val: unknown): string {
  const n = safeParseNumber(val)
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`
  return `$${n.toFixed(2)}`
}

export function formatPrice(val: unknown): string {
  const n = safeParseNumber(val)
  if (n === 0) return '$0.00'
  if (n < 0.0001) return `$${n.toExponential(2)}`
  if (n < 1) return `$${n.toFixed(6)}`
  if (n >= 1_000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  return `$${n.toFixed(2)}`
}

export function formatChange(val: unknown): { trend: 'up' | 'down' | 'neutral'; value: string } {
  const n = safeParseNumber(val)
  if (n > 0) return { trend: 'up', value: `+${n.toFixed(2)}%` }
  if (n < 0) return { trend: 'down', value: `${n.toFixed(2)}%` }
  return { trend: 'neutral', value: '0.00%' }
}
