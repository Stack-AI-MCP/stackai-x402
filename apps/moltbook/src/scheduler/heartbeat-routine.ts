/**
 * Heartbeat routine — browse feed, engage, post.
 * Follows the official Moltbook heartbeat pattern.
 */

import type { Redis } from 'ioredis'
import { MoltbookClient } from '../moltbook/sdk/index.js'
import { createPostVerified, createCommentVerified } from '../moltbook/challenge-solver.js'
import type { ContentGenerator } from '../ai/types.js'
import type { AgentStore } from '../state/agent-store.js'
import type { EngagementTracker } from '../state/engagement-tracker.js'
import { logger, errCtx } from '../logger.js'

const log = logger.child('heartbeat')

// Keywords that indicate a post is relevant to our agent's domain
const RELEVANCE_KEYWORDS = [
  'x402', 'stacks', 'bitcoin', 'defi', 'mcp', 'agent',
  'payment', 'sbtc', 'clarity', 'btc', 'ai', 'tool',
  'protocol', 'blockchain', 'web3', 'crypto',
]

const MAX_COMMENTS_PER_RUN = 3
const COMMENT_COOLDOWN_MS = 21_000 // 21 seconds between comments (Moltbook API limit)
const DEFAULT_SUBMOLT = 'general'

const MAX_CONSECUTIVE_403_BEFORE_BACKOFF = 3

function isRelevant(title: string, content?: string): boolean {
  const text = `${title} ${content ?? ''}`.toLowerCase()
  return RELEVANCE_KEYWORDS.some((kw) => text.includes(kw))
}

function isHighlyRelevant(title: string, content?: string): boolean {
  const text = `${title} ${content ?? ''}`.toLowerCase()
  const matchCount = RELEVANCE_KEYWORDS.filter((kw) => text.includes(kw)).length
  return matchCount >= 2
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)) }

/** Publish a notification to Redis for the gateway's notification worker to pick up. */
async function publishActivity(
  redisConn: Redis | undefined,
  gatewayAgentId: string | undefined,
  ownerAddress: string | undefined,
  action: 'posted' | 'commented' | 'upvoted',
  agentName: string,
  detail: string,
  postId?: string,
): Promise<void> {
  if (!redisConn || !gatewayAgentId) return
  try {
    await redisConn.publish('moltbook:activity', JSON.stringify({
      gatewayAgentId,
      ownerAddress,
      agentName,
      action,
      detail,
      postId,
      timestamp: Date.now(),
    }))
  } catch {
    // Non-critical — don't fail the heartbeat
  }
}

export interface HeartbeatReport {
  postsBrowsed: number
  postsUpvoted: string[]
  commentsCreated: Array<{ postTitle: string; comment: string }>
  statusPost?: { title: string; content: string; postId?: string }
  skipped?: string
}

/**
 * Run one heartbeat cycle for an agent.
 * Returns a report of actions taken (for logging/testing).
 */
