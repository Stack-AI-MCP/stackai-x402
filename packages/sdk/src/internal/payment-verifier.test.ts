import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { randomPrivateKey, getAddressFromPrivateKey } from '@stacks/transactions'
import { buildPaymentTransaction } from './payment-builder.js'
import { verifyPayment, PaymentVerificationError } from './payment-verifier.js'

// ─── Test fixtures built once from real transactions ─────────────────────────

const SENDER_KEY = randomPrivateKey()
const MAINNET_SENDER = getAddressFromPrivateKey(SENDER_KEY, 'mainnet')
const TESTNET_SENDER = getAddressFromPrivateKey(SENDER_KEY, 'testnet')
const MAINNET_RECIPIENT = 'SP3FGQ8Z7JY9BWYZ5WM53E0M9NK7WHJF0691NZ159'
const TESTNET_RECIPIENT = getAddressFromPrivateKey(SENDER_KEY, 'testnet')
const PAYMENT_AMOUNT = 1_000_000n
const PAYMENT_ID = 'test-payment-001'

// Build real signed txs in beforeAll — no mocks on the transaction itself
let mainnetStxHeader: string
let testnetStxHeader: string
let sbtcHeader: string

beforeAll(async () => {
  const [mainnetHex, testnetHex, sbtcHex] = await Promise.all([
    buildPaymentTransaction({
      senderKey: SENDER_KEY,
      recipient: MAINNET_RECIPIENT,
      amount: PAYMENT_AMOUNT,
      tokenType: 'STX',
      network: 'mainnet',
    }),
    buildPaymentTransaction({
      senderKey: SENDER_KEY,
      recipient: TESTNET_RECIPIENT,
      amount: PAYMENT_AMOUNT,
      tokenType: 'STX',
      network: 'testnet',
    }),
    buildPaymentTransaction({
      senderKey: SENDER_KEY,
      recipient: MAINNET_RECIPIENT,
      amount: PAYMENT_AMOUNT,
      tokenType: 'sBTC',
      network: 'mainnet',
    }),
  ])

  // The payment-signature header is the base64 encoding of the hex tx
  mainnetStxHeader = Buffer.from(mainnetHex, 'hex').toString('base64')
  testnetStxHeader = Buffer.from(testnetHex, 'hex').toString('base64')
  sbtcHeader = Buffer.from(sbtcHex, 'hex').toString('base64')
})

// ─── Redis mock factory ───────────────────────────────────────────────────────

function makeRedis(returnValue: string | null = 'OK') {
  return {
    set: vi.fn().mockResolvedValue(returnValue),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    scan: vi.fn().mockResolvedValue(['0', []]),
    mget: vi.fn().mockResolvedValue([]),
    incr: vi.fn().mockResolvedValue(1),
    incrby: vi.fn().mockResolvedValue(1),
    pfadd: vi.fn().mockResolvedValue(1),
    pfcount: vi.fn().mockResolvedValue(0),
  }
}

// ─── Shared baseline params ───────────────────────────────────────────────────

const TEST_RELAY_URL = 'https://x402-relay.aibtc.com/broadcast'

function baseParams(overrides?: object) {
  return {
    header: mainnetStxHeader,
    expectedAmount: PAYMENT_AMOUNT,
    expectedRecipient: MAINNET_RECIPIENT,
    expectedNetwork: 'mainnet' as const,
    paymentId: PAYMENT_ID,
    redis: makeRedis(),
    relayUrl: TEST_RELAY_URL,
    ...overrides,
  }
}

// ─── Success path ─────────────────────────────────────────────────────────────

