'use client'

import { Check, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface ModelOption {
  id: string
  name: string
  short: string
  provider: string
}

const MODELS: ModelOption[] = [
  { id: 'anthropic/claude-sonnet-4',       name: 'Claude Sonnet 4',  short: 'Sonnet 4',   provider: 'Anthropic' },
  { id: 'openai/gpt-4o',                   name: 'GPT-4o',           short: 'GPT-4o',     provider: 'OpenAI' },
  { id: 'openai/gpt-4o-mini',              name: 'GPT-4o Mini',      short: '4o Mini',    provider: 'OpenAI' },
  { id: 'google/gemini-2.5-flash-preview', name: 'Gemini 2.5 Flash', short: 'Gemini 2.5', provider: 'Google' },
]

export const DEFAULT_MODEL = MODELS[0]

function ProviderLogo({ provider, dim }: { provider: string; dim?: boolean }) {
  const opacity = dim ? 0.4 : 1
  if (provider === 'Anthropic') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-label="Anthropic" style={{ opacity }}>
        <path d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-3.654 0h-3.603L0 20h3.603l6.57-16.48z" fill="#CC785C" />
      </svg>
    )
  }
  if (provider === 'OpenAI') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-label="OpenAI" style={{ opacity }}>
        <path fill="#10A37F" d="M22.28 9.59a5.55 5.55 0 00-.48-4.57 5.62 5.62 0 00-6.06-2.7 5.55 5.55 0 00-4.18-1.87 5.62 5.62 0 00-5.36 3.9 5.55 5.55 0 00-3.71 2.68 5.63 5.63 0 00.69 6.6 5.55 5.55 0 00.48 4.56 5.62 5.62 0 006.06 2.7 5.55 5.55 0 004.18 1.87 5.62 5.62 0 005.37-3.9 5.55 5.55 0 003.7-2.68 5.63 5.63 0 00-.69-6.59zm-8.38 11.73a4.16 4.16 0 01-2.67-.97l.13-.08 4.44-2.56a.74.74 0 00.37-.64v-6.25l1.88 1.08v4.93a4.17 4.17 0 01-4.15 4.49zm-8.93-3.83a4.16 4.16 0 01-.5-2.8l.14.08 4.43 2.56a.74.74 0 00.74 0l5.42-3.13v2.17l-4.5 2.6a4.17 4.17 0 01-5.73-1.48zm-1.16-9.67a4.15 4.15 0 012.17-1.83v5.25a.74.74 0 00.37.64l5.41 3.12-1.88 1.09-4.49-2.6a4.17 4.17 0 01-1.58-5.67zm13.86 3.58l-5.42-3.13 1.88-1.08 4.5 2.59a4.16 4.16 0 01-.64 7.5v-5.25a.74.74 0 00-.32-.63zm1.87-2.82l-.13-.08-4.44-2.56a.74.74 0 00-.74 0l-5.42 3.13V7.87l4.5-2.6a4.17 4.17 0 016.23 3.71zm-11.77 3.87l-1.88-1.09V6.48a4.17 4.17 0 016.83-3.2l-.13.08-4.44 2.57a.74.74 0 00-.37.63v.01l-.01 6.27zm1.02-2.2L12 9.22l2.21 1.28v2.55L12 14.33l-2.21-1.28v-2.55z" />
      </svg>
    )
  }
  // Google
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-label="Google" style={{ opacity }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

interface ModelSelectorProps {
  value: string
  onChange: (modelId: string) => void
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const selected = MODELS.find((m) => m.id === value) ?? DEFAULT_MODEL

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-1.5 text-sm hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary transition-colors">
          <ProviderLogo provider={selected.provider} />
          <span className="text-sm font-medium">{selected.short}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="rounded-xl border border-border bg-popover p-1 min-w-[240px]"
        style={{ boxShadow: 'var(--shadow-glow-lg)' }}
      >
        {MODELS.map((model) => (
          <DropdownMenuItem
            key={model.id}
            onSelect={() => onChange(model.id)}
            className="flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer"
          >
            <ProviderLogo provider={model.provider} />
            <div className="flex-1">
              <div className="text-sm font-medium">{model.name}</div>
              <div className="text-xs text-muted-foreground">{model.provider}</div>
            </div>
            {model.id === value && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
