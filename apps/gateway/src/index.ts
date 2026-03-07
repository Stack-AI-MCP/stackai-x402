import { serve } from '@hono/node-server'
import Redis from 'ioredis'
import { createApp } from './app.js'
import { parseConfig } from './config.js'
import { getRedis } from './redis.js'
import { createNotificationWorker } from './workers/notification.worker.js'

const config = parseConfig()
export const app = createApp({
  redis: getRedis(),
  encryptionKey: config.GATEWAY_ENCRYPTION_KEY,
  network: config.NETWORK,
  relayUrl: config.RELAY_URL,
  tokenPrices: {
    STX: config.TOKEN_PRICE_STX,
    sBTC: config.TOKEN_PRICE_SBTC,
    USDCx: config.TOKEN_PRICE_USDCX,
  },
})

if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port: config.PORT })

  // Separate ioredis connection for pub/sub (cannot share with BullMQ commands)
  const pubRedis = new Redis(config.REDIS_URL)

  createNotificationWorker({
    redis: getRedis(),
    pubRedis,
    telegramBotToken: config.TELEGRAM_BOT_TOKEN,
  })
}
