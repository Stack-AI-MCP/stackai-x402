import { serve } from '@hono/node-server'
import Redis from 'ioredis'
import { createApp } from './app.js'
import { parseConfig } from './config.js'
import { getRedis } from './redis.js'
import { createNotificationWorker } from './workers/notification.worker.js'
import { closeNotificationQueue, enqueueErrorRateAlert } from './services/notification.service.js'
import { LoggingHook, X402MonetizationHook, AnalyticsHook } from 'stackai-x402/hooks'

const config = parseConfig()
const redis = getRedis()

// ioredis Redis satisfies RedisLike at runtime; the TS mismatch on `scan`
// is a pre-existing issue (ioredis vs bullmq version skew). We cast only
// where the new analytics methods are consumed.
export const app = createApp({
  redis: redis as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  encryptionKey: config.GATEWAY_ENCRYPTION_KEY,
  relayUrl: config.RELAY_URL,
  testnetRelayUrl: config.TESTNET_RELAY_URL,
  tokenPrices: {
    STX: config.TOKEN_PRICE_STX,
    sBTC: config.TOKEN_PRICE_SBTC,
    USDCx: config.TOKEN_PRICE_USDCX,
  },
  hooks: [
    new LoggingHook(),
    new X402MonetizationHook(),
    new AnalyticsHook(redis as any, undefined, (payload) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      setImmediate(() => enqueueErrorRateAlert(redis as any, payload).catch(() => {})) // eslint-disable-line @typescript-eslint/no-explicit-any
    }),
  ],
  operatorKey: config.OPERATOR_KEY,
})

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port: config.PORT })

  // Separate ioredis connection for pub/sub (cannot share with BullMQ commands)
  const pubRedis = new Redis(config.REDIS_URL)

  const notificationWorker = createNotificationWorker({
    redis: getRedis(),
    pubRedis,
    telegramBotToken: config.TELEGRAM_BOT_TOKEN,
  })

  const shutdown = async () => {
    await notificationWorker.close()
    await closeNotificationQueue()
    await pubRedis.quit()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
