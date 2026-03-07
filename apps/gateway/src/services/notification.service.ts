import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'

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

function getQueue(redis: Redis): Queue {
  if (!_queue) {
    _queue = new Queue('notifications', { connection: redis })
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
  redis: Redis,
  payload: PaymentNotificationPayload,
): Promise<void> {
  const queue = getQueue(redis)
  await queue.add('notify:payment', payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  })
}

/** Closes the queue connection. Call on graceful shutdown. */
export async function closeNotificationQueue(): Promise<void> {
  if (_queue) {
    await _queue.close()
    _queue = null
  }
}
