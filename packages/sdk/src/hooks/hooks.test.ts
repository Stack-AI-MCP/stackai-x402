import { describe, it, expect, vi } from 'vitest'
import { LoggingHook } from './logging.hook.js'
import { X402MonetizationHook } from './monetization.hook.js'
import { AnalyticsHook } from './analytics.hook.js'
import type { RequestContext } from './hook.interface.js'
import type { RedisLike } from '../internal/payment-verifier.js'
import type { AnalyticsDb } from './analytics.hook.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    serverId: 'test-server',
    toolName: 'get-price',
    success: true,
    durationMs: 42,
    timestamp: '2026-03-08T12:00:00.000Z',
    ...overrides,
  }
}

function makeRedis(): RedisLike & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {}
  const track =
    (method: string) =>
    async (...args: unknown[]) => {
      calls[method] = calls[method] ?? []
      calls[method].push(args)
      return 1 as never
    }

  return {
    calls,
    set: track('set') as RedisLike['set'],
    get: track('get') as RedisLike['get'],
    del: track('del') as RedisLike['del'],
    scan: track('scan') as RedisLike['scan'],
    mget: track('mget') as RedisLike['mget'],
    incr: track('incr') as RedisLike['incr'],
    incrby: track('incrby') as RedisLike['incrby'],
    pfadd: track('pfadd') as RedisLike['pfadd'],
    pfcount: track('pfcount') as RedisLike['pfcount'],
  }
}

/** Wait for setImmediate callbacks and their promises to resolve. */
function flushImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(() => setTimeout(resolve, 10)))
}

// ─── LoggingHook ──────────────────────────────────────────────────────────────

describe('LoggingHook', () => {
  it('logs tool call without throwing', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const hook = new LoggingHook()

    await hook.onRequest(makeCtx())

    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toContain('get-price')
    expect(spy.mock.calls[0][0]).toContain('OK')
    expect(spy.mock.calls[0][0]).toContain('42ms')
    spy.mockRestore()
  })

  it('swallows errors silently (AC2)', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {
      throw new Error('console exploded')
    })
    const hook = new LoggingHook()

    // Should NOT throw
    await expect(hook.onRequest(makeCtx())).resolves.toBeUndefined()
    spy.mockRestore()
  })
})

// ─── X402MonetizationHook ─────────────────────────────────────────────────────

describe('X402MonetizationHook', () => {
  it('logs paid calls', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const hook = new X402MonetizationHook()

    await hook.onRequest(
      makeCtx({ txid: 'tx123', amount: '1000000', token: 'STX', payer: 'SP123' }),
    )

    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toContain('tx:tx123')
    spy.mockRestore()
  })

  it('does not log free calls', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const hook = new X402MonetizationHook()

    await hook.onRequest(makeCtx())

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('swallows errors silently (AC2)', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {
      throw new Error('boom')
    })
    const hook = new X402MonetizationHook()

    await expect(
      hook.onRequest(makeCtx({ txid: 'tx', amount: '1', token: 'STX' })),
    ).resolves.toBeUndefined()
    spy.mockRestore()
  })
})

// ─── AnalyticsHook ────────────────────────────────────────────────────────────

