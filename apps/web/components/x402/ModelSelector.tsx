'use client'

import { Check, ChevronDown } from 'lucide-react'
import Image from 'next/image'
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

const PROVIDER_LOGOS: Record<string, string> = {
  Anthropic: '/logos/mcp-clients/claude.svg',
  OpenAI:    '/logos/mcp-clients/OpenAI-black-monoblossom.svg',
  Google:    '/logos/mcp-clients/Google_Gemini_icon_2025.svg',
}

function ProviderLogo({ provider, dim }: { provider: string; dim?: boolean }) {
  const src = PROVIDER_LOGOS[provider]
  if (!src) return null
  return (
    <Image
      src={src}
      alt={provider}
      width={16}
      height={16}
      className="object-contain"
      style={{ opacity: dim ? 0.4 : 1 }}
    />
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
