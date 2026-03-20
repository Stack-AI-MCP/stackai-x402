import { Hono } from 'hono'
import { healthRoutes } from './routes/health.js'
import { agentRoutes } from './routes/agents.js'
import { eventRoutes } from './routes/events.js'
import type { AgentStore } from './state/agent-store.js'
import type { EngagementTracker } from './state/engagement-tracker.js'
import type { HeartbeatEngine } from './scheduler/heartbeat-engine.js'
import type { ContentGenerator } from './ai/types.js'

export function createApp(deps: {
  agentStore: AgentStore
  tracker: EngagementTracker
  engine: HeartbeatEngine
  contentGenerator: ContentGenerator
  serviceSecret: string
}): Hono {
  const app = new Hono()

  // Auth middleware — all routes except /health require SERVICE_SECRET
  app.use('*', async (c, next) => {
    if (c.req.path === '/health') return next()

    const auth = c.req.header('Authorization')
    if (!auth || auth !== `Bearer ${deps.serviceSecret}`) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    return next()
  })

  // Mount routes
  app.route('/', healthRoutes(deps.engine))
  app.route('/', agentRoutes(deps.agentStore, deps.tracker, deps.engine))
  app.route('/', eventRoutes(deps.agentStore, deps.contentGenerator))

  return app
}