export async function runHeartbeat(
  agentId: string,
  agentStore: AgentStore,
  tracker: EngagementTracker,
  contentGenerator: ContentGenerator,
  redis?: Redis,
): Promise<HeartbeatReport> {
  const report: HeartbeatReport = { postsBrowsed: 0, postsUpvoted: [], commentsCreated: [] }
  const agent = await agentStore.get(agentId)
  if (!agent) {
    log.warn('agent not found, skipping', { agentId })
    return { ...report, skipped: 'agent not found' }
  }

  if (!agent.heartbeatEnabled) return { ...report, skipped: 'heartbeat disabled' }

  // Enrich agent with real tool data from gateway Redis
  const enrichedAgent = await agentStore.enrichWithServerTools(agent)

  const client = new MoltbookClient({ apiKey: enrichedAgent.moltbookApiKey })

  // 1. Check status — skip if pending_claim
  try {
    const status = await client.agents.getStatus()
    if (status.status === 'pending_claim') {
      log.info('agent is pending_claim, skipping', { agent: agent.moltbookName })
      if (agent.moltbookStatus !== 'pending_claim') {
        await agentStore.setStatus(agentId, 'pending_claim')
        agent.moltbookStatus = 'pending_claim'
      }
      return { ...report, skipped: 'pending_claim' }
    }
    if (agent.moltbookStatus !== 'active') {
      await agentStore.setStatus(agentId, 'active')
      agent.moltbookStatus = 'active'
      log.info('agent claimed — status → active', { agent: agent.moltbookName })
    }
  } catch (err) {
    // Status check is non-critical — don't block the entire heartbeat.
    // The API key may still work for feed/upvote/comment even if /agents/status
    // returns 401 (CDN caching, endpoint-specific auth, etc.)
    log.warn('status check failed (continuing)', { agent: agent.moltbookName, ...errCtx(err) })
  }

  // 2. Browse feed
  let posts: Awaited<ReturnType<typeof client.feed.get>>
  try {
    posts = await client.feed.get({ sort: 'new', limit: 15 })
  } catch (err) {
    log.error('feed fetch failed', { agent: agent.moltbookName, ...errCtx(err) })
    return { ...report, skipped: 'feed fetch failed' }
  }

  report.postsBrowsed = posts.length

  // 3. Engage with posts — each post is independent, errors don't halt the loop
  let commentsMade = 0
  // Track CloudFront WAF 403s per-cycle — back off when rate-limited
  let consecutive403s = 0
  for (const post of posts) {
    try {
      // Skip posts without required fields
      if (!post.id || !post.title) continue

      // Skip already-seen posts
      if (await tracker.hasSeen(agentId, post.id)) continue
      await tracker.markSeen(agentId, post.id)

      // Check relevance
      if (!isRelevant(post.title, post.content)) continue

      // Upvote relevant posts
      if (!(await tracker.hasVoted(agentId, post.id))) {
        try {
          await client.posts.upvote(post.id)
          await tracker.markVoted(agentId, post.id)
          report.postsUpvoted.push(post.title)
          log.info('upvoted', { agent: agent.moltbookName, post: post.title.slice(0, 40) })

          // Notify owner via Telegram
          await publishActivity(redis, agent.gatewayAgentId, undefined, 'upvoted', agent.moltbookName, post.title.slice(0, 80), post.id)
        } catch (err) {
          log.warn('upvote failed', { postId: post.id, ...errCtx(err) })
        }
      }

      // Comment on highly relevant posts (with cooldown)
      // Skip if CloudFront WAF is rate-limiting us (consecutive 403s)
      if (
        isHighlyRelevant(post.title, post.content) &&
        commentsMade < MAX_COMMENTS_PER_RUN &&
        consecutive403s < MAX_CONSECUTIVE_403_BEFORE_BACKOFF &&
        !(await tracker.hasCommented(agentId, post.id)) &&
        (await tracker.canComment(agentId))
      ) {
        try {
          const commentText = await contentGenerator.generateComment(enrichedAgent, post.title, post.content ?? '')
          const commentResult = await createCommentVerified(enrichedAgent.moltbookApiKey, post.id, commentText)
          await tracker.markCommented(agentId, post.id)
          await tracker.markCommentedCooldown(agentId)
          commentsMade++
          consecutive403s = 0 // Reset on success
          report.commentsCreated.push({ postTitle: post.title, comment: commentText, ...( commentResult._postId ? { postId: commentResult._postId as string } : {}) })
          log.info('commented', { agent: agent.moltbookName, post: post.title.slice(0, 40) })

          // Notify owner via Telegram (link to the actual post)
          await publishActivity(redis, agent.gatewayAgentId, undefined, 'commented', agent.moltbookName, post.title.slice(0, 80), post.id)

          // Respect rate limit
          if (commentsMade < MAX_COMMENTS_PER_RUN) {
            await sleep(COMMENT_COOLDOWN_MS)
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          if (errMsg.includes('403') || errMsg.includes('block')) {
            consecutive403s++
            log.warn('comment 403 backoff', { agent: agent.moltbookName, consecutive403s, backingOff: consecutive403s >= MAX_CONSECUTIVE_403_BEFORE_BACKOFF })
          }
          log.error('comment FAILED', { postId: post.id, postTitle: post.title?.slice(0, 40), ...errCtx(err) })
        }
      }
    } catch (err) {
      log.warn('error processing post', { postId: post.id, ...errCtx(err) })
    }
  }

  // 4. Post status update if cooldown allows
  const postAllowed = await tracker.canPost(agentId)
  log.info('post cooldown check', { agent: agent.moltbookName, canPost: postAllowed })
  if (postAllowed) {
    try {
      const { title, content } = await contentGenerator.generateStatusPost(enrichedAgent)
      const postResult = await createPostVerified(enrichedAgent.moltbookApiKey, {
        submolt: DEFAULT_SUBMOLT,
        title,
        content,
      })
      await tracker.markPosted(agentId)
      const postId = postResult._postId as string | undefined
      report.statusPost = { title, content, postId }
      log.info('posted status update', { agent: agent.moltbookName, postId })

      // Notify owner via Telegram (link to the actual post)
      await publishActivity(redis, agent.gatewayAgentId, undefined, 'posted', agent.moltbookName, title.slice(0, 80), postId)
    } catch (err) {
      log.error('status post FAILED', { agent: agent.moltbookName, ...errCtx(err) })
    }
  }

  // 5. Update timestamps
  const nextHb = new Date(Date.now() + agent.heartbeatIntervalHours * 60 * 60 * 1000).toISOString()
  await agentStore.setLastHeartbeat(agentId, nextHb)

  // 6. Write gateway status if agent is linked to a gateway agent
  if (agent.gatewayAgentId && redis) {
    try {
      const stats = await tracker.getStats(agentId)
      const statusData = {
        moltbookAgentId: agentId,
        moltbookStatus: agent.moltbookStatus,
        heartbeatRunning: true,
        lastHeartbeat: new Date().toISOString(),
        engagement: stats,
      }
      await redis.set(
        `moltbook:status:${agent.gatewayAgentId}`,
        JSON.stringify(statusData),
        'EX',
        60 * 60 * 24 * 30,
      )
    } catch (err) {
      log.warn('status sync failed', errCtx(err))
    }
  }

  log.info('cycle complete', { agent: agent.moltbookName, postsBrowsed: posts.length, commentsMade })

  return report
}
