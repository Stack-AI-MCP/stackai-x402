import { Hono } from 'hono'
import type { AppEnv } from '../app.js'
import type { ServerConfig, IntrospectedTool } from '../services/registration.service.js'

export const agentCardRouter = new Hono<AppEnv>()

agentCardRouter.get('/', async (c) => {
  const serverId = c.req.query('server')
  if (!serverId) {
    return c.json({ error: 'Missing required query param: server', code: 'INVALID_REQUEST' }, 400)
  }

  const redis = c.get('redis')
  const [configJson, toolsJson] = await Promise.all([
    redis.get(`server:${serverId}:config`),
    redis.get(`server:${serverId}:tools`),
  ])

  if (!configJson) {
    return c.json({ error: `Server ${serverId} not found`, code: 'NOT_FOUND' }, 404)
  }

  let config: ServerConfig
  let tools: IntrospectedTool[]
  try {
    config = JSON.parse(configJson) as ServerConfig
    tools = toolsJson ? (JSON.parse(toolsJson) as IntrospectedTool[]) : []
  } catch {
    return c.json({ error: 'Server data is corrupted', code: 'INTERNAL_ERROR' }, 500)
  }

  // Never expose upstreamAuth, ownerKey, or internal fields
  return c.json({
    name: config.name,
    description: config.description,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      price: t.price,
      acceptedTokens: t.acceptedTokens,
    })),
    gatewayUrl: `/api/v1/proxy/${serverId}`,
    version: '1.0',
  })
})
