/**
 * OpenAPI-to-MCP Converter — Stacks AI
 *
 * Converts any OpenAPI/Swagger spec into MCP (Model Context Protocol) tools
 * so AI agents can interact with REST APIs through the standard MCP interface.
 *
 * Routes:
 *   GET  /          Health / info
 *   GET  /inspect   Inspect OpenAPI spec → tool list (JSON)
 *   ALL  /mcp       MCP Streamable HTTP transport handler
 *
 * Production URL: openapi.stacks-ai.app
 * Default port:   3004
 */

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createMcpHandler } from 'mcp-handler'
import { getToolsFromOpenApi } from 'openapi-mcp-generator'
import type { McpToolDefinition } from 'openapi-mcp-generator'
import type { OpenAPIV3 } from 'openapi-types'
import { z } from 'zod'

const PORT = Number(process.env.PORT ?? 3004)

// ── App ─────────────────────────────────────────────────────────────────────────

const app = new Hono()

app.use('*', cors())

app.onError((err, c) => {
  console.error('[openapi-mcp] error:', err.message)
  return c.json({ error: err.message ?? 'Internal server error' }, 500)
})

// ── Types ───────────────────────────────────────────────────────────────────────

type ToolExt = McpToolDefinition & { baseUrl?: string }

interface ExecParam {
  name: string
  in: string
}

// ── OpenAPI Schema → Zod ────────────────────────────────────────────────────────

function primitiveToZod(type: unknown, prop: Record<string, unknown>): z.ZodTypeAny | null {
  const t = Array.isArray(type) ? type[0] : type
  if (typeof t !== 'string') return null
  switch (t) {
    case 'string':  return z.string()
    case 'number':  return z.number()
    case 'integer': return z.number().int()
    case 'boolean': return z.boolean()
    case 'array': {
      const items = prop.items as Record<string, unknown> | undefined
      const inner = items ? (primitiveToZod(items.type, items) ?? z.unknown()) : z.unknown()
      return z.array(inner)
    }
    case 'object': return z.record(z.string(), z.unknown())
    default: return null
  }
}

function openapiSchemaToZod(inputSchema: unknown): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {}
  if (!inputSchema || typeof inputSchema !== 'object') return shape

  const schema = inputSchema as Record<string, unknown>
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : []

  for (const [key, prop] of Object.entries(props)) {
    if (!prop || typeof prop !== 'object') continue

    // Handle enums
    let field: z.ZodTypeAny | null = null
    if (Array.isArray(prop.enum) && prop.enum.length > 0) {
      const vals = prop.enum as string[]
      if (vals.every((v) => typeof v === 'string') && vals.length > 0) {
        field = z.enum(vals as [string, ...string[]])
      }
    }
    if (!field) field = primitiveToZod(prop.type, prop)
    if (!field) continue

    if (typeof prop.description === 'string') field = field.describe(prop.description)
    shape[key] = required.includes(key) ? field : field.optional()
  }

  return shape
}

/** Ensure path/query/header params from the OpenAPI spec appear in the Zod shape. */
function mergeParametersIntoSchema(
  shape: Record<string, z.ZodTypeAny>,
  params: ReadonlyArray<OpenAPIV3.ParameterObject>,
): void {
  for (const p of params) {
    if (!p?.name || shape[p.name]) continue
    const s = p.schema as OpenAPIV3.SchemaObject | undefined
    let field: z.ZodTypeAny = z.string()
    if (s?.type === 'number' || s?.type === 'integer') field = z.number()
    else if (s?.type === 'boolean') field = z.boolean()
    if (p.description) field = field.describe(p.description)
    shape[p.name] = p.required ? field : field.optional()
  }
}

// ── Tool Executor ───────────────────────────────────────────────────────────────

const SKIP_HEADERS = new Set(['host', 'content-length', 'connection', 'upgrade', 'expect'])

async function executeTool(
  tool: ToolExt,
  params: Record<string, unknown>,
  forwardedHeaders: Record<string, string>,
): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  try {
    let path = tool.pathTemplate
    const query = new URLSearchParams()
    const headers: Record<string, string> = {}
    let body: string | undefined

    // Forward client headers (skip reserved ones)
    for (const [k, v] of Object.entries(forwardedHeaders)) {
      if (!SKIP_HEADERS.has(k.toLowerCase())) headers[k] = v
    }
    if (tool.requestBodyContentType) headers['Content-Type'] = tool.requestBodyContentType

    // Route each execution parameter to the correct HTTP location
    const execParams = ((tool as { executionParameters?: ExecParam[] }).executionParameters
      ?? (tool.parameters as ExecParam[] | undefined)
      ?? []) as ExecParam[]

    for (const ep of execParams) {
      const val = params[ep.name]
      if (val == null) continue
      switch (ep.in) {
        case 'path':
          if (path.includes(`{${ep.name}}`)) {
            path = path.replace(`{${ep.name}}`, encodeURIComponent(String(val)))
          } else {
            query.append(ep.name, String(val))
          }
          break
        case 'query':
          query.append(ep.name, String(val))
          break
        case 'header':
          headers[ep.name] = String(val)
          break
      }
    }

    // Build request body for write methods
    const method = tool.method.toUpperCase()
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      const bodyEntries = Object.entries(params).filter(([, v]) => v != null)
      if (bodyEntries.length > 0) {
        body = tool.requestBodyContentType?.includes('json')
          ? JSON.stringify(Object.fromEntries(bodyEntries))
          : new URLSearchParams(bodyEntries.map(([k, v]) => [k, String(v)])).toString()
      }
    }

    const finalUrl = new URL(path, tool.baseUrl ?? '')
    query.forEach((v, k) => finalUrl.searchParams.append(k, v))

    const res = await fetch(finalUrl.toString(), { method, headers, body })
    const text = await res.text()

    if (!res.ok) {
      return { content: [{ type: 'text', text: `HTTP ${res.status}: ${text}` }], isError: true }
    }

    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { parsed = text }
    return {
      content: [{ type: 'text', text: typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2) }],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return { content: [{ type: 'text', text: `Execution error: ${msg}` }], isError: true }
  }
}