describe('AnalyticsHook', () => {
  it('writes call counter via setImmediate (AC3, AC7)', async () => {
    const redis = makeRedis()
    const hook = new AnalyticsHook(redis)

    await hook.onRequest(makeCtx())
    await flushImmediate()

    expect(redis.calls['incr']).toBeDefined()
    expect(redis.calls['incr'][0][0]).toBe('analytics:test-server:2026-03-08:calls')
  })

  it('tracks revenue for paid calls (AC3)', async () => {
    const redis = makeRedis()
    const hook = new AnalyticsHook(redis)

    await hook.onRequest(makeCtx({ amount: '500000', token: 'STX' }))
    await flushImmediate()

    expect(redis.calls['incrby']).toBeDefined()
    expect(redis.calls['incrby'][0]).toEqual([
      'analytics:test-server:2026-03-08:revenue:STX',
      '500000',
    ])
  })

  it('adds caller to HyperLogLog (AC3)', async () => {
    const redis = makeRedis()
    const hook = new AnalyticsHook(redis)

    await hook.onRequest(makeCtx({ payer: 'SP1ABCDEF' }))
    await flushImmediate()

    expect(redis.calls['pfadd']).toBeDefined()
    expect(redis.calls['pfadd'][0]).toEqual([
      'analytics:test-server:callers',
      'SP1ABCDEF',
    ])
  })

  it('writes audit key with 90-day TTL (AC6)', async () => {
    const redis = makeRedis()
    const hook = new AnalyticsHook(redis)

    await hook.onRequest(makeCtx({ txid: '0xabc' }))
    await flushImmediate()

    expect(redis.calls['set']).toBeDefined()
    // Find the audit key SET call — not by index since TTL-init SET NX calls come first
    const setCall = redis.calls['set'].find((args: unknown[]) => args[0] === 'audit:0xabc')
    expect(setCall).toBeDefined()
    expect(setCall[2]).toBe('EX')
    expect(setCall[3]).toBe(7_776_000) // 90 days
  })

  it('dual-writes to PostgreSQL (AC4)', async () => {
    const redis = makeRedis()
    const db: AnalyticsDb = {
      insertAnalyticsEvent: vi.fn().mockResolvedValue(undefined),
    }
    const hook = new AnalyticsHook(redis, db)

    await hook.onRequest(
      makeCtx({ payer: 'SP1', txid: 'tx1', amount: '100', token: 'STX' }),
    )
    await flushImmediate()

    expect(db.insertAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'test-server',
        toolName: 'get-price',
        payer: 'SP1',
        txid: 'tx1',
      }),
    )
  })

  it('hook error does not propagate (AC7)', async () => {
    const redis = makeRedis()
    // Make redis.incr throw inside setImmediate
    redis.incr = async () => {
      throw new Error('Redis down')
    }
    const hook = new AnalyticsHook(redis)

    // onRequest itself should not throw
    await expect(hook.onRequest(makeCtx())).resolves.toBeUndefined()
    // The setImmediate callback swallows the error via .catch(() => {})
    await flushImmediate()
  })

  it('uses setImmediate, not await — confirmed via spy (AC7)', async () => {
    const spy = vi.spyOn(globalThis, 'setImmediate')
    const redis = makeRedis()
    const hook = new AnalyticsHook(redis)

    await hook.onRequest(makeCtx())

    // setImmediate should have been called (at least once for Redis writes)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

// ─── AnalyticsHook — Error Rate Alerting (Story 3-4) ─────────────────────────

/**
 * Stateful mock Redis for error-rate alert tests.
 * Maintains actual counter values so GET returns meaningful data after INCR.
 */
function makeStatefulRedis() {
  const store = new Map<string, string>()
  const calls: Record<string, unknown[][]> = {}

  const track = (method: string) => {
    calls[method] = calls[method] ?? []
  }

  const redis: RedisLike & { calls: Record<string, unknown[][]>; store: Map<string, string> } = {
    calls,
    store,
    set: async (key: string, value: string, ...args: any[]) => {
      track('set')
      calls['set'].push([key, value, ...args])
      // Handle NX flag — only set if key doesn't exist
      const hasNX = args.includes('NX')
      if (hasNX && store.has(key)) return null
      store.set(key, value)
      return 'OK'
    },
    get: async (key: string) => {
      track('get')
      calls['get'].push([key])
      return store.get(key) ?? null
    },
    del: async (key: string) => {
      track('del')
      calls['del'].push([key])
      store.delete(key)
      return 1
    },
    scan: async (cursor: string, ...args: string[]) => {
      return ['0', []] as [string, string[]]
    },
    mget: async (...keys: string[]) => keys.map(k => store.get(k) ?? null),
    incr: async (key: string) => {
      track('incr')
      calls['incr'].push([key])
      const current = parseInt(store.get(key) ?? '0', 10)
      const next = current + 1
      store.set(key, String(next))
      return next
    },
    incrby: async (key: string, amount: number | string) => {
      track('incrby')
      calls['incrby'].push([key, amount])
      const current = parseInt(store.get(key) ?? '0', 10)
      const next = current + Number(amount)
      store.set(key, String(next))
      return next
    },
    pfadd: async () => 1,
    pfcount: async () => 0,
  } as RedisLike & { calls: Record<string, unknown[][]>; store: Map<string, string> }

  return redis
}

/** Longer flush for async chains (setImmediate → Promise.all → then). */
function flushAlertChain(): Promise<void> {
  return new Promise((resolve) => setImmediate(() => setTimeout(resolve, 50)))
}

describe('AnalyticsHook — Error Rate Alerting (Story 3-4)', () => {
  it('fires onAlert when error rate exceeds 10% threshold (AC1)', async () => {
    const redis = makeStatefulRedis()
    const onAlert = vi.fn()
    const hook = new AnalyticsHook(redis, undefined, onAlert)

    // Simulate 10 calls with 2 errors (20% error rate)
    for (let i = 0; i < 8; i++) {
      await hook.onRequest(makeCtx({ success: true }))
    }
    for (let i = 0; i < 2; i++) {
      await hook.onRequest(makeCtx({ success: false }))
    }
    await flushAlertChain()

    expect(onAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'test-server',
      }),
    )
    expect(onAlert.mock.calls[0][0].errorRate).toBeGreaterThan(0.10)
  })

  it('does NOT fire onAlert when error rate is below 10% (AC1)', async () => {
    const redis = makeStatefulRedis()
    const onAlert = vi.fn()
    const hook = new AnalyticsHook(redis, undefined, onAlert)

    // Simulate 20 calls with 1 error (5% error rate)
    for (let i = 0; i < 19; i++) {
      await hook.onRequest(makeCtx({ success: true }))
    }
    await hook.onRequest(makeCtx({ success: false }))
    await flushAlertChain()

    expect(onAlert).not.toHaveBeenCalled()
  })

  it('deduplicates alerts — max one per hour per server (AC3)', async () => {
    const redis = makeStatefulRedis()
    const onAlert = vi.fn()
    const hook = new AnalyticsHook(redis, undefined, onAlert)

    // First batch: 10 calls, 5 errors (50%) — triggers alert
    for (let i = 0; i < 5; i++) {
      await hook.onRequest(makeCtx({ success: true }))
    }
    for (let i = 0; i < 5; i++) {
      await hook.onRequest(makeCtx({ success: false }))
    }
    await flushAlertChain()

    const firstCallCount = onAlert.mock.calls.length
    expect(firstCallCount).toBe(1)

    // Second batch: more errors — should NOT fire again (NX key already set)
    for (let i = 0; i < 5; i++) {
      await hook.onRequest(makeCtx({ success: false }))
    }
    await flushAlertChain()

    expect(onAlert.mock.calls.length).toBe(firstCallCount) // Still 1
  })

  it('does NOT fire alert when sample size is too small (<10 calls)', async () => {
    const redis = makeStatefulRedis()
    const onAlert = vi.fn()
    const hook = new AnalyticsHook(redis, undefined, onAlert)

    // 3 calls, all errors (100% rate) — but too few samples
    for (let i = 0; i < 3; i++) {
      await hook.onRequest(makeCtx({ success: false }))
    }
    await flushAlertChain()

    expect(onAlert).not.toHaveBeenCalled()
  })

  it('alert does not block the request path (AC5)', async () => {
    const redis = makeStatefulRedis()
    const onAlert = vi.fn()
    const hook = new AnalyticsHook(redis, undefined, onAlert)

    // onRequest resolves immediately — does not await the alert chain
    const start = Date.now()
    await hook.onRequest(makeCtx({ success: false }))
    const elapsed = Date.now() - start

    // Should be near-instant (< 10ms) since all work is in setImmediate
    expect(elapsed).toBeLessThan(50)
  })

  it('writes rolling 1h counters with EX 3600 (FR56)', async () => {
    const redis = makeRedis()
    const hook = new AnalyticsHook(redis)

    await hook.onRequest(makeCtx({ success: false }))
    await flushImmediate()

    // Check 1h:calls SET NX
    const callSetNX = redis.calls['set'].find(
      (args: unknown[]) => args[0] === 'analytics:test-server:1h:calls',
    )
    expect(callSetNX).toBeDefined()
    expect(callSetNX).toEqual(['analytics:test-server:1h:calls', '0', 'EX', 3600, 'NX'])

    // Check 1h:errors SET NX (only on failed calls)
    const errSetNX = redis.calls['set'].find(
      (args: unknown[]) => args[0] === 'analytics:test-server:1h:errors',
    )
    expect(errSetNX).toBeDefined()
    expect(errSetNX).toEqual(['analytics:test-server:1h:errors', '0', 'EX', 3600, 'NX'])

    // Check 1h:calls INCR
    const call1hIncr = redis.calls['incr'].find(
      (args: unknown[]) => args[0] === 'analytics:test-server:1h:calls',
    )
    expect(call1hIncr).toBeDefined()

    // Check 1h:errors INCR
    const err1hIncr = redis.calls['incr'].find(
      (args: unknown[]) => args[0] === 'analytics:test-server:1h:errors',
    )
    expect(err1hIncr).toBeDefined()
  })
})

// ─── fireHooks pattern ───────────────────────────────────────────────────────

describe('Hook chain error isolation', () => {
  it('a throwing hook does not affect other hooks', async () => {
    const results: string[] = []

    const throwingHook = {
      onRequest: async () => {
        throw new Error('I explode')
      },
    }
    const goodHook = {
      onRequest: async (ctx: RequestContext) => {
        results.push(`called:${ctx.toolName}`)
      },
    }

    // Simulate fireHooks pattern from proxy.ts
    const hooks = [throwingHook, goodHook]
    for (const hook of hooks) {
      setImmediate(() => hook.onRequest(makeCtx()).catch(() => {}))
    }

    await flushImmediate()

    expect(results).toContain('called:get-price')
  })
})
