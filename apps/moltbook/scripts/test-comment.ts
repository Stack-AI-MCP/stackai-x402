/**
 * Test script: posts a comment on a recent Moltbook feed post.
 * Tests the curl-based WAF bypass for POST requests with JSON body.
 *
 * Usage: pnpm tsx scripts/test-comment.ts
 *
 * Reads MOLTBOOK_API_KEY from env or from Redis (first agent found).
 */

import { execSync } from 'node:child_process'
import { Redis } from 'ioredis'
import { createCommentVerified } from '../src/moltbook/challenge-solver.js'

const MOLTBOOK_API_BASE = 'https://www.moltbook.com/api/v1'

async function getApiKey(): Promise<string> {
  if (process.env.MOLTBOOK_API_KEY) {
    console.log('[key] Using MOLTBOOK_API_KEY from environment')
    return process.env.MOLTBOOK_API_KEY
  }

  console.log('[key] Scanning Redis for a registered agent...')
  const redis = new Redis({ host: '127.0.0.1', port: 6379, lazyConnect: true })
  try {
    await redis.connect()
    let cursor = '0'
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'moltbook:agent:*:config', 'COUNT', 50)
      cursor = next
      for (const key of keys) {
        const json = await redis.get(key)
        if (!json) continue
        const agent = JSON.parse(json) as { moltbookApiKey?: string; moltbookName?: string }
        if (agent.moltbookApiKey) {
          console.log(`[key] Found agent: @${agent.moltbookName ?? '?'}`)
          return agent.moltbookApiKey
        }
      }
    } while (cursor !== '0')
  } finally {
    redis.disconnect()
  }

  throw new Error('No MOLTBOOK_API_KEY found in env or Redis. Set MOLTBOOK_API_KEY=moltbook_...')
}

function fetchFeed(apiKey: string): Array<{ id: string; title: string }> {
  // Use curl to bypass WAF (same TLS fingerprint issue as POST)
  const result = execSync(
    `curl -s -w "\\n%{http_code}" "${MOLTBOOK_API_BASE}/feed?sort=new&limit=10" ` +
    `-H "Content-Type: application/json" ` +
    `-H "Authorization: Bearer ${apiKey}"`,
    { timeout: 30_000, encoding: 'utf-8', maxBuffer: 1024 * 1024 },
  )

  const lines = result.trimEnd().split('\n')
  const statusCode = lines.pop()
  const body = lines.join('\n')
  if (!body.startsWith('[') && !body.startsWith('{')) {
    throw new Error(`Feed returned non-JSON (${statusCode}): ${body.slice(0, 200)}`)
  }

  const data = JSON.parse(body)
  const posts = Array.isArray(data) ? data : (data.posts ?? data.data ?? [])
  return posts as Array<{ id: string; title: string }>
}

/** Raw curl test to compare with createCommentVerified */
function testCurlDirect(apiKey: string, postId: string, content: string): void {
  console.log('\n[curl-test] Testing raw curl POST...')
  const body = JSON.stringify({ content })
  try {
    const result = execSync(
      `curl -s -w "\\n%{http_code}" -X POST "${MOLTBOOK_API_BASE}/posts/${postId}/comments" ` +
      `-H "Content-Type: application/json" ` +
      `-H "Authorization: Bearer ${apiKey}" ` +
      `--data-binary @-`,
      { input: body, timeout: 30_000, encoding: 'utf-8' },
    )
    const lines = result.trimEnd().split('\n')
    const status = lines.pop()
    const responseBody = lines.join('\n')
    console.log(`[curl-test] Status: ${status}`)
    console.log(`[curl-test] Response: ${responseBody.slice(0, 500)}`)
  } catch (err) {
    console.error('[curl-test] FAILED:', err instanceof Error ? err.message.slice(0, 200) : err)
  }
}

async function main() {
  const apiKey = await getApiKey()
  console.log(`[api] API key: ${apiKey.slice(0, 12)}...`)

  // Fetch feed
  console.log('[feed] Fetching recent posts...')
  const posts = fetchFeed(apiKey)
  if (posts.length === 0) {
    console.error('[feed] No posts found in feed')
    process.exit(1)
  }

  const target = posts[0]
  console.log(`[feed] Target post: "${target.title}" (id: ${target.id})`)

  const commentText = 'Testing from stacksgateway - verifying API integration.'

  // Test 1: Raw curl (for comparison)
  testCurlDirect(apiKey, target.id, commentText)

  // Test 2: createCommentVerified (now uses curl internally)
  console.log('\n[createCommentVerified] Testing via challenge-solver...')
  try {
    const result = await createCommentVerified(apiKey, target.id, commentText + ' (verified)')
    console.log('[createCommentVerified] SUCCESS!')
    console.log('[createCommentVerified] Response:', JSON.stringify(result, null, 2))
  } catch (err) {
    console.error('[createCommentVerified] FAILED:', err instanceof Error ? err.message : err)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
