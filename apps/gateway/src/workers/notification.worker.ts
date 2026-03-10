import { Worker } from 'bullmq'
import { Api } from 'grammy'
import type { Redis } from 'ioredis'
import type {
  PaymentNotificationPayload,
  ErrorRateAlertPayload,
} from '../services/notification.service.js'

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

function formatErrorRateAlert(data: ErrorRateAlertPayload): string {
  const pct = (data.errorRate * 100).toFixed(1)
  return [
    `\u{26A0}\u{FE0F} High error rate alert`,
    `Server: ${data.serverId}`,
    `Error rate: ${pct}% (1-hour rolling window)`,
    `Action: Check upstream server health`,
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
 * Handles error-rate alert jobs (Story 3-4, AC2, AC4, AC6).
 *
 * Delivery channels:
 * 1. Moltbook comment on agent post (if agentId configured — Story 4.2)
 * 2. Telegram message (if telegramChatId configured)
 * 3. Redis pub/sub for SSE
 *
 * If Moltbook is unavailable, BullMQ retries up to 3 times then discards (NFR14).
 */
async function handleErrorRateAlert(
  redis: Redis,
  pubRedis: Redis,
  telegramApi: Api | null,
  data: ErrorRateAlertPayload,
): Promise<void> {
  const configJson = await redis.get(`server:${data.serverId}:config`)
  if (!configJson) return

  const config = JSON.parse(configJson) as {
    telegramChatId?: string
    moltbookAgentId?: string
    moltbookApiKey?: string
  }

  // ── Moltbook comment (AC2 — post alert on agent's feed) ──────────
  if (config.moltbookAgentId && config.moltbookApiKey) {
    const pct = (data.errorRate * 100).toFixed(1)
    const res = await fetch(
      `https://api.moltbook.com/agents/${config.moltbookAgentId}/comments`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.moltbookApiKey}`,
        },
        body: JSON.stringify({
          text: `Error rate alert: ${pct}% errors in the last hour. Please investigate.`,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!res.ok) {
      throw new Error(`Moltbook returned ${res.status}`)
    }
  }

  // ── Telegram alert ────────────────────────────────────────────────
  if (telegramApi && config.telegramChatId) {
    await telegramApi.sendMessage(
      config.telegramChatId,
      formatErrorRateAlert(data),
    )
  }

  // ── Redis pub/sub for SSE ─────────────────────────────────────────
  await pubRedis.publish(
    `notifications:${data.serverId}`,
    JSON.stringify({
      type: 'error-rate-alert',
      ...data,
      timestamp: Date.now(),
    }),
  )
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

  const worker = new Worker(
    'notifications',
    async (job) => {
      // ── Error-rate alert (Story 3-4, AC2) ─────────────────────────
      if (job.name === 'notify:error-rate-alert') {
        const alertData = job.data as ErrorRateAlertPayload
        await handleErrorRateAlert(redis, pubRedis, telegramApi, alertData)
        return
      }

      // ── Payment notification (Story 1-10) ─────────────────────────
      const data = job.data as PaymentNotificationPayload

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
    // BullMQ pins ioredis@5.9.3 internally while gateway uses ^5.10.0.
    // Runtime-compatible — cast at the BullMQ boundary.
    { connection: redis as any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  )

  return worker
}
