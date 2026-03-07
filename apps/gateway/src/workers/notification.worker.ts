import { Worker } from 'bullmq'
import { Api } from 'grammy'
import type { Redis } from 'ioredis'
import type { PaymentNotificationPayload } from '../services/notification.service.js'

// ─── Message formatting ──────────────────────────────────────────────────────

function formatTelegramMessage(data: PaymentNotificationPayload): string {
  return [
    `\u{1F4B0} Payment received!`,
    `Tool: ${data.tool}`,
    `Amount: ${data.amount} ${data.token}`,
    `From: ${data.fromAddress}`,
    `Tx: ${data.txid}`,
  ].join('\n')
}

// ─── Worker factory ──────────────────────────────────────────────────────────

export interface NotificationWorkerDeps {
  /** ioredis connection for BullMQ job processing */
  redis: Redis
  /**
   * SEPARATE ioredis connection for pub/sub.
   * ioredis subscriber connections cannot be shared with regular commands.
   */
  pubRedis: Redis
  /** Telegram bot token — if falsy, Telegram delivery is globally disabled */
  telegramBotToken?: string
}

/**
 * Creates and starts the BullMQ notification worker.
 *
 * Processes `notify:payment` jobs by:
 * 1. Loading server config from Redis to get telegramChatId / webhookUrl
 * 2. Sending Telegram message via grammy Api (if chatId configured)
 * 3. POSTing to webhookUrl (if configured)
 * 4. Publishing to Redis pub/sub `notifications:{serverId}` for SSE
 *
 * BullMQ handles retries (3 attempts, exponential backoff) — the retry
 * config is set at enqueue time in notification.service.ts.
 */
export function createNotificationWorker(deps: NotificationWorkerDeps): Worker {
  const { redis, pubRedis, telegramBotToken } = deps

  const telegramApi = telegramBotToken ? new Api(telegramBotToken) : null

  const worker = new Worker<PaymentNotificationPayload>(
    'notifications',
    async (job) => {
      const data = job.data

      // Load server config to get delivery targets
      const configJson = await redis.get(`server:${data.serverId}:config`)
      if (!configJson) {
        // Server deleted between payment and notification — skip silently
        return
      }

      const config = JSON.parse(configJson) as {
        telegramChatId?: string
        webhookUrl?: string
      }

      // ── Telegram delivery (AC: 3, 5) ────────────────────────────────
      if (telegramApi && config.telegramChatId) {
        await telegramApi.sendMessage(
          config.telegramChatId,
          formatTelegramMessage(data),
        )
      }

      // ── Webhook delivery (AC: 6) ────────────────────────────────────
      if (config.webhookUrl) {
        const webhookRes = await fetch(config.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          signal: AbortSignal.timeout(10_000),
        })
        if (!webhookRes.ok) {
          throw new Error(`Webhook returned ${webhookRes.status}`)
        }
      }

      // ── Redis pub/sub for in-app SSE (AC: 7) ───────────────────────
      await pubRedis.publish(
        `notifications:${data.serverId}`,
        JSON.stringify({
          type: 'payment',
          ...data,
          timestamp: Date.now(),
        }),
      )
    },
    { connection: redis },
  )

  return worker
}
