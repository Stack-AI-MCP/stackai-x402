import { Queue } from 'bullmq'
import type { RedisLike } from 'stackai-x402/internal'
import type { ErrorRateAlertPayload } from 'stackai-x402/hooks'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaymentNotificationPayload {
  serverId: string
  tool: string
  amount: string
  token: string
  fromAddress: string
  txid: string
}

// ─── Queue singleton ─────────────────────────────────────────────────────────

let _queue: Queue | null = null
let _queueRedis: RedisLike | null = null

function getQueue(redis: RedisLike): Queue {
  if (_queue && _queueRedis !== redis) {
    throw new Error('Notification queue already initialized with a different Redis connection')
  }
  if (!_queue) {
    // BullMQ pins ioredis@5.9.3 internally while gateway uses ^5.10.0.
    // Runtime-compatible — cast at the BullMQ boundary.
    _queue = new Queue('notifications', { connection: redis as any }) // eslint-disable-line @typescript-eslint/no-explicit-any
    _queueRedis = redis
  }
  return _queue
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Enqueues a payment notification job into the BullMQ `notifications` queue.
 *
 * This is the ONLY function services should call — it never sends messages
 * directly to Telegram, webhooks, or pub/sub (NFR8). All delivery happens
 * in the notification worker.
 *
 * The caller should invoke this via `setImmediate` and never await it in the
 * request path (NFR3).
 */
export async function enqueuePaymentNotification(
  redis: RedisLike,
  payload: PaymentNotificationPayload,
): Promise<void> {
  const queue = getQueue(redis)
  await queue.add('notify:payment', payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  })
}

export type { ErrorRateAlertPayload }

/**
 * Enqueues an error-rate alert job into the BullMQ `notifications` queue.
 *
 * Same non-blocking pattern as payment notifications. BullMQ handles retries
 * (3 attempts, exponential backoff). The worker posts to Moltbook if agentId
 * is configured for the server.
 */
export async function enqueueErrorRateAlert(
  redis: RedisLike,
  payload: ErrorRateAlertPayload,
): Promise<void> {
  const queue = getQueue(redis)
  await queue.add('notify:error-rate-alert', payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  })
}

/** Closes the queue connection. Call on graceful shutdown. */
export async function closeNotificationQueue(): Promise<void> {
  if (_queue) {
    await _queue.close()
    _queue = null
    _queueRedis = null
  }
}
