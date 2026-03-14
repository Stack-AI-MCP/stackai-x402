'use client'

import { ChevronDown } from 'lucide-react'

export interface ModelOption {
  id: string
  name: string
  provider: string
}

const MODELS: ModelOption[] = [
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'Anthropic' },
  { id: 'anthropic/claude-haiku-4', name: 'Claude Haiku 4', provider: 'Anthropic' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI' },
  { id: 'google/gemini-2.5-flash-preview', name: 'Gemini 2.5 Flash', provider: 'Google' },
]

export const DEFAULT_MODEL = MODELS[0]

interface ModelSelectorProps {
  value: string
  onChange: (modelId: string) => void
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const selected = MODELS.find((m) => m.id === value) ?? DEFAULT_MODEL

  return (
    <div className="relative">
      <select
        value={selected.id}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-md border border-input bg-background py-1.5 pl-3 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {MODELS.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name} ({model.provider})
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}
