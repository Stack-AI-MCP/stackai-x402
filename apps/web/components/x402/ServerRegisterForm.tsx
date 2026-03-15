'use client'

import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Copy, Check, ChevronDown, Loader2 } from 'lucide-react'
import { useSWRConfig } from 'swr'
import { useX402Wallet } from '@/hooks/use-x402-wallet'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'

const STACKS_ADDRESS_RE = /^S[TPMN][0-9A-Z]{38,64}$/

const TOKEN_OPTIONS = ['STX', 'sBTC', 'USDCx'] as const

const registerSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  recipientAddress: z
    .string()
    .regex(STACKS_ADDRESS_RE, 'Must be a valid Stacks address (SP/ST/SM/SN prefix)'),
  acceptedTokens: z.array(z.enum(TOKEN_OPTIONS)).min(1, 'Select at least one token'),
  toolPricing: z.record(z.string(), z.object({ price: z.number().nonnegative() })).optional(),
  upstreamAuth: z.string().optional(),
  telegramChatId: z.string().optional(),
  webhookUrl: z.string().url('Must be a valid URL').or(z.literal('')).optional(),
})

type RegisterFormValues = z.infer<typeof registerSchema>

interface IntrospectedTool {
  name: string
  description?: string
}

interface RegistrationResult {
  serverId: string
  gatewayUrl: string
  ownerAddress: string
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-2 inline-flex items-center rounded p-1 text-muted-foreground hover:text-foreground"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
    </button>
  )
}

