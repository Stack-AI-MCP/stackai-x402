'use client'

import { useState } from 'react'
import { Check, Copy, ChevronDown, ExternalLink, Shield } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils/format'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'

interface ConnectPanelProps {
  serverId: string
  serverName: string
}

interface ClientDescriptor {
  id: string
  name: string
  logo: string
  deepLink?: (name: string, url: string) => string
  command?: (name: string, url: string) => string
  jsonConfig?: (name: string, url: string) => string
  configPath?: string
}

const clients: ClientDescriptor[] = [
  {
    id: 'cursor',
    name: 'Cursor',
    logo: '/logos/mcp-clients/cursor-cube.svg',
    deepLink: (name, url) => {
      const encoded = btoa(JSON.stringify({ url }))
      const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
      return `cursor://anysphere.cursor-deeplink/mcp/install?name=${safeName}&config=${encoded}`
    },
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    logo: '/logos/mcp-clients/claude.svg',
    command: (name, url) => {
      const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
      return `claude mcp add --transport http ${safeName} "${url}"`
    },
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    logo: '/logos/mcp-clients/claude.svg',
    configPath: '~/Library/Application Support/Claude/claude_desktop_config.json',
    jsonConfig: (name, url) => {
      const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
      return JSON.stringify({ mcpServers: { [safeName]: { url } } }, null, 2)
    },
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    logo: '/logos/mcp-clients/OpenAI-black-monoblossom.svg',
    configPath: 'Settings > Connectors > Create',
  },
  {
    id: 'zed',
    name: 'Zed',
    logo: '/logos/mcp-clients/zed-logo.svg',
    configPath: '~/.config/zed/settings.json',
    jsonConfig: (name, url) => {
      const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
      return JSON.stringify({ context_servers: { [safeName]: { settings: { url } } } }, null, 2)
    },
  },
]

function CopyButton({ text, label, variant = 'icon' }: { text: string; label?: string; variant?: 'icon' | 'button' }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (variant === 'icon') {
    return (
      <button
        onClick={handleCopy}
        className="inline-flex items-center justify-center h-6 w-6 rounded bg-muted text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Copy"
      >
        {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
      </button>
    )
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
      {label ?? (copied ? 'Copied' : 'Copy')}
    </button>
  )
}

function ClientInstructions({ client, gatewayUrl, serverName }: { client: ClientDescriptor; gatewayUrl: string; serverName: string }) {
  // Deep link — one-click install button
  if (client.deepLink) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Connect this server to {client.name} with one click.
        </p>
        <a
          href={client.deepLink(serverName, gatewayUrl)}
          className="flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          One-Click Install
        </a>
      </div>
    )
  }

  // CLI command
  if (client.command) {
    const cmd = client.command(serverName, gatewayUrl)
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Run this command in your terminal:
        </p>
        <div className="relative rounded-md bg-muted p-3 pr-10 overflow-x-auto">
          <pre className="font-mono text-xs whitespace-pre text-foreground">
            <span className="text-muted-foreground select-none">$ </span>{cmd}
          </pre>
          <div className="absolute top-2 right-2">
            <CopyButton text={cmd} />
          </div>
        </div>
      </div>
    )
  }

  // JSON config
  if (client.jsonConfig) {
    const config = client.jsonConfig(serverName, gatewayUrl)
    return (
      <div className="space-y-3">
        {client.configPath && (
          <p className="text-sm text-muted-foreground">
            Add to <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{client.configPath}</code>:
          </p>
        )}
        <div className="relative rounded-md bg-muted p-3 pr-10 overflow-x-auto">
          <pre className="font-mono text-xs whitespace-pre text-foreground">{config}</pre>
          <div className="absolute top-2 right-2">
            <CopyButton text={config} />
          </div>
        </div>
      </div>
    )
  }

  // Steps-based (ChatGPT etc.)
  if (client.configPath) {
    return (
      <div className="space-y-3">
        <ol className="space-y-2 text-sm">
          <li><span className="font-medium">1.</span> Go to <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{client.configPath}</code></li>
          <li><span className="font-medium">2.</span> Paste the connection URL below:</li>
        </ol>
        <div className="relative rounded-md bg-muted p-3 pr-10 overflow-x-auto">
          <code className="font-mono text-xs whitespace-nowrap text-foreground">{gatewayUrl}</code>
          <div className="absolute top-2 right-2">
            <CopyButton text={gatewayUrl} />
          </div>
        </div>
      </div>
    )
  }

  return <p className="text-sm text-muted-foreground">No instructions available.</p>
}

export function ConnectPanel({ serverId, serverName }: ConnectPanelProps) {
  const [selectedId, setSelectedId] = useState('cursor')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const gatewayUrl = `${GATEWAY_URL}/mcp?id=${serverId}`
  const selected = clients.find(c => c.id === selectedId)!

  return (
    <div className="space-y-4">
      {/* Connection URL */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Connection URL</span>
          <CopyButton text={gatewayUrl} />
        </div>
        <div className="rounded-md bg-muted p-3 overflow-x-auto">
          <code className="font-mono text-xs whitespace-nowrap text-foreground">{gatewayUrl}</code>
        </div>
      </div>

      {/* Integrate */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-4">
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Connect to Client</span>

        {/* Client Selector — dropdown with logos */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className={cn(
              'flex w-full items-center justify-between rounded-lg border px-3 py-2.5 transition-colors',
              dropdownOpen ? 'border-primary' : 'border-border hover:border-primary/50'
            )}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded bg-muted p-1">
                <Image src={selected.logo} alt={selected.name} width={20} height={20} className="dark:invert" />
              </div>
              <span className="text-sm font-medium">{selected.name}</span>
            </div>
            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', dropdownOpen && 'rotate-180')} />
          </button>

          {dropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 z-10 rounded-lg border border-border bg-background shadow-lg overflow-hidden">
              {clients.map((client) => (
                <button
                  key={client.id}
                  onClick={() => { setSelectedId(client.id); setDropdownOpen(false) }}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors',
                    selectedId === client.id && 'bg-muted/60'
                  )}
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded bg-muted p-1">
                    <Image src={client.logo} alt={client.name} width={20} height={20} className="dark:invert" />
                  </div>
                  <span className="text-sm font-medium">{client.name}</span>
                  {selectedId === client.id && <Check className="h-4 w-4 text-primary ml-auto" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected Client Instructions */}
        <ClientInstructions client={selected} gatewayUrl={gatewayUrl} serverName={serverName} />
      </div>

      {/* x402 Note */}
      <div className="flex gap-3 rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
        <Shield className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700/80 dark:text-amber-400/70 leading-relaxed">
          Paid tools require <strong>x402 payment headers</strong>. Use our{' '}
          <a href={`/chat/${serverId}`} className="underline font-medium">web chat</a>{' '}
          for seamless payment integration, or the SDK for programmatic access.
        </p>
      </div>
    </div>
  )
}
