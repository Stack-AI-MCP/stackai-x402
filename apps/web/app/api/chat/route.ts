import {
  createUIMessageStream,
  JsonToSseTransformStream,
  streamText,
  stepCountIs,
  tool,
  jsonSchema,
  type ToolSet,
} from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3001'

export const maxDuration = 60

interface GatewayTool {
  name: string
  description: string
  price: number
  acceptedTokens: string[]
  inputSchema?: Record<string, unknown>
}

interface AgentCard {
  name: string
  description: string
  tools: GatewayTool[]
  gatewayUrl: string
}

async function fetchAgentCard(serverId: string): Promise<AgentCard> {
  const res = await fetch(
    `${GATEWAY_URL}/.well-known/agent.json?server=${encodeURIComponent(serverId)}`,
    { next: { revalidate: 60 } },
  )
  if (!res.ok) {
    throw new Error(`Failed to load server ${serverId}: ${res.status}`)
  }
  return res.json()
}

function buildTools(agentCard: AgentCard, serverId: string): ToolSet {
  const tools: ToolSet = {}

  for (const t of agentCard.tools) {
    const inputSchema = t.inputSchema
      ? jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0])
      : jsonSchema({ type: 'object' as const, additionalProperties: true })

    tools[t.name] = tool<unknown, unknown>({
      description: t.description || t.name,
      inputSchema,
      execute: async (args: unknown) => {
        const proxyRes = await fetch(`${GATEWAY_URL}/api/v1/proxy/${serverId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: t.name,
            params: args,
          }),
        })

        // 402 = paid tool — extract payment requirements for client-side PaymentCard
        if (proxyRes.status === 402) {
          const paymentHeader = proxyRes.headers.get('payment-required')
          if (paymentHeader) {
            const payment = JSON.parse(
              Buffer.from(paymentHeader, 'base64').toString('utf-8'),
            )
            return {
              __paymentRequired: true,
              toolName: t.name,
              serverId,
              payment,
              args,
            }
          }
        }

        if (!proxyRes.ok) {
          const errBody = await proxyRes.json().catch(() => ({}))
          return { error: errBody.error ?? `Tool call failed (${proxyRes.status})` }
        }

        return proxyRes.json()
      },
    })
  }

  return tools
}

export async function POST(request: Request) {
  const body = await request.json()
  const {
    messages,
    serverId,
    model: modelId,
    systemPrompt: customSystemPrompt,
    toolFilter,
  } = body

  if (!serverId) {
    return new Response(JSON.stringify({ error: 'serverId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: 'messages must be an array' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (customSystemPrompt !== undefined && typeof customSystemPrompt !== 'string') {
    return new Response(
      JSON.stringify({ error: 'systemPrompt must be a string' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Cap system prompt length to prevent abuse
  const safeSystemPrompt = typeof customSystemPrompt === 'string'
    ? customSystemPrompt.slice(0, 4000)
    : undefined

  const openRouterApiKey = process.env.OPENROUTER_API_KEY
  if (!openRouterApiKey) {
    return new Response(
      JSON.stringify({ error: 'OPENROUTER_API_KEY is not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let agentCard: AgentCard
  try {
    agentCard = await fetchAgentCard(serverId)
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Failed to load server',
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const openrouter = createOpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: openRouterApiKey,
  })

  let tools = buildTools(agentCard, serverId)

  // Filter tools to subset specified by agent config (Composer)
  if (Array.isArray(toolFilter) && toolFilter.length > 0) {
    const filtered: ToolSet = {}
    for (const name of toolFilter) {
      if (tools[name]) filtered[name] = tools[name]
    }
    tools = filtered
  }

  const systemPrompt = safeSystemPrompt
    ? `${safeSystemPrompt}\n\nSome tools require payment — if a tool returns a __paymentRequired result, inform the user that payment approval is needed and wait for them to approve or reject.`
    : `You are a helpful assistant with access to the "${agentCard.name}" MCP server. ${agentCard.description ?? ''}\n\nUse the available tools when they can help answer the user's question. Some tools require payment — if a tool returns a __paymentRequired result, inform the user that payment approval is needed and wait for them to approve or reject.`

  const stream = createUIMessageStream({
    execute: ({ writer: dataStream }) => {
      const result = streamText({
        model: openrouter(modelId ?? 'anthropic/claude-sonnet-4'),
        system: systemPrompt,
        messages,
        tools,
        stopWhen: stepCountIs(10),
      })

      result.consumeStream()
      dataStream.merge(result.toUIMessageStream())
    },
    onError: (e) => {
      console.error('x402 chat stream error', e)
      return 'An error occurred while processing your request.'
    },
  })

  return new Response(stream.pipeThrough(new JsonToSseTransformStream()))
}