describe('verifyPayment — success path', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ txid: 'mock-txid-abc123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
  })

  it('resolves without throwing for a valid STX payment', async () => {
    await expect(verifyPayment(baseParams({ redis: makeRedis('OK') }))).resolves.toMatchObject({
      txid: 'mock-txid-abc123',
      senderAddress: MAINNET_SENDER,
    })
  })

  it('accepts payment with amount greater than expected (>=, not ==)', async () => {
    await expect(
      verifyPayment(baseParams({ expectedAmount: 1n, redis: makeRedis('OK') })),
    ).resolves.toMatchObject({ txid: 'mock-txid-abc123', senderAddress: MAINNET_SENDER })
  })

  it('performs case-insensitive recipient comparison', async () => {
    await expect(
      verifyPayment(baseParams({ expectedRecipient: MAINNET_RECIPIENT.toLowerCase(), redis: makeRedis('OK') })),
    ).resolves.toMatchObject({ txid: 'mock-txid-abc123', senderAddress: MAINNET_SENDER })
  })

  it('verifies an sBTC (SIP-010) payment', async () => {
    await expect(
      verifyPayment(baseParams({ header: sbtcHeader, paymentId: PAYMENT_ID + '-sbtc', redis: makeRedis('OK') })),
    ).resolves.toMatchObject({ txid: 'mock-txid-abc123', senderAddress: MAINNET_SENDER })
  })

  it('returns testnet sender address (ST prefix) for testnet transactions', async () => {
    await expect(
      verifyPayment(baseParams({
        header: testnetStxHeader,
        expectedRecipient: TESTNET_RECIPIENT,
        expectedNetwork: 'testnet',
        paymentId: PAYMENT_ID + '-testnet',
        redis: makeRedis('OK'),
      })),
    ).resolves.toMatchObject({ txid: 'mock-txid-abc123', senderAddress: TESTNET_SENDER })
    expect(TESTNET_SENDER).toMatch(/^ST/)
  })
})

// ─── Step 1: DECODE_FAILED ────────────────────────────────────────────────────

