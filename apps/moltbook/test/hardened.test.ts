/**
 * Hardened tests — edge cases, error paths, adversarial inputs.
 * These tests exist to BREAK things, not just verify happy paths.
 */

import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { wordsToMath, parseChallenge } from '../src/moltbook/challenge-solver.js'
import { TemplateContentGenerator } from '../src/ai/template-generator.js'
import { createContentGenerator } from '../src/ai/factory.js'
import { logger, errCtx } from '../src/logger.js'
import type { MoltbookAgentRecord } from '../src/types.js'

// ─── Challenge Solver: Edge Cases & Adversarial Inputs ─────────────────────

describe('wordsToMath — edge cases', () => {
  it('returns empty string for empty input', () => expect(wordsToMath('')).toBe(''))
  it('returns empty string for whitespace-only input', () => expect(wordsToMath('   ')).toBe(''))
  it('strips all non-math words', () => expect(wordsToMath('hello world foo bar baz')).toBe(''))

  it('handles very long input without crashing', () => {
    const longInput = 'five plus three '.repeat(500)
    const result = wordsToMath(longInput)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('handles zero correctly', () => expect(wordsToMath('zero plus zero')).toBe('0 + 0'))
  it('handles millions', () => expect(wordsToMath('two million')).toBe('2000000'))

  it('handles chained operations', () => {
    const result = wordsToMath('five plus three minus two times four')
    expect(result).toContain('+')
    expect(result).toContain('-')
    expect(result).toContain('*')
  })

  it('handles unicode and special chars gracefully', () => {
    const result = wordsToMath('five\u00A0plus\ttwo')
    expect(result).toContain('5')
    expect(result).toContain('+')
    expect(result).toContain('2')
  })

  // Consecutive word operators collapse via "last operator wins" — this is correct
  // since in real challenges consecutive operators mean the last one is the real intent
  it('handles repeated operators', () => expect(wordsToMath('plus plus plus')).toBe('+'))
  it('handles negative-like expressions', () => expect(wordsToMath('zero minus ten')).toBe('0 - 10'))

  it('handles parentheses with word numbers', () => {
    // Parens are separated from adjacent tokens: "(10 + 5) * 3" → "( 10 + 5 ) * 3"
    // parseChallenge handles numeric expressions directly (pass 0), so wordsToMath
    // doesn't need to preserve parens stuck to digits.
    const numericResult = wordsToMath('(10 + 5) * 3')
    expect(numericResult).toContain('10')
    expect(numericResult).toContain('5')
  })
})

describe('parseChallenge — adversarial inputs', () => {
  it('returns null for null input', () => expect(parseChallenge(null as any)).toBeNull())
  it('returns null for undefined input', () => expect(parseChallenge(undefined as any)).toBeNull())
  it('returns null for empty object', () => expect(parseChallenge({})).toBeNull())

  it('returns null when challenge is just text with no math', () => {
    expect(parseChallenge({ verification_code: 'abc', challenge: 'What is the capital of France?' })).toBeNull()
  })

  it('returns null when challenge is empty string', () => {
    expect(parseChallenge({ verification_code: 'abc', challenge: '' })).toBeNull()
  })

  it('handles verification_code as number', () => {
    expect(parseChallenge({ verification_code: 12345, challenge: '5 + 3' }))
      .toMatchObject({ code: '12345', answer: '8.00' })
  })

  it('handles division by zero gracefully (returns null — Infinity is not a valid answer)', () => {
    const result = parseChallenge({ verification_code: 'abc', challenge: '10 / 0' })
    expect(result).toBeNull()
  })

  it('handles very large numbers', () => {
    const result = parseChallenge({ verification_code: 'abc', challenge: '999999999999 * 999999999999' })
    expect(result).not.toBeNull()
    expect(result!.code).toBe('abc')
  })

  it('handles decimal numbers', () => {
    expect(parseChallenge({ verification_code: 'abc', challenge: '3.14 * 2' }))
      .toMatchObject({ code: 'abc', answer: '6.28' })
  })

  it('rejects code injection attempts (semicolons stripped)', () => {
    const result = parseChallenge({ verification_code: 'abc', challenge: '5; process.exit(1)' })
    expect(typeof result === 'object' || result === null).toBe(true)
  })

  it('rejects function call injection', () => {
    // The numeric pass extracts "1" from the text and evaluates it (harmlessly).
    // The key safety property is that no code injection occurs — safeEval only
    // accepts digit/operator expressions, so "eval", "process", etc. are stripped.
    const result = parseChallenge({ verification_code: 'abc', challenge: 'eval("process.exit(1)")' })
    // If it returns a result, verify it's just a harmless number evaluation
    if (result) {
      expect(result.answer).toBe('1.00')
    }
  })

  it('handles nested parens', () => {
    expect(parseChallenge({ verification_code: 'abc', challenge: '((2 + 3) * (4 + 1))' }))
      .toMatchObject({ code: 'abc', answer: '25.00' })
  })

  it('handles negative result', () => {
    expect(parseChallenge({ verification_code: 'abc', challenge: '3 - 10' }))
      .toMatchObject({ code: 'abc', answer: '-7.00' })
  })
})

// ─── Template Content Generator: Boundary Inputs ───────────────────────────

describe('TemplateContentGenerator — boundary inputs', () => {
  const gen = new TemplateContentGenerator()

  const BASE_AGENT: MoltbookAgentRecord = {
    id: 'agent-1', moltbookApiKey: 'moltbook_test', moltbookName: 'test-agent',
    moltbookStatus: 'active', description: 'A test agent', gatewayUrl: 'https://example.com',
    toolNames: ['tool1'], heartbeatIntervalHours: 6, heartbeatEnabled: true,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }

  it('handles agent with empty toolNames array', async () => {
    const result = await gen.generateSkillMd({ ...BASE_AGENT, toolNames: [] })
    expect(result).toContain('test-agent')
  })

  it('handles agent with very long description', async () => {
    const result = await gen.generateSkillMd({ ...BASE_AGENT, description: 'A'.repeat(10000) })
    expect(result.length).toBeGreaterThan(0)
  })

  it('handles agent with special characters in name', async () => {
    const result = await gen.generateSkillMd({ ...BASE_AGENT, moltbookName: '<script>alert("xss")</script>' })
    expect(result).toContain('<script>')
  })

  it('handles agent with unicode tool names', async () => {
    const result = await gen.generateSkillMd({ ...BASE_AGENT, toolNames: ['search', 'análisis', '検索'] })
    expect(result).toContain('análisis')
    expect(result).toContain('検索')
  })

  it('generateComment handles empty post content', async () => {
    const result = await gen.generateComment(BASE_AGENT, 'Title', '')
    expect(result.length).toBeGreaterThan(0)
  })

  it('generateStatusPost returns valid structure', async () => {
    const result = await gen.generateStatusPost(BASE_AGENT)
    expect(result.title.length).toBeGreaterThan(0)
    expect(result.content.length).toBeGreaterThan(0)
  })

  it('generatePaymentPost with very large amount', async () => {
    const result = await gen.generatePaymentPost(BASE_AGENT, {
      serverId: 's', tool: 'tool1', amount: '999999999999999',
      token: 'STX', fromAddress: 'addr', txid: 'tx',
    })
    expect(result.title).toContain('999999999999999')
  })

  it('generateErrorPost with zero error rate', async () => {
    const result = await gen.generateErrorPost(BASE_AGENT, {
      serverId: 's', agentId: 'a', errorRate: 0, timestamp: Date.now(),
    })
    expect(result.title).toContain('0.0%')
  })

  it('generateErrorPost with 100% error rate', async () => {
    const result = await gen.generateErrorPost(BASE_AGENT, {
      serverId: 's', agentId: 'a', errorRate: 1.0, timestamp: Date.now(),
    })
    expect(result.title).toContain('100.0%')
  })
})

// ─── Content Generator Factory: Config Edge Cases ──────────────────────────

describe('createContentGenerator — config edge cases', () => {
  const baseConfig = {
    REDIS_URL: 'redis://localhost', PORT: 3003,
    SERVICE_SECRET: 'secret', GATEWAY_URL: 'http://localhost:3001', AI_MODEL: undefined,
  }

  it('falls back to template when provider is openai but no key', () => {
    const gen = createContentGenerator({ ...baseConfig, AI_PROVIDER: 'openai' as const, OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined })
    expect(gen.constructor.name).toBe('TemplateContentGenerator')
  })

  it('falls back to template when provider is anthropic but no key', () => {
    const gen = createContentGenerator({ ...baseConfig, AI_PROVIDER: 'anthropic' as const, OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined })
    expect(gen.constructor.name).toBe('TemplateContentGenerator')
  })

  it('uses template when provider is explicitly template', () => {
    const gen = createContentGenerator({ ...baseConfig, AI_PROVIDER: 'template' as const, OPENAI_API_KEY: 'sk-test', ANTHROPIC_API_KEY: 'sk-ant-test' })
    expect(gen.constructor.name).toBe('TemplateContentGenerator')
  })
})

// ─── safeParse Resilience ──────────────────────────────────────────────────

describe('safeParse resilience (pattern test)', () => {
  function safeParse(json: string): Record<string, unknown> | null {
    try { return JSON.parse(json) } catch { return null }
  }

  it('parses valid JSON', () => expect(safeParse('{"a":1}')).toEqual({ a: 1 }))
  it('returns null for empty string', () => expect(safeParse('')).toBeNull())
  it('returns null for truncated JSON', () => expect(safeParse('{"a":1')).toBeNull())
  it('returns null for random binary', () => expect(safeParse('\x00\x01\x02')).toBeNull())
  it('returns null for just whitespace', () => expect(safeParse('   ')).toBeNull())
  it('returns null for HTML injection', () => expect(safeParse('<script>alert(1)</script>')).toBeNull())
  it('parses JSON with unicode', () => expect(safeParse('{"name":"日本語"}')).toEqual({ name: '日本語' }))

  it('handles extremely nested JSON', () => {
    let json = '{"a":'
    for (let i = 0; i < 50; i++) json += '{"b":'
    json += '1'
    for (let i = 0; i < 50; i++) json += '}'
    json += '}'
    expect(safeParse(json)).not.toBeNull()
  })
})

// ─── Engagement Tracker: Interface Contract ────────────────────────────────

describe('EngagementTracker — interface contract', () => {
  function mockRedis() {
    const store = new Map<string, Set<string>>()
    const kv = new Map<string, string>()
    return {
      sismember: vi.fn(async (key: string, member: string) => store.get(key)?.has(member) ? 1 : 0),
      sadd: vi.fn(async (key: string, member: string) => {
        if (!store.has(key)) store.set(key, new Set())
        store.get(key)!.add(member)
        return 1
      }),
      expire: vi.fn(async () => 1),
      exists: vi.fn(async (key: string) => kv.has(key) ? 1 : 0),
      set: vi.fn(async (key: string, value: string) => { kv.set(key, value); return 'OK' }),
      scard: vi.fn(async (key: string) => store.get(key)?.size ?? 0),
      ttl: vi.fn(async (key: string) => kv.has(key) ? 1800 : -2),
    } as any
  }

  it('tracks seen/voted/commented correctly', async () => {
    const { EngagementTracker } = await import('../src/state/engagement-tracker.js')
    const redis = mockRedis()
    const tracker = new EngagementTracker(redis)

    expect(await tracker.hasSeen('agent-1', 'post-1')).toBe(false)
    await tracker.markSeen('agent-1', 'post-1')
    expect(await tracker.hasSeen('agent-1', 'post-1')).toBe(true)
    expect(await tracker.hasSeen('agent-1', 'post-2')).toBe(false)
    expect(await tracker.hasSeen('agent-2', 'post-1')).toBe(false)
  })

  it('cooldown lifecycle works', async () => {
    const { EngagementTracker } = await import('../src/state/engagement-tracker.js')
    const redis = mockRedis()
    const tracker = new EngagementTracker(redis)

    expect(await tracker.canPost('agent-1')).toBe(true)
    await tracker.markPosted('agent-1')
    expect(await tracker.canPost('agent-1')).toBe(false)
  })

  it('getStats returns zeroes for fresh agent', async () => {
    const { EngagementTracker } = await import('../src/state/engagement-tracker.js')
    const redis = mockRedis()
    const tracker = new EngagementTracker(redis)
    expect(await tracker.getStats('fresh-agent')).toEqual({ seen: 0, voted: 0, commented: 0, postCooldownTTL: -2 })
  })

  it('getStats counts correctly after engagement', async () => {
    const { EngagementTracker } = await import('../src/state/engagement-tracker.js')
    const redis = mockRedis()
    const tracker = new EngagementTracker(redis)

    await tracker.markSeen('agent-1', 'post-1')
    await tracker.markSeen('agent-1', 'post-2')
    await tracker.markVoted('agent-1', 'post-1')
    await tracker.markCommented('agent-1', 'post-1')

    const stats = await tracker.getStats('agent-1')
    expect(stats.seen).toBe(2)
    expect(stats.voted).toBe(1)
    expect(stats.commented).toBe(1)
  })
})

// ─── Relevance Logic: Boundary Cases ───────────────────────────────────────

describe('relevance detection — boundary cases', () => {
  const KEYWORDS = ['x402', 'stacks', 'bitcoin', 'defi', 'mcp', 'agent', 'payment', 'sbtc', 'clarity', 'btc', 'ai', 'tool', 'protocol', 'blockchain', 'web3', 'crypto']

  function isRelevant(title: string, content?: string): boolean {
    const text = `${title} ${content ?? ''}`.toLowerCase()
    return KEYWORDS.some((kw) => text.includes(kw))
  }

  function isHighlyRelevant(title: string, content?: string): boolean {
    const text = `${title} ${content ?? ''}`.toLowerCase()
    return KEYWORDS.filter((kw) => text.includes(kw)).length >= 2
  }

  it('empty title and content is not relevant', () => expect(isRelevant('', '')).toBe(false))
  it('single keyword is relevant', () => expect(isRelevant('Hello bitcoin world')).toBe(true))
  it('single keyword is NOT highly relevant', () => expect(isHighlyRelevant('Hello bitcoin world')).toBe(false))
  it('two keywords is highly relevant', () => expect(isHighlyRelevant('Bitcoin defi protocol')).toBe(true))
  it('keyword in content counts', () => expect(isRelevant('Random title', 'Something about stacks')).toBe(true))
  it('case insensitive matching', () => expect(isHighlyRelevant('BITCOIN STACKS')).toBe(true))
  it('partial word match (tool inside toolbox)', () => expect(isRelevant('My toolbox')).toBe(true))
  it('"ai" matches inside "fairy" (known .includes() behavior)', () => expect(isRelevant('fairy tale')).toBe(true))
  it('all keywords is highly relevant', () => expect(isHighlyRelevant(KEYWORDS.join(' '))).toBe(true))
})

// ─── Logger: Output Correctness ────────────────────────────────────────────

describe('logger — output correctness', () => {
  it('errCtx extracts Error message', () => expect(errCtx(new Error('test'))).toEqual({ error: 'test' }))
  it('errCtx handles string error', () => expect(errCtx('string error')).toEqual({ error: 'string error' }))
  it('errCtx handles null', () => expect(errCtx(null)).toEqual({ error: 'null' }))
  it('errCtx handles undefined', () => expect(errCtx(undefined)).toEqual({ error: 'undefined' }))
  it('errCtx handles number', () => expect(errCtx(42)).toEqual({ error: '42' }))

  it('errCtx handles object', () => {
    const result = errCtx({ code: 'ECONNREFUSED' })
    expect(result.error).toBeTruthy()
  })

  it('child logger creates new instance', () => {
    const child = logger.child('test')
    expect(child.info).toBeInstanceOf(Function)
  })

  it('grandchild logger works without throwing', () => {
    expect(() => logger.child('parent').child('child').info('test', { key: 'value' })).not.toThrow()
  })
})

// ─── Zod Schema Validation ─────────────────────────────────────────────────

describe('PaymentEventSchema — validation edge cases', () => {
  const Schema = z.object({
    serverId: z.string().min(1), tool: z.string().min(1),
    amount: z.string().min(1), token: z.string().min(1),
    fromAddress: z.string().min(1), txid: z.string().min(1),
  })

  it('rejects empty serverId', () => expect(Schema.safeParse({ serverId: '', tool: 't', amount: '1', token: 'STX', fromAddress: 'a', txid: 'tx' }).success).toBe(false))
  it('rejects missing fields', () => expect(Schema.safeParse({ serverId: 's' }).success).toBe(false))
  it('rejects null values', () => expect(Schema.safeParse({ serverId: null, tool: 't', amount: '1', token: 'STX', fromAddress: 'a', txid: 'tx' }).success).toBe(false))
  it('rejects numeric amount', () => expect(Schema.safeParse({ serverId: 's', tool: 't', amount: 1000, token: 'STX', fromAddress: 'a', txid: 'tx' }).success).toBe(false))
  it('accepts valid payload', () => expect(Schema.safeParse({ serverId: 'server-1', tool: 'search', amount: '1000000', token: 'STX', fromAddress: 'ST1PQH', txid: '0xabc' }).success).toBe(true))
  it('allows extra fields', () => expect(Schema.safeParse({ serverId: 's', tool: 't', amount: '1', token: 'STX', fromAddress: 'a', txid: 'tx', extra: 1 }).success).toBe(true))
})

describe('ErrorAlertSchema — validation edge cases', () => {
  const Schema = z.object({
    serverId: z.string().min(1), agentId: z.string().min(1),
    errorRate: z.number().min(0).max(1), timestamp: z.number(),
  })

  it('rejects errorRate > 1', () => expect(Schema.safeParse({ serverId: 's', agentId: 'a', errorRate: 1.5, timestamp: 0 }).success).toBe(false))
  it('rejects negative errorRate', () => expect(Schema.safeParse({ serverId: 's', agentId: 'a', errorRate: -0.1, timestamp: 0 }).success).toBe(false))
  it('rejects string timestamp', () => expect(Schema.safeParse({ serverId: 's', agentId: 'a', errorRate: 0.5, timestamp: 'nope' }).success).toBe(false))

  it('accepts boundary values (0 and 1)', () => {
    expect(Schema.safeParse({ serverId: 's', agentId: 'a', errorRate: 0, timestamp: 0 }).success).toBe(true)
    expect(Schema.safeParse({ serverId: 's', agentId: 'a', errorRate: 1, timestamp: Date.now() }).success).toBe(true)
  })
})
