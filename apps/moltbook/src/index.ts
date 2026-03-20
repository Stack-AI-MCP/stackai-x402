import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { z } from 'zod'
import { loadConfig } from './config.js'
import { createApp } from './server.js'
import { AgentStore } from './state/agent-store.js'
import { EngagementTracker } from './state/engagement-tracker.js'
import { HeartbeatEngine } from './scheduler/heartbeat-engine.js'
import { handleErrorAlert } from './events/event-handler.js'
import { createContentGenerator } from './ai/factory.js'
import { RegistrationConsumer } from './queue/registration-consumer.js'
import { logger, errCtx } from './logger.js'

const log = logger.child('main')

const ErrorAlertSchema = z.object({
  serverId: z.string().min(1),
  agentId: z.string().min(1),
  errorRate: z.number().min(0).max(1),
  timestamp: z.number(),
})

const config = loadConfig()

// Redis connections
const redis = new Redis(config.REDIS_URL)
const subRedis = new Redis(config.REDIS_URL) // Separate connection for pub/sub

// Log Redis connection errors instead of crashing
redis.on('error', (err: Error) => log.error('redis connection error', errCtx(err)))
subRedis.on('error', (err: Error) => log.error('redis sub connection error', errCtx(err)))

// AI content generator
const contentGenerator = createContentGenerator(config)

// Services
const agentStore = new AgentStore(redis)
const tracker = new EngagementTracker(redis)
const engine = new HeartbeatEngine(agentStore, tracker, contentGenerator, redis)

// Queue consumer — bridge between gateway and moltbook service
const consumer = new RegistrationConsumer(redis, agentStore, engine, contentGenerator, config.GATEWAY_URL)

// HTTP app
const app = createApp({
  agentStore,
  tracker,
  engine,
  contentGenerator,
  serviceSecret: config.SERVICE_SECRET,
})

// Subscribe to error alerts from gateway pub/sub
subRedis.subscribe('moltbook:error-alerts', (err: Error | null | undefined) => {
  if (err) log.error('failed to subscribe to error-alerts', errCtx(err))
  else log.info('subscribed to moltbook:error-alerts')
})

subRedis.on('message', async (channel: string, message: string) => {
  if (channel === 'moltbook:error-alerts') {
    try {
      const raw = JSON.parse(message)
      const parsed = ErrorAlertSchema.safeParse(raw)
      if (!parsed.success) {
        log.warn('invalid error alert payload', { issue: parsed.error.issues[0]?.message })
        return
      }
      await handleErrorAlert(parsed.data, agentStore, contentGenerator)
    } catch (err) {
      log.error('error handling alert', errCtx(err))
    }
  }
})

// Start
async function main(): Promise<void> {
  // Load existing agents and start their heartbeats
  await engine.loadAll()

  // Start queue consumer in background
  void consumer.start()

  serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    log.info('listening', { port: info.port })
  })
}

main().catch((err) => {
  log.error('fatal', errCtx(err))
  process.exit(1)
})

// Graceful shutdown
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    log.info('shutting down', { signal })
    consumer.stop()
    engine.stopAll()
    redis.disconnect()
    subRedis.disconnect()
    process.exit(0)
  })
}
