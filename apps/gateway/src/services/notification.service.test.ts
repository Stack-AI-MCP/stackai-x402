import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { enqueuePaymentNotification, closeNotificationQueue } from './notification.service.js'
import type { PaymentNotificationPayload } from './notification.service.js'

// ─── Mock BullMQ ─────────────────────────────────────────────────────────────

const mockAdd = vi.fn().mockResolvedValue({ id: 'job-1' })
const mockClose = vi.fn().mockResolvedValue(undefined)

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function (this: any) {
    this.add = mockAdd
    this.close = mockClose
  }),
}))

// ─── Tests ───────────────────────────────────────────────────────────────────

const SAMPLE_PAYLOAD: PaymentNotificationPayload = {
  serverId: 'server-abc',
  tool: 'tools/call',
  amount: '1000000',
  token: 'STX',
  fromAddress: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
  txid: '0xabc123',
}

// Minimal Redis stub — BullMQ only needs a connection-like object
const fakeRedis = {} as any

describe('notification.service', () => {
  beforeEach(() => {
    mockAdd.mockClear()
    mockClose.mockClear()
  })

  afterEach(async () => {
    await closeNotificationQueue()
  })

  it('enqueues a notify:payment job with correct payload', async () => {
    await enqueuePaymentNotification(fakeRedis, SAMPLE_PAYLOAD)

    expect(mockAdd).toHaveBeenCalledTimes(1)
    expect(mockAdd).toHaveBeenCalledWith(
      'notify:payment',
      SAMPLE_PAYLOAD,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    )
  })

  it('creates queue with notifications name', async () => {
    const { Queue } = await import('bullmq')
    await enqueuePaymentNotification(fakeRedis, SAMPLE_PAYLOAD)

    expect(Queue).toHaveBeenCalledWith('notifications', { connection: fakeRedis })
  })

  it('reuses the same queue instance across calls', async () => {
    const { Queue } = await import('bullmq')
    const constructorCallsBefore = (Queue as ReturnType<typeof vi.fn>).mock.calls.length

    await enqueuePaymentNotification(fakeRedis, SAMPLE_PAYLOAD)
    await enqueuePaymentNotification(fakeRedis, SAMPLE_PAYLOAD)

    // Queue constructor called at most once more (singleton)
    const constructorCallsAfter = (Queue as ReturnType<typeof vi.fn>).mock.calls.length
    expect(constructorCallsAfter - constructorCallsBefore).toBeLessThanOrEqual(1)
    expect(mockAdd).toHaveBeenCalledTimes(2)
  })

  it('closeNotificationQueue closes and resets the singleton', async () => {
    await enqueuePaymentNotification(fakeRedis, SAMPLE_PAYLOAD)
    await closeNotificationQueue()

    expect(mockClose).toHaveBeenCalledTimes(1)
  })
})
