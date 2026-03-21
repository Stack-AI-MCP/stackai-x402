import { NextRequest, NextResponse } from 'next/server'

/**
 * Inspects an OpenAPI/Swagger spec URL and extracts tool definitions.
 * Returns tools in the same shape as the gateway introspect endpoint.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`Failed to fetch spec (${res.status})`)

    const spec = (await res.json()) as {
      info?: { title?: string; description?: string }
      paths?: Record<string, Record<string, { operationId?: string; summary?: string; description?: string }>>
    }

    const tools: { name: string; description?: string }[] = []
    const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])
    const paths = spec.paths ?? {}

    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!httpMethods.has(method) || !operation || typeof operation !== 'object') continue
        const name =
          operation.operationId ??
          `${method}_${path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`
        tools.push({
          name,
          description: operation.summary ?? operation.description ?? `${method.toUpperCase()} ${path}`,
        })
      }
    }

    const serverInfo = {
      name: spec.info?.title ?? 'OpenAPI Server',
      description: spec.info?.description ?? '',
    }

    return NextResponse.json({ tools, serverInfo })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to inspect OpenAPI spec'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
