import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PaymentNotificationPayload } from '../services/notification.service.js'
import type { ErrorRateAlertPayload } from 'stackai-x402/hooks'

// ─── Mock BullMQ Worker ──────────────────────────────────────────────────────

type ProcessorFn = (job: { name?: string; data: any }) => Promise<void> // eslint-disable-line @typescript-eslint/no-explicit-any
let capturedProcessor: ProcessorFn | null = null

const mockWorkerClose = vi.fn().mockResolvedValue(undefined)

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function (this: any, _name: string, processor: ProcessorFn) {
    capturedProcessor = processor
    this.close = mockWorkerClose
  }),
}))

// ─── Mock grammy Api ─────────────────────────────────────────────────────────

const mockSendMessage = vi.fn().mockResolvedValue({})

vi.mock('grammy', () => ({
  Api: vi.fn().mockImplementation(function (this: any) {
    this.sendMessage = mockSendMessage
  }),
}))

// ─── Import after mocks ──────────────────────────────────────────────────────

import { createNotificationWorker } from './notification.worker.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SAMPLE_DATA: PaymentNotificationPayload = {
  serverId: 'server-xyz',
  tool: 'tools/call',
  amount: '1000000',
  token: 'STX',
  fromAddress: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
  txid: '0xdeadbeef',
}

const SERVER_CONFIG = {
  telegramChatId: '12345',
  webhookUrl: 'https://hooks.example.com/notify',
}

