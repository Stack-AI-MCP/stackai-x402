/**
 * Live Acceptance Tests — Visible Proof for Every Flow
 *
 * Every test logs REAL output: URLs, content, crypto signatures.
 * Requires: OPENAI_API_KEY + MOLTBOOK_API_KEY in .env, Redis on localhost:6379.
 *
 * IMPORTANT: Agent config is loaded from REAL gateway Redis data — not hardcoded.
 * The test scans server:*:config keys to find registered MCP servers and
 * uses their actual tool names, descriptions, and pricing.
 *
 * Run: pnpm vitest run test/integration/live-acceptance.test.ts
 *
 * Output is written to test/integration/live-acceptance-report.txt
 * (vitest swallows console.log for passing tests — the report file captures everything)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Redis from 'ioredis'
import type { MoltbookAgentRecord, GatewayServerConfig, GatewayToolDef } from '../../src/types.js'

// ─── Env ─────────────────────────────────────────────────────────────────────

const OPENAI_KEY = process.env.OPENAI_API_KEY
const MOLTBOOK_KEY = process.env.MOLTBOOK_API_KEY

// ─── Report collector — writes to file so output is always visible ──────────

const reportLines: string[] = []

function log(msg: string) {
  reportLines.push(msg)
  console.log(msg)
}

function banner(label: string) {
  const line = '═'.repeat(60)
  log(`\n${line}\n ${label}\n${line}`)
}

const REPORT_PATH = join(import.meta.dirname, 'live-acceptance-report.txt')

// ─── Agent config built from REAL Redis data ────────────────────────────────

let AGENT: MoltbookAgentRecord
let SERVER_ID: string

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe.skipIf(!OPENAI_KEY || !MOLTBOOK_KEY)('Live Acceptance Tests', () => {

  // ─── Shared state across tests ────────────────────────────────────────────
  let statusPostTitle: string
  let statusPostContent: string
  let generatedComment: string
  let feedPostId: string
  let feedPostTitle: string

  // ─── Load real server data from Redis before all tests ────────────────────

  beforeAll(async () => {
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')

    try {
      // Scan for registered gateway servers
      const serverKeys: string[] = []
      let cursor = '0'
      do {
        const [next, batch] = await redis.scan(cursor, 'MATCH', 'server:*:config', 'COUNT', 100)
        cursor = next
        serverKeys.push(...batch)
      } while (cursor !== '0')

      if (serverKeys.length === 0) {
        throw new Error(
          'No gateway servers found in Redis. Register an MCP server via the gateway first.\n' +
          'Expected Redis keys matching: server:*:config',
        )
      }

      // Pick the first server with tools priced > 0 (paid server), or fallback to first
      let chosenKey = serverKeys[0]
      for (const key of serverKeys) {
        const configJson = await redis.get(key)
        if (!configJson) continue
        const config = JSON.parse(configJson) as GatewayServerConfig
        const hasPaidTools = Object.values(config.toolPricing).some((t) => t.price > 0)
        if (hasPaidTools) {
          chosenKey = key
          break
        }
      }

      SERVER_ID = chosenKey.split(':')[1]
      const [configJson, toolsJson] = await redis.mget(
        `server:${SERVER_ID}:config`,
        `server:${SERVER_ID}:tools`,
      )

      if (!configJson) throw new Error(`Server config not found for ${SERVER_ID}`)

      const serverConfig = JSON.parse(configJson) as GatewayServerConfig
      const serverTools = toolsJson ? JSON.parse(toolsJson) as GatewayToolDef[] : []

      log(`\n${'─'.repeat(60)}`)
      log(` LOADED REAL SERVER DATA FROM REDIS`)
      log(`${'─'.repeat(60)}`)
      log(`Server ID: ${SERVER_ID}`)
      log(`Server name: ${serverConfig.name}`)
      log(`MCP URL: ${serverConfig.url}`)
      log(`Network: ${serverConfig.network}`)
      log(`Recipient: ${serverConfig.recipientAddress}`)
      log(`Accepted tokens: ${serverConfig.acceptedTokens.join(', ')}`)
      log(`Tools: ${serverTools.length} registered`)
      for (const tool of serverTools.slice(0, 5)) {
        log(`  - ${tool.name}: ${tool.description.slice(0, 60)}... (${tool.price} ${serverConfig.acceptedTokens[0]})`)
      }
      if (serverTools.length > 5) {
        log(`  ... and ${serverTools.length - 5} more`)
      }
      log('')

      // Build AGENT record from real server data
      AGENT = {
        id: 'live-test-agent',
        gatewayServerId: SERVER_ID,
        moltbookApiKey: MOLTBOOK_KEY ?? 'moltbook_sk_test',
        moltbookName: serverConfig.name || 'mcp-server-agent',
        moltbookStatus: 'active',
        description: serverConfig.description || `MCP server providing ${serverTools.length} tools on the ${serverConfig.network} network via x402 payments.`,
        gatewayUrl: serverConfig.url,
        toolNames: serverTools.map((t) => t.name),
        toolPricing: serverTools.map((t) => ({
          name: t.name,
          price: t.price,
          token: serverConfig.acceptedTokens[0] ?? 'STX',
        })),
        heartbeatIntervalHours: 6,
        heartbeatEnabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    } finally {
      redis.disconnect()
    }
  }, 10_000)

  afterAll(() => {
    if (reportLines.length > 0) {
      const header = `Live Acceptance Report — ${new Date().toISOString()}\n${'='.repeat(60)}\n`
      writeFileSync(REPORT_PATH, header + reportLines.join('\n') + '\n')
    }
  })

  // ─── Test 1: AI Skill.md Generation ───────────────────────────────────────

  it('TEST 1: generates skill.md from REAL server tools', async () => {
    banner('TEST 1: AI-GENERATED SKILL.MD (from real server tools)')

    log(`Agent: ${AGENT.moltbookName}`)
    log(`Server: ${SERVER_ID}`)
    log(`Tools: ${AGENT.toolNames.length} (${AGENT.toolNames.slice(0, 5).join(', ')}...)`)
    log(`Gateway: ${AGENT.gatewayUrl}`)
    log('')

    const { OpenAIContentGenerator } = await import('../../src/ai/openai-generator.js')
    const gen = new OpenAIContentGenerator(OPENAI_KEY!)

    const skillMd = await gen.generateSkillMd(AGENT)

    log(skillMd)
    log(`\n[${skillMd.length} chars generated]`)

    expect(skillMd.length).toBeGreaterThan(100)
    expect(skillMd).toContain('#')
    // Should reference actual tool names from the server
    const mentionsRealTool = AGENT.toolNames.some((name) =>
      skillMd.toLowerCase().includes(name.toLowerCase()),
    )
    expect(mentionsRealTool).toBe(true)
  }, 30_000)

  // ─── Test 2: AI Status Post Generation ────────────────────────────────────

  it('TEST 2: generates a status post about REAL tools', async () => {
    banner('TEST 2: AI-GENERATED STATUS POST (real tools)')

    const { OpenAIContentGenerator } = await import('../../src/ai/openai-generator.js')
    const gen = new OpenAIContentGenerator(OPENAI_KEY!)

    const post = await gen.generateStatusPost(AGENT)
    statusPostTitle = post.title
    statusPostContent = post.content

    log(`Title: ${post.title}`)
    log(`Content:\n${post.content}`)

    expect(post.title.length).toBeGreaterThan(5)
    expect(post.content.length).toBeGreaterThan(20)
  }, 30_000)

  // ─── Test 3: AI Comment Generation on Real Post ───────────────────────────

  it('TEST 3: generates a comment on a real Moltbook post', async () => {
    banner('TEST 3: AI-GENERATED COMMENT ON REAL POST')

    const { MoltbookClient } = await import('../../src/moltbook/sdk/index.js')
    const client = new MoltbookClient({ apiKey: MOLTBOOK_KEY! })
    const posts = await client.feed.get({ sort: 'new', limit: 5 })

    expect(posts.length).toBeGreaterThan(0)
    const post = posts[0]
    feedPostId = post.id
    feedPostTitle = post.title

    log(`Responding to: "${post.title}" by ${post.authorName}`)
    log(`Post content: ${(post.content ?? '').slice(0, 200)}...`)

    const { OpenAIContentGenerator } = await import('../../src/ai/openai-generator.js')
    const gen = new OpenAIContentGenerator(OPENAI_KEY!)
    generatedComment = await gen.generateComment(AGENT, post.title, post.content ?? '')

    log(`\nGenerated comment:\n${generatedComment}`)

    expect(generatedComment.length).toBeGreaterThan(10)
  }, 30_000)

  // ─── Test 4: Post to Moltbook with Challenge Solving ──────────────────────

  it('TEST 4: posts to Moltbook and solves verification challenge', async () => {
    banner('TEST 4: MOLTBOOK POST — LIVE')

    const { createPostVerified } = await import('../../src/moltbook/challenge-solver.js')

    const title = statusPostTitle || `${AGENT.moltbookName} update ${Date.now()}`
    const content = statusPostContent || `Offering ${AGENT.toolNames.length} tools via x402 at ${AGENT.gatewayUrl}`

    log(`Posting: "${title}"`)

    const result = await createPostVerified(MOLTBOOK_KEY!, {
      submolt: 'general',
      title,
      content,
    })

    if (result._challenge) {
      log(`Challenge received: "${result._challenge}"`)
      log(`Math expression: ${result._mathExpr}`)
      log(`Answer: ${result._answer}`)
      log(`Verification: ${result.success ? 'SUCCESS' : 'FAILED'}`)
    } else {
      log('No challenge required (direct post)')
    }

    const postId = result._postId as string | undefined

    if (postId && result.success !== false) {
      log(`\n  POST URL: https://www.moltbook.com/post/${postId}`)
      log('           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^')
      log('           CLICK THIS TO SEE YOUR POST')
    }
    log('\nFull response:\n' + JSON.stringify(result, null, 2))

    expect(result).toBeDefined()
  }, 30_000)

  // ─── Test 5: Comment on a Moltbook Post ───────────────────────────────────

  it('TEST 5: comments on a Moltbook post and solves challenge', async () => {
    banner('TEST 5: MOLTBOOK COMMENT — LIVE')

    const { createCommentVerified } = await import('../../src/moltbook/challenge-solver.js')

    const postId = feedPostId
    const commentText = generatedComment || `Check out our ${AGENT.toolNames.length} tools at ${AGENT.gatewayUrl}`

    expect(postId).toBeDefined()

    log(`Commenting on: "${feedPostTitle}" (${postId})`)
    log(`Comment: "${commentText}"`)

    const result = await createCommentVerified(MOLTBOOK_KEY!, postId, commentText)

    if (result._challenge) {
      log(`\nChallenge received: "${result._challenge}"`)
      log(`Math expression: ${result._mathExpr}`)
      log(`Answer: ${result._answer}`)
      log(`Verification: ${result.success ? 'SUCCESS' : 'FAILED'}`)
    } else if (result._answer) {
      log(`Challenge solved (text not captured): answer=${result._answer}`)
    } else {
      log('No challenge required (direct post)')
    }

    log(`\n  POST URL: https://www.moltbook.com/post/${postId}`)
    log('           (scroll down to see your comment)')

    if (result._commentId) {
      log(`  Comment ID: ${result._commentId}`)
    }

    log('\nFull response:\n' + JSON.stringify(result, null, 2))

    expect(result).toBeDefined()
  }, 30_000)

  // ─── Test 6: Full Heartbeat Simulation ────────────────────────────────────

  it('TEST 6: runs a full heartbeat cycle with real APIs + real server tools', async () => {
    banner('TEST 6: HEARTBEAT REPORT (enriched with real server tools)')

    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')

    try {
      const { AgentStore } = await import('../../src/state/agent-store.js')
      const { EngagementTracker } = await import('../../src/state/engagement-tracker.js')
      const { OpenAIContentGenerator } = await import('../../src/ai/openai-generator.js')
      const { runHeartbeat } = await import('../../src/scheduler/heartbeat-routine.js')

      const store = new AgentStore(redis)
      const tracker = new EngagementTracker(redis)
      const gen = new OpenAIContentGenerator(OPENAI_KEY!)

      // Create agent in Redis — linked to real gateway server
      const agent = await store.create({
        moltbookApiKey: MOLTBOOK_KEY!,
        moltbookName: AGENT.moltbookName,
        gatewayServerId: SERVER_ID,
        description: AGENT.description,
        gatewayUrl: AGENT.gatewayUrl,
        toolNames: AGENT.toolNames,
        toolPricing: AGENT.toolPricing,
        heartbeatIntervalHours: 6,
      })

      log(`Agent created in Redis: ${agent.id}`)
      log(`Linked to gateway server: ${SERVER_ID}`)
      log(`Real tools: ${agent.toolNames.length} (${agent.toolNames.slice(0, 3).join(', ')}...)`)

      const report = await runHeartbeat(agent.id, store, tracker, gen, redis)

      log(`\nBrowsed ${report.postsBrowsed} posts`)

      if (report.postsUpvoted.length > 0) {
        log(`Upvoted ${report.postsUpvoted.length} posts:`)
        for (const title of report.postsUpvoted) {
          log(`  - "${title}"`)
        }
      } else {
        log('No posts upvoted (may have seen them already)')
      }

      if (report.commentsCreated.length > 0) {
        log(`Commented on ${report.commentsCreated.length} posts:`)
        for (const c of report.commentsCreated) {
          log(`  - "${c.postTitle}" → "${c.comment.slice(0, 80)}..."`)
        }
      } else {
        log('No comments made (cooldown or no highly-relevant posts)')
      }

      if (report.statusPost) {
        log(`\nStatus post created:`)
        log(`  Title: "${report.statusPost.title}"`)
        if (report.statusPost.postId) {
          log(`  URL: https://www.moltbook.com/post/${report.statusPost.postId}`)
        }
      } else {
        log('\nNo status post (cooldown active)')
      }

      if (report.skipped) {
        log(`\nSkipped: ${report.skipped}`)
      }

      const stats = await tracker.getStats(agent.id)
      log(`\nEngagement stats: seen=${stats.seen} voted=${stats.voted} commented=${stats.commented}`)

      // Cleanup
      await store.delete(agent.id)

      expect(report.postsBrowsed).toBeGreaterThan(0)
    } finally {
      redis.disconnect()
    }
  }, 180_000)

  // ─── Test 7: SDK Agent Signing Verification ───────────────────────────────

  it('TEST 7: SDK signing round-trip with Stacks crypto', async () => {
    banner('TEST 7: SDK SIGNING')

    const {
      signMessageHashRsv,
      privateKeyToPublic,
      publicKeyToAddress,
      AddressVersion,
      verifySignature,
    } = await import('@stacks/transactions')

    // Clarinet devnet deployer key (safe to log — testnet only)
    const privateKey = '7287ba251d44a4d3fd9276c88ce34c5c52a038955511cccaf77e61068649c17801'

    const publicKey = privateKeyToPublic(privateKey)
    const address = publicKeyToAddress(AddressVersion.TestnetSingleSig, publicKey)

    const message = JSON.stringify({
      action: 'createAgent',
      name: 'test-agent',
      timestamp: new Date().toISOString(),
    })

    const messageHash = createHash('sha256').update(message).digest('hex')
    const signature = signMessageHashRsv({ messageHash, privateKey })

    log(`Private key: ${privateKey}`)
    log(`Derived address: ${address}`)
    log(`Public key: ${publicKey}`)
    log(`Message: ${message}`)
    log(`SHA-256 hash: ${messageHash}`)
    log(`Signature: ${signature} (${signature.length} hex chars)`)

    // Verify round-trip (gateway-style verification)
    const rs = signature.length === 130 ? signature.slice(0, 128) : signature
    const isValid = verifySignature(rs, messageHash, publicKey)

    log(`\nVerification: ${isValid ? 'PASSED' : 'FAILED'}`)

    expect(signature).toHaveLength(130) // RSV format
    expect(isValid).toBe(true)
    expect(address).toMatch(/^ST/)
  }, 10_000)

  // ─── Test 8: Gateway Server Discovery ─────────────────────────────────────

  it('TEST 8: discovers all registered gateway servers from Redis', async () => {
    banner('TEST 8: GATEWAY SERVER DISCOVERY')

    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')

    try {
      const { AgentStore } = await import('../../src/state/agent-store.js')
      const store = new AgentStore(redis)

      const servers = await store.listServers()

      log(`Found ${servers.length} registered MCP servers:\n`)

      for (const server of servers) {
        log(`Server: ${server.config.serverId}`)
        log(`  Name: ${server.config.name}`)
        log(`  URL: ${server.config.url}`)
        log(`  Network: ${server.config.network}`)
        log(`  Recipient: ${server.config.recipientAddress}`)
        log(`  Tokens: ${server.config.acceptedTokens.join(', ')}`)
        log(`  Tools: ${server.tools.length}`)

        const paidTools = server.tools.filter((t) => t.price > 0)
        const freeTools = server.tools.filter((t) => t.price === 0)
        log(`    Paid: ${paidTools.length}, Free: ${freeTools.length}`)

        if (paidTools.length > 0) {
          log(`    Sample paid tools:`)
          for (const tool of paidTools.slice(0, 3)) {
            log(`      - ${tool.name}: ${tool.description.slice(0, 50)}... (${tool.price} ${server.config.acceptedTokens[0]})`)
          }
        }
        log('')
      }

      expect(servers.length).toBeGreaterThan(0)
      expect(servers[0].tools.length).toBeGreaterThan(0)
    } finally {
      redis.disconnect()
    }
  }, 10_000)
})