describe('Step 1 — DECODE_FAILED', () => {
  it('throws DECODE_FAILED on input with invalid base64 characters', async () => {
    const err = await verifyPayment(baseParams({ header: '!!!not-base64!!!' })).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentVerificationError)
    expect(err.code).toBe('DECODE_FAILED')
  })

  it('throws DECODE_FAILED on base64 input with incorrect padding', async () => {
    // 3 chars is not a valid padded base64 length (must be multiple of 4)
    const err = await verifyPayment(baseParams({ header: 'abc' })).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentVerificationError)
    expect(err.code).toBe('DECODE_FAILED')
  })

  it('throws DECODE_FAILED on empty string', async () => {
    const err = await verifyPayment(baseParams({ header: '' })).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentVerificationError)
    expect(err.code).toBe('DECODE_FAILED')
  })

  it('does not call fetch (relay) on decode failure', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    await verifyPayment(baseParams({ header: '!!!bad!!!' })).catch(() => undefined)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ─── Step 2: DESERIALIZE_FAILED ──────────────────────────────────────────────

describe('Step 2 — DESERIALIZE_FAILED', () => {
  it('throws DESERIALIZE_FAILED on valid base64 but invalid tx bytes', async () => {
    const badHeader = Buffer.from('deadbeefdeadbeef', 'hex').toString('base64')
    const err = await verifyPayment(baseParams({ header: badHeader })).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentVerificationError)
    expect(err.code).toBe('DESERIALIZE_FAILED')
  })

  it('does not call fetch (relay) on deserialize failure', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    const badHeader = Buffer.from('deadbeefdeadbeef', 'hex').toString('base64')
    await verifyPayment(baseParams({ header: badHeader })).catch(() => undefined)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ─── Step 3: AMOUNT_MISMATCH ─────────────────────────────────────────────────

describe('Step 3 — AMOUNT_MISMATCH', () => {
  it('throws AMOUNT_MISMATCH when tx amount is less than expected', async () => {
    const err = await verifyPayment(
      baseParams({ expectedAmount: PAYMENT_AMOUNT + 1n }),
    ).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentVerificationError)
    expect(err.code).toBe('AMOUNT_MISMATCH')
  })

  it('does not call fetch (relay) on amount mismatch', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    await verifyPayment(baseParams({ expectedAmount: PAYMENT_AMOUNT + 1n })).catch(() => undefined)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ─── Step 4: RECIPIENT_MISMATCH ───────────────────────────────────────────────

describe('Step 4 — RECIPIENT_MISMATCH', () => {
  it('throws RECIPIENT_MISMATCH when recipient does not match', async () => {
    const err = await verifyPayment(
      baseParams({ expectedRecipient: 'SP000000000000000000000000000WRONG' }),
    ).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentVerificationError)
    expect(err.code).toBe('RECIPIENT_MISMATCH')
  })

  it('throws RECIPIENT_MISMATCH on a SIP-010 ContractCall when recipient address does not match', async () => {
    // Exercises the ContractCall path in extractRecipient (args[2] lookup),
    // distinct from the STX TokenTransfer path tested above.
    const err = await verifyPayment(
      baseParams({ header: sbtcHeader, expectedRecipient: 'SP000000000000000000000000000WRONG' }),
    ).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentVerificationError)
    expect(err.code).toBe('RECIPIENT_MISMATCH')
  })

  it('does not call fetch (relay) on recipient mismatch', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    await verifyPayment(
      baseParams({ expectedRecipient: 'SP000000000000000000000000000WRONG' }),
    ).catch(() => undefined)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ─── Step 5: NETWORK_MISMATCH ─────────────────────────────────────────────────

describe('Step 5 — NETWORK_MISMATCH', () => {
  it('throws NETWORK_MISMATCH when tx is testnet but mainnet expected', async () => {
    const err = await verifyPayment(
      baseParams({
        header: testnetStxHeader,
        expectedRecipient: TESTNET_RECIPIENT,
        expectedNetwork: 'mainnet',
      }),
    ).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentVerificationError)
    expect(err.code).toBe('NETWORK_MISMATCH')
  })

  it('does not call fetch (relay) on network mismatch', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    await verifyPayment(
      baseParams({
        header: testnetStxHeader,
        expectedRecipient: TESTNET_RECIPIENT,
        expectedNetwork: 'mainnet',
      }),
    ).catch(() => undefined)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ─── Step 6: REPLAY_DETECTED ─────────────────────────────────────────────────

describe('Step 6 — REPLAY_DETECTED', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ txid: 'mock-txid-abc123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
  })

  it('throws REPLAY_DETECTED when Redis SET NX returns null (key exists)', async () => {
    const err = await verifyPayment(
      baseParams({ redis: makeRedis(null) }),
    ).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentVerificationError)
    expect(err.code).toBe('REPLAY_DETECTED')
  })

  it('does not call fetch (relay) on replay detection', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    await verifyPayment(baseParams({ redis: makeRedis(null) })).catch(() => undefined)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('propagates raw Redis infrastructure errors (not wrapped as REPLAY_DETECTED)', async () => {
    const redisError = new Error('ECONNREFUSED: Redis unreachable')
    const redis = {
      set: vi.fn().mockRejectedValue(redisError),
      get: vi.fn(),
      del: vi.fn(),
      scan: vi.fn().mockResolvedValue(['0', []]),
      mget: vi.fn().mockResolvedValue([]),
      incr: vi.fn().mockResolvedValue(1),
      incrby: vi.fn().mockResolvedValue(1),
      pfadd: vi.fn().mockResolvedValue(1),
      pfcount: vi.fn().mockResolvedValue(0),
    }

    const err = await verifyPayment(baseParams({ redis })).catch((e) => e)

    // Must NOT be a PaymentVerificationError — callers distinguish infra from replay
    expect(err).not.toBeInstanceOf(PaymentVerificationError)
    expect(err.message).toContain('ECONNREFUSED')
  })

  it('sets Redis key with correct format, NX flag, EX mode, and 30-day TTL', async () => {
    const redis = makeRedis('OK')
    await verifyPayment(baseParams({ paymentId: 'abc-123', redis }))

    expect(redis.set).toHaveBeenCalledOnce()
    const [key, value, ...rest] = redis.set.mock.calls[0]
    expect(key).toBe('payment:abc-123')
    expect(value).toBe('used')
    expect(rest).toContain('NX')
    expect(rest).toContain('EX')
    expect(rest).toContain(2_592_000)
  })
})

// ─── RELAY_FAILED ─────────────────────────────────────────────────────────────

describe('RELAY_FAILED', () => {
  it('throws RELAY_FAILED when relay returns non-OK', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('service unavailable', { status: 503 })),
    )
    const err = await verifyPayment(baseParams({ redis: makeRedis('OK') })).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentVerificationError)
    expect(err.code).toBe('RELAY_FAILED')
  })

  it('rolls back the Redis key (del) when relay fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('gateway error', { status: 502 })),
    )
    const redis = makeRedis('OK')

    await verifyPayment(baseParams({ paymentId: 'rollback-test', redis })).catch(() => undefined)

    expect(redis.del).toHaveBeenCalledWith('payment:rollback-test')
  })
})

// ─── NFR: payment-signature never logged ─────────────────────────────────────

describe('NFR: payment-signature header not logged', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ txid: 'mock-txid-abc123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    logSpy = vi.spyOn(console, 'log')
    errorSpy = vi.spyOn(console, 'error')
    warnSpy = vi.spyOn(console, 'warn')
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('does not write the raw header value to any console output', async () => {
    await verifyPayment(baseParams({ paymentId: 'nfr-test', redis: makeRedis('OK') }))

    const logged = [
      ...logSpy.mock.calls,
      ...errorSpy.mock.calls,
      ...warnSpy.mock.calls,
    ].flat().join(' ')
    expect(logged).not.toContain(mainnetStxHeader)
  })
})