function makeRedis(configJson: string | null = JSON.stringify(SERVER_CONFIG)) {
  return {
    get: vi.fn().mockResolvedValue(configJson),
    publish: vi.fn().mockResolvedValue(1),
  } as any
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('notification.worker', () => {
  let redis: ReturnType<typeof makeRedis>
  let pubRedis: ReturnType<typeof makeRedis>

  beforeEach(() => {
    capturedProcessor = null
    mockSendMessage.mockClear()
    redis = makeRedis()
    pubRedis = makeRedis()

    // Mock global fetch for webhook calls
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('OK', { status: 200 })))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a BullMQ Worker and captures the processor', () => {
    createNotificationWorker({ redis, pubRedis, telegramBotToken: 'bot-token' })

    // The Worker mock captures the processor function — if it wasn't called
    // with a processor, capturedProcessor would remain null
    expect(capturedProcessor).toBeTypeOf('function')
  })

  it('sends Telegram message when telegramChatId is configured', async () => {
    createNotificationWorker({ redis, pubRedis, telegramBotToken: 'bot-token' })
    expect(capturedProcessor).toBeTruthy()

    await capturedProcessor!({ data: SAMPLE_DATA })

    expect(mockSendMessage).toHaveBeenCalledTimes(1)
    expect(mockSendMessage).toHaveBeenCalledWith(
      '12345',
      expect.stringContaining('Payment received'),
    )
    // Verify message contains key info
    const message = mockSendMessage.mock.calls[0][1]
    expect(message).toContain('tools/call')
    expect(message).toContain('STX')
    expect(message).toContain('0xdeadbeef')
  })

  it('skips Telegram when telegramChatId is not configured (AC5)', async () => {
    redis = makeRedis(JSON.stringify({ webhookUrl: 'https://hooks.example.com/notify' }))
    createNotificationWorker({ redis, pubRedis, telegramBotToken: 'bot-token' })

    await capturedProcessor!({ data: SAMPLE_DATA })

    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('skips Telegram when no bot token is provided', async () => {
    createNotificationWorker({ redis, pubRedis })

    await capturedProcessor!({ data: SAMPLE_DATA })

    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('POSTs to webhookUrl when configured (AC6)', async () => {
    createNotificationWorker({ redis, pubRedis, telegramBotToken: 'bot-token' })

    await capturedProcessor!({ data: SAMPLE_DATA })

    expect(fetch).toHaveBeenCalledWith(
      'https://hooks.example.com/notify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(SAMPLE_DATA),
      }),
    )
  })

  it('skips webhook when webhookUrl is not configured', async () => {
    redis = makeRedis(JSON.stringify({ telegramChatId: '12345' }))
    createNotificationWorker({ redis, pubRedis, telegramBotToken: 'bot-token' })

    await capturedProcessor!({ data: SAMPLE_DATA })

    // fetch not called for webhook (Telegram uses grammy Api, not fetch)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('publishes to Redis pub/sub channel (AC7)', async () => {
    createNotificationWorker({ redis, pubRedis, telegramBotToken: 'bot-token' })

    await capturedProcessor!({ data: SAMPLE_DATA })

    expect(pubRedis.publish).toHaveBeenCalledTimes(1)
    expect(pubRedis.publish).toHaveBeenCalledWith(
      'notifications:server-xyz',
      expect.stringContaining('"type":"payment"'),
    )

    const published = JSON.parse(pubRedis.publish.mock.calls[0][1])
    expect(published.type).toBe('payment')
    expect(published.serverId).toBe('server-xyz')
    expect(published.txid).toBe('0xdeadbeef')
    expect(published.timestamp).toBeTypeOf('number')
  })

  it('skips silently when server config is not found', async () => {
    redis = makeRedis(null)
    createNotificationWorker({ redis, pubRedis, telegramBotToken: 'bot-token' })

    // Should not throw
    await capturedProcessor!({ data: SAMPLE_DATA })

    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(pubRedis.publish).not.toHaveBeenCalled()
  })

  it('throws on webhook failure to trigger BullMQ retry (AC4)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Error', { status: 500 })))
    createNotificationWorker({ redis, pubRedis, telegramBotToken: 'bot-token' })

    await expect(capturedProcessor!({ data: SAMPLE_DATA })).rejects.toThrow(
      'Webhook returned 500',
    )
  })

  // ─── Error-rate alert tests (Story 3-4) ─────────────────────────────────

  describe('notify:error-rate-alert', () => {
    const ALERT_DATA: ErrorRateAlertPayload = {
      serverId: 'server-xyz',
      errorRate: 0.15,
    }

    const MOLTBOOK_CONFIG = {
      telegramChatId: '12345',
      moltbookAgentId: 'agent-abc',
    }

    it('publishes to moltbook:error-alerts channel when agentId is configured (AC2)', async () => {
      redis = makeRedis(JSON.stringify(MOLTBOOK_CONFIG))
      createNotificationWorker({ redis, pubRedis, telegramBotToken: 'bot-token' })

      await capturedProcessor!({ name: 'notify:error-rate-alert', data: ALERT_DATA })

      expect(pubRedis.publish).toHaveBeenCalledWith(
        'moltbook:error-alerts',
        expect.stringContaining('"agentId":"agent-abc"'),
      )
      const published = JSON.parse(
        pubRedis.publish.mock.calls.find((c: any) => c[0] === 'moltbook:error-alerts')![1],
      )
      expect(published.serverId).toBe('server-xyz')
      expect(published.errorRate).toBe(0.15)
      expect(published.timestamp).toBeTypeOf('number')
    })

    it('sends Telegram alert when chatId is configured', async () => {
      redis = makeRedis(JSON.stringify(MOLTBOOK_CONFIG))
      createNotificationWorker({ redis, pubRedis, telegramBotToken: 'bot-token' })

      await capturedProcessor!({ name: 'notify:error-rate-alert', data: ALERT_DATA })

      expect(mockSendMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringContaining('error rate alert'),
      )
      const msg = mockSendMessage.mock.calls[0][1]
      expect(msg).toContain('15.0%')
    })

    it('publishes error-rate-alert to pub/sub', async () => {
      redis = makeRedis(JSON.stringify({ telegramChatId: '12345' }))
      createNotificationWorker({ redis, pubRedis, telegramBotToken: 'bot-token' })

      await capturedProcessor!({ name: 'notify:error-rate-alert', data: ALERT_DATA })

      expect(pubRedis.publish).toHaveBeenCalledWith(
        'notifications:server-xyz',
        expect.stringContaining('"type":"error-rate-alert"'),
      )
    })

    it('skips Moltbook pub/sub when agentId is not configured', async () => {
      redis = makeRedis(JSON.stringify({ telegramChatId: '12345' }))
      createNotificationWorker({ redis, pubRedis, telegramBotToken: 'bot-token' })

      await capturedProcessor!({ name: 'notify:error-rate-alert', data: ALERT_DATA })

      // Only notifications channel published, not moltbook:error-alerts
      const moltbookCalls = pubRedis.publish.mock.calls.filter(
        (c: any) => c[0] === 'moltbook:error-alerts',
      )
      expect(moltbookCalls).toHaveLength(0)
    })

    it('skips silently when server config not found', async () => {
      redis = makeRedis(null)
      createNotificationWorker({ redis, pubRedis, telegramBotToken: 'bot-token' })

      await capturedProcessor!({ name: 'notify:error-rate-alert', data: ALERT_DATA })

      expect(mockSendMessage).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
      expect(pubRedis.publish).not.toHaveBeenCalled()
    })

    it('publishes error-rate-alert to both moltbook and notifications channels', async () => {
      redis = makeRedis(JSON.stringify(MOLTBOOK_CONFIG))
      createNotificationWorker({ redis, pubRedis, telegramBotToken: 'bot-token' })

      await capturedProcessor!({ name: 'notify:error-rate-alert', data: ALERT_DATA })

      // Both channels should receive a publish
      expect(pubRedis.publish).toHaveBeenCalledWith(
        'moltbook:error-alerts',
        expect.any(String),
      )
      expect(pubRedis.publish).toHaveBeenCalledWith(
        'notifications:server-xyz',
        expect.stringContaining('"type":"error-rate-alert"'),
      )
    })
  })
})
