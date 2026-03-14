'use client'

import { useState, useEffect } from 'react'
import { Loader2, Plus, X, Copy, Check, ExternalLink } from 'lucide-react'
import { ModelSelector, DEFAULT_MODEL } from '@/components/x402/ModelSelector'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'

interface GatewayTool {
  name: string
  description: string
  price: number
  acceptedTokens: string[]
}

export interface AgentConfig {
  name: string
  systemPrompt: string
  tools: string[]
  starterPrompts: string[]
  model: string
}

interface AgentComposerProps {
  serverId: string
  serverName: string
}

function formatPrice(price: number, acceptedTokens: string[]): string {
  if (price === 0) return 'Free'
  const token = acceptedTokens[0] ?? 'STX'
  const decimals = token === 'sBTC' ? 8 : 6
  return `${(price / Math.pow(10, decimals)).toFixed(decimals)} ${token}`
}

export function AgentComposer({ serverId, serverName }: AgentComposerProps) {
  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set())
  const [starterPrompts, setStarterPrompts] = useState<string[]>([])
  const [newPrompt, setNewPrompt] = useState('')
  const [model, setModel] = useState(DEFAULT_MODEL.id)

  const [tools, setTools] = useState<GatewayTool[]>([])
  const [toolsLoading, setToolsLoading] = useState(true)
  const [toolsError, setToolsError] = useState<string | null>(null)

  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Fetch tools from gateway agent card
  useEffect(() => {
    setToolsLoading(true)
    setToolsError(null)
    setSelectedTools(new Set())

    fetch(
      `${GATEWAY_URL}/.well-known/agent.json?server=${encodeURIComponent(serverId)}`,
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load tools: ${res.status}`)
        const data = await res.json()
        const serverTools: GatewayTool[] = data.tools ?? []
        setTools(serverTools)
        setSelectedTools(new Set(serverTools.map((t) => t.name)))
      })
      .catch((err) => {
        setToolsError(
          err instanceof Error ? err.message : 'Failed to load tools',
        )
      })
      .finally(() => setToolsLoading(false))
  }, [serverId])

  const toggleTool = (toolName: string) => {
    setSelectedTools((prev) => {
      const next = new Set(prev)
      if (next.has(toolName)) next.delete(toolName)
      else next.add(toolName)
      return next
    })
  }

  const addStarterPrompt = () => {
    const trimmed = newPrompt.trim()
    if (!trimmed) return
    setStarterPrompts((prev) => [...prev, trimmed])
    setNewPrompt('')
  }

  const removeStarterPrompt = (prompt: string) => {
    setStarterPrompts((prev) => {
      const idx = prev.indexOf(prompt)
      return idx === -1 ? prev : prev.filter((_, i) => i !== idx)
    })
  }

  const handleSave = () => {
    if (!name.trim() || selectedTools.size === 0) return

    const config: AgentConfig = {
      name: name.trim(),
      systemPrompt: systemPrompt.trim(),
      tools: Array.from(selectedTools),
      starterPrompts,
      model,
    }

    // Unicode-safe base64 encode: JSON → UTF-8 bytes → binary string → base64
    const json = JSON.stringify(config)
    const bytes = new TextEncoder().encode(json)
    const binStr = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
    const encoded = btoa(binStr)
    const url = `${window.location.origin}/chat/${serverId}?agent=${encoded}`
    setGeneratedUrl(url)
  }

  const handleCopy = async () => {
    if (!generatedUrl) return
    await navigator.clipboard.writeText(generatedUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Agent Name */}
      <div>
        <label className="block text-sm font-medium">Agent Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`My ${serverName} Agent`}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* System Prompt */}
      <div>
        <label className="block text-sm font-medium">System Prompt</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={4}
          placeholder="You are a specialized DeFi assistant that helps users swap tokens..."
          className="mt-1 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Tool Selection */}
      <div>
        <label className="block text-sm font-medium">
          Tools ({selectedTools.size} of {tools.length} selected)
        </label>

        {toolsLoading && (
          <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading tools from {serverName}...
          </div>
        )}

        {toolsError && (
          <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {toolsError}
          </div>
        )}

        {!toolsLoading && tools.length > 0 && (
          <div className="mt-2 space-y-1">
            {tools.map((t) => (
              <label
                key={t.name}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  checked={selectedTools.has(t.name)}
                  onChange={() => toggleTool(t.name)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{t.name}</div>
                  {t.description && (
                    <div className="text-xs text-muted-foreground">
                      {t.description}
                    </div>
                  )}
                </div>
                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                  {formatPrice(t.price, t.acceptedTokens)}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Starter Prompts */}
      <div>
        <label className="block text-sm font-medium">Starter Prompts</label>
        <p className="text-xs text-muted-foreground">
          Pre-filled suggestions shown when users open this agent
        </p>

        {starterPrompts.length > 0 && (
          <div className="mt-2 space-y-1">
            {starterPrompts.map((prompt) => (
              <div
                key={prompt}
                className="flex items-center gap-2 rounded-md border border-border p-2"
              >
                <span className="flex-1 text-sm">{prompt}</span>
                <button
                  type="button"
                  onClick={() => removeStarterPrompt(prompt)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addStarterPrompt()
              }
            }}
            placeholder="What is the best swap route for..."
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="button"
            onClick={addStarterPrompt}
            disabled={!newPrompt.trim()}
            className="rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Model Selector */}
      <div>
        <label className="block text-sm font-medium">Default Model</label>
        <div className="mt-1">
          <ModelSelector value={model} onChange={setModel} />
        </div>
      </div>

      {/* Save Button */}
      <button
        type="button"
        onClick={handleSave}
        disabled={!name.trim() || selectedTools.size === 0}
        className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Generate Shareable Link
      </button>

      {/* Generated URL */}
      {generatedUrl && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-green-600">
            <Check className="h-4 w-4" />
            Agent link generated!
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              value={generatedUrl}
              readOnly
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 font-mono text-xs"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          <a
            href={generatedUrl}
            className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Open agent chat <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  )
}