export function ServerRegisterForm({ defaultUrl = '' }: { defaultUrl?: string }) {
  const { address, isConnected } = useX402Wallet()
  const { mutate } = useSWRConfig()

  const [tools, setTools] = useState<IntrospectedTool[]>([])
  const [introspecting, setIntrospecting] = useState(false)
  const [introspectError, setIntrospectError] = useState<string | null>(null)
  const [showOptional, setShowOptional] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<RegistrationResult | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    getValues,
    reset,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      url: defaultUrl,
      name: '',
      description: '',
      recipientAddress: '',
      acceptedTokens: ['STX', 'sBTC', 'USDCx'],
      toolPricing: {},
      upstreamAuth: '',
      telegramChatId: '',
      webhookUrl: '',
    },
  })

  // Auto-fill recipient address from connected wallet
  useEffect(() => {
    if (address) {
      setValue('recipientAddress', address)
    }
  }, [address, setValue])

  const watchedTokens = watch('acceptedTokens')

  const handleTokenToggle = useCallback(
    (token: (typeof TOKEN_OPTIONS)[number]) => {
      const current = getValues('acceptedTokens') ?? []
      const next = current.includes(token)
        ? current.filter((t) => t !== token)
        : [...current, token]
      setValue('acceptedTokens', next as RegisterFormValues['acceptedTokens'], {
        shouldValidate: true,
      })
    },
    [getValues, setValue],
  )

  // Introspect MCP server tools on URL blur
  const handleUrlBlur = useCallback(
    async (e: React.FocusEvent<HTMLInputElement>) => {
      const url = e.target.value.trim()
      if (!url) return

      try {
        new URL(url)
      } catch {
        return // Skip if not a valid URL
      }

      setIntrospecting(true)
      setIntrospectError(null)
      setTools([])

      try {
        const res = await fetch(
          `${GATEWAY_URL}/api/v1/servers/introspect?url=${encodeURIComponent(url)}`,
        )
        if (!res.ok) {
          throw new Error(`Introspection failed (${res.status})`)
        }
        const data = await res.json()
        const discovered: IntrospectedTool[] = data.tools ?? []
        setTools(discovered)

        // Pre-populate tool pricing with 0 for all discovered tools
        const pricing: Record<string, { price: number }> = {}
        for (const tool of discovered) {
          pricing[tool.name] = { price: 0 }
        }
        setValue('toolPricing', pricing)
      } catch (err) {
        setIntrospectError(
          err instanceof Error ? err.message : 'Failed to introspect MCP server',
        )
      } finally {
        setIntrospecting(false)
      }
    },
    [setValue],
  )

  const handleToolPriceChange = useCallback(
    (toolName: string, price: number) => {
      const current = getValues('toolPricing') ?? {}
      setValue('toolPricing', { ...current, [toolName]: { price } })
    },
    [getValues, setValue],
  )

  const onSubmit = useCallback(
    async (data: RegisterFormValues) => {
      setSubmitting(true)
      setSubmitError(null)

      // Clean optional empty strings
      const body = {
        url: data.url,
        name: data.name,
        ...(data.description && { description: data.description }),
        recipientAddress: data.recipientAddress,
        acceptedTokens: data.acceptedTokens,
        ...(data.toolPricing &&
          Object.keys(data.toolPricing).length > 0 && { toolPricing: data.toolPricing }),
        ...(data.upstreamAuth && { upstreamAuth: data.upstreamAuth }),
        ...(data.telegramChatId && { telegramChatId: data.telegramChatId }),
        ...(data.webhookUrl && { webhookUrl: data.webhookUrl }),
      }

      try {
        const res = await fetch(`${GATEWAY_URL}/api/v1/servers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          throw new Error(errData.error ?? `Registration failed (${res.status})`)
        }

        const resultData: RegistrationResult = await res.json()
        setResult(resultData)

        // Revalidate the marketplace server list
        mutate(`${GATEWAY_URL}/api/v1/servers`)
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Registration failed')
      } finally {
        setSubmitting(false)
      }
    },
    [mutate],
  )

  // Success state
  if (result) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="rounded-lg border border-green-500/50 bg-green-500/10 p-6">
          <h2 className="text-lg font-semibold text-green-700 dark:text-green-300">
            Server Registered Successfully
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your MCP server is now available in the marketplace.
          </p>

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Gateway URL</label>
              <div className="flex items-center rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm">
                <span className="flex-1 truncate">{result.gatewayUrl}</span>
                <CopyButton text={result.gatewayUrl} />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Owner Address</label>
              <div className="flex items-center rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm">
                <span className="flex-1 truncate">{result.ownerAddress}</span>
                <CopyButton text={result.ownerAddress} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Your connected wallet address owns this server registration.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setResult(null)
              setTools([])
              setIntrospectError(null)
              reset()
            }}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            Register Another Server
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mx-auto max-w-2xl space-y-6">
      {!isConnected && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          Connect your wallet to auto-fill recipient address and enable registration.
        </div>
      )}

      {/* URL */}
      <div className="space-y-1">
        <label htmlFor="url" className="text-sm font-medium">
          MCP Server URL <span className="text-destructive">*</span>
        </label>
        <input
          id="url"
          type="url"
          placeholder="https://your-mcp-server.example.com"
          {...register('url')}
          onBlur={(e) => {
            register('url').onBlur(e)
            handleUrlBlur(e)
          }}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {errors.url && <p className="text-xs text-destructive">{errors.url.message}</p>}
      </div>

      {/* Name */}
      <div className="space-y-1">
        <label htmlFor="name" className="text-sm font-medium">
          Server Name <span className="text-destructive">*</span>
        </label>
        <input
          id="name"
          type="text"
          placeholder="My MCP Server"
          {...register('name')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      {/* Description */}
      <div className="space-y-1">
        <label htmlFor="description" className="text-sm font-medium">
          Description
        </label>
        <textarea
          id="description"
          placeholder="What does your MCP server do?"
          {...register('description')}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Recipient Address */}
      <div className="space-y-1">
        <label htmlFor="recipientAddress" className="text-sm font-medium">
          Recipient Address <span className="text-destructive">*</span>
        </label>
        <input
          id="recipientAddress"
          type="text"
          placeholder="SP... or ST..."
          {...register('recipientAddress')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {errors.recipientAddress && (
          <p className="text-xs text-destructive">{errors.recipientAddress.message}</p>
        )}
        {isConnected && (
          <p className="text-xs text-muted-foreground">Auto-filled from your connected wallet.</p>
        )}
      </div>

      {/* Accepted Tokens */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          Accepted Tokens <span className="text-destructive">*</span>
        </label>
        <div className="flex gap-3">
          {TOKEN_OPTIONS.map((token) => (
            <label key={token} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={watchedTokens?.includes(token) ?? false}
                onChange={() => handleTokenToggle(token)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <span className="text-sm">{token}</span>
            </label>
          ))}
        </div>
        {errors.acceptedTokens && (
          <p className="text-xs text-destructive">{errors.acceptedTokens.message}</p>
        )}
      </div>

      {/* Introspected Tools / Pricing */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Tool Pricing</label>

        {introspecting && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Discovering tools from MCP server...
          </div>
        )}

        {introspectError && (
          <p className="text-xs text-destructive">{introspectError}</p>
        )}

        {tools.length > 0 && (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium">Tool</th>
                  <th className="px-3 py-2 text-right font-medium">Price (micro-units)</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((tool) => (
                  <tr key={tool.name} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">{tool.name}</div>
                      {tool.description && (
                        <div className="text-xs text-muted-foreground">{tool.description}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={0}
                        onChange={(e) =>
                          handleToolPriceChange(tool.name, Number(e.target.value) || 0)
                        }
                        className="w-24 rounded border border-input bg-background px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!introspecting && tools.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Enter an MCP server URL above to auto-discover tools, or set pricing after
            registration.
          </p>
        )}
      </div>

      {/* Optional Fields */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setShowOptional(!showOptional)}
          className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${showOptional ? 'rotate-180' : ''}`}
          />
          Optional Settings
        </button>

        {showOptional && (
          <div className="space-y-4 rounded-md border border-dashed border-border p-4">
            {/* Upstream Auth */}
            <div className="space-y-1">
              <label htmlFor="upstreamAuth" className="text-sm font-medium">
                Upstream Auth Credentials
              </label>
              <input
                id="upstreamAuth"
                type="password"
                placeholder="Bearer token or API key"
                {...register('upstreamAuth')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground">
                Encrypted at rest. Used by the gateway to authenticate with your MCP server.
              </p>
            </div>

            {/* Telegram Chat ID */}
            <div className="space-y-1">
              <label htmlFor="telegramChatId" className="text-sm font-medium">
                Telegram Chat ID
              </label>
              <input
                id="telegramChatId"
                type="text"
                placeholder="e.g. -1001234567890"
                {...register('telegramChatId')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground">
                Receive payment notifications via Telegram.
              </p>
            </div>

            {/* Webhook URL */}
            <div className="space-y-1">
              <label htmlFor="webhookUrl" className="text-sm font-medium">
                Webhook URL
              </label>
              <input
                id="webhookUrl"
                type="url"
                placeholder="https://your-webhook.example.com"
                {...register('webhookUrl')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {errors.webhookUrl && (
                <p className="text-xs text-destructive">{errors.webhookUrl.message}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Submit Error */}
      {submitError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {submitError}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting || !isConnected}
        className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Registering...
          </span>
        ) : (
          'Register Server'
        )}
      </button>
    </form>
  )
}