// ── Metadata Extraction ─────────────────────────────────────────────────────────

async function extractMetadata(url: string): Promise<{ name: string; version: string; description?: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`${res.status}`)
    const spec = (await res.json()) as OpenAPIV3.Document

    const name = spec.info?.title
      ?? spec.servers?.[0]?.description?.slice(0, 60)
      ?? (() => { try { return new URL(url).hostname.split('.')[0] } catch { return 'API' } })()
      ?? 'OpenAPI Server'

    return {
      name,
      version: spec.info?.version ?? '0.0.1',
      description: spec.info?.description,
    }
  } catch {
    return { name: 'OpenAPI Server', version: '0.0.1' }
  }
}

// ── MCP Handler Builder ─────────────────────────────────────────────────────────

function buildMcpHandler(specUrl: string) {
  return createMcpHandler(async (server) => {
    const [metadata, rawTools] = await Promise.all([
      extractMetadata(specUrl),
      getToolsFromOpenApi(specUrl, { dereference: true }).catch((err: Error) => {
        // Register a single error tool so the MCP client knows what went wrong
        server.tool('error', `Failed to load spec: ${err.message}`, {}, async () => ({
          content: [{ type: 'text', text: `Error loading OpenAPI spec from ${specUrl}: ${err.message}` }],
          isError: true,
        }))
        return [] as McpToolDefinition[]
      }),
    ])

    console.log(`[openapi-mcp] ${metadata.name}: ${rawTools.length} tools from ${specUrl}`)

    for (const raw of rawTools) {
      const tool = raw as ToolExt
      let shape = openapiSchemaToZod((tool as { inputSchema?: unknown }).inputSchema)

      if (Array.isArray(tool.parameters)) {
        mergeParametersIntoSchema(shape, tool.parameters as OpenAPIV3.ParameterObject[])
      }
      // MCP requires at least one param — add a dummy if empty
      if (Object.keys(shape).length === 0) {
        shape = { _: z.string().optional().describe('No parameters required') }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic schema built at runtime
      server.tool(tool.name, tool.description ?? '', shape as any, async (args: any, extra: any) => {
        // Extract forwarded headers from the MCP request context
        const fwdHeaders: Record<string, string> = {}
        const rawHeaders = (extra?.requestInfo as { headers?: unknown } | undefined)?.headers
        if (rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
          for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) {
            if (typeof v === 'string') fwdHeaders[k] = v
          }
        }
        return executeTool(tool, (args as Record<string, unknown>) ?? {}, fwdHeaders)
      })
    }
  }, {
    serverInfo: { name: 'openapi-mcp', version: '1.0.0' },
  })
}

// ── Routes ──────────────────────────────────────────────────────────────────────

/** Health / info */
app.get('/', (c) =>
  c.json({
    service: 'openapi-mcp',
    description: 'Converts any OpenAPI/Swagger spec into MCP tools',
    docs: 'Paste an OpenAPI spec URL to /inspect or /mcp endpoints',
    endpoints: {
      '/inspect?url=<spec>': 'Returns discovered tools as JSON',
      '/mcp?url=<spec>': 'MCP Streamable HTTP transport',
    },
  }),
)

/** Inspect tools from an OpenAPI spec without MCP transport. */
app.get('/inspect', async (c) => {
  const url = c.req.query('url')
  if (!url) return c.json({ error: 'Missing url parameter' }, 400)

  try {
    const [rawTools, metadata] = await Promise.all([
      getToolsFromOpenApi(url, { dereference: true }),
      extractMetadata(url),
    ])

    // Normalize inputSchema to always be type: "object"
    const tools = rawTools.map((t) => {
      const s = (t as { inputSchema?: unknown }).inputSchema
      const schema =
        s && typeof s === 'object'
          ? (s as Record<string, unknown>).type === 'object'
            ? s
            : { type: 'object', properties: (s as Record<string, unknown>).properties ?? {} }
          : { type: 'object', properties: {} }
      return { ...t, inputSchema: schema }
    })

    return c.json({
      url,
      serverInfo: { name: metadata.name, description: metadata.description ?? '' },
      tools,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to inspect'
    return c.json({ error: msg, url }, 400)
  }
})

/** MCP protocol handler — Streamable HTTP transport. */
app.all('/mcp', async (c) => {
  const url = c.req.query('url')
  if (!url) return c.text('Missing url parameter', 400)

  try {
    return await buildMcpHandler(url)(c.req.raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Handler error'
    return c.json({ error: msg }, 500)
  }
})

// ── Start ───────────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`[openapi-mcp] running on http://0.0.0.0:${info.port}`)
})
