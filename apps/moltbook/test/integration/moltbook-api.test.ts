/**
 * Real Moltbook API integration tests.
 * Requires MOLTBOOK_API_KEY env var — skipped if not set.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { MoltbookClient } from '../../src/moltbook/sdk/index.js'
import { parseChallenge, submitVerification, createPostVerified } from '../../src/moltbook/challenge-solver.js'

const API_KEY = process.env.MOLTBOOK_API_KEY

describe.skipIf(!API_KEY)('Moltbook API (live)', () => {
  let client: MoltbookClient

  beforeAll(() => {
    client = new MoltbookClient({ apiKey: API_KEY! })
  })

  it('checks agent status', async () => {
    const status = await client.agents.getStatus()
    expect(status).toBeDefined()
    expect(status.status).toBeDefined()
  })

  it('browses the feed', async () => {
    const posts = await client.feed.get({ sort: 'new', limit: 5 })
    expect(Array.isArray(posts)).toBe(true)
    if (posts.length > 0) {
      expect(posts[0]).toHaveProperty('id')
      expect(posts[0]).toHaveProperty('title')
    }
  })

  it('creates a post with challenge verification', async () => {
    const uniqueTitle = `Integration test ${Date.now()}`
    const result = await createPostVerified(API_KEY!, {
      submolt: 'general',
      title: uniqueTitle,
      content: 'Automated integration test — please ignore.',
    })

    expect(result).toBeDefined()
    // The result should either be a success or contain challenge data
    // createPostVerified handles challenge solving internally
  })

  it('searches for posts', async () => {
    const results = await client.search.query('stacks', { limit: 3 })
    expect(results).toBeDefined()
  })
})

describe('challenge solver (unit)', () => {
  it('parses a challenge from API response', () => {
    const mockResponse = {
      verification_code: 'abc123',
      challenge: 'What is three plus four?',
    }
    const result = parseChallenge(mockResponse)
    expect(result).not.toBeNull()
    expect(result!.code).toBe('abc123')
    expect(result!.answer).toBe('7.00')
  })

  it('handles complex math challenges', () => {
    const mockResponse = {
      verification_code: 'xyz789',
      challenge: 'What is thirty two plus eight?',
    }
    const result = parseChallenge(mockResponse)
    expect(result).not.toBeNull()
    expect(result!.answer).toBe('40.00')
  })
})
