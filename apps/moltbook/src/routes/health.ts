import { Hono } from 'hono'
import type { HeartbeatEngine } from '../scheduler/heartbeat-engine.js'

export function healthRoutes(engine: HeartbeatEngine): Hono {
  const app = new Hono()

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      service: 'stackai-moltbook',
      activeAgents: engine.activeCount,
      timestamp: new Date().toISOString(),
    })
  })

  return app
}
