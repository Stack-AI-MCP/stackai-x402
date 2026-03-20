/**
 * Redis SET-based dedup for tracking which posts an agent has seen/voted/commented.
 */

import type { Redis } from 'ioredis'

const PREFIX = 'moltbook:agent'

// TTLs
const SEEN_TTL = 60 * 60 * 24 * 7     // 7 days
const VOTED_TTL = 60 * 60 * 24 * 30   // 30 days
const COMMENTED_TTL = 60 * 60 * 24 * 30 // 30 days
const COOLDOWN_TTL = 60 * 60           // 1 hour

export class EngagementTracker {
  constructor(private redis: Redis) {}

  // ─── Seen ──────────────────────────────────────────────────────────

  async hasSeen(agentId: string, postId: string): Promise<boolean> {
    return (await this.redis.sismember(`${PREFIX}:${agentId}:seen`, postId)) === 1
  }

  async markSeen(agentId: string, postId: string): Promise<void> {
    const key = `${PREFIX}:${agentId}:seen`
    await this.redis.sadd(key, postId)
    await this.redis.expire(key, SEEN_TTL)
  }

  // ─── Voted ─────────────────────────────────────────────────────────

  async hasVoted(agentId: string, postId: string): Promise<boolean> {
    return (await this.redis.sismember(`${PREFIX}:${agentId}:voted`, postId)) === 1
  }

  async markVoted(agentId: string, postId: string): Promise<void> {
    const key = `${PREFIX}:${agentId}:voted`
    await this.redis.sadd(key, postId)
    await this.redis.expire(key, VOTED_TTL)
  }

  // ─── Commented ─────────────────────────────────────────────────────

  async hasCommented(agentId: string, postId: string): Promise<boolean> {
    return (await this.redis.sismember(`${PREFIX}:${agentId}:commented`, postId)) === 1
  }

  async markCommented(agentId: string, postId: string): Promise<void> {
    const key = `${PREFIX}:${agentId}:commented`
    await this.redis.sadd(key, postId)
    await this.redis.expire(key, COMMENTED_TTL)
  }

  // ─── Cooldowns ─────────────────────────────────────────────────────

  async canPost(agentId: string): Promise<boolean> {
    return !(await this.redis.exists(`${PREFIX}:${agentId}:lastPost`))
  }

  async markPosted(agentId: string): Promise<void> {
    // 30-minute post cooldown
    await this.redis.set(`${PREFIX}:${agentId}:lastPost`, Date.now().toString(), 'EX', 1800)
  }

  async canComment(agentId: string): Promise<boolean> {
    return !(await this.redis.exists(`${PREFIX}:${agentId}:lastComment`))
  }

  async markCommentedCooldown(agentId: string): Promise<void> {
    // 21-second comment cooldown (respecting 20-sec API limit + 1s buffer)
    await this.redis.set(`${PREFIX}:${agentId}:lastComment`, Date.now().toString(), 'EX', 21)
  }

  // ─── Stats ─────────────────────────────────────────────────────────

  async getStats(agentId: string): Promise<{ seen: number; voted: number; commented: number; postCooldownTTL: number }> {
    const [seen, voted, commented, postCooldownTTL] = await Promise.all([
      this.redis.scard(`${PREFIX}:${agentId}:seen`),
      this.redis.scard(`${PREFIX}:${agentId}:voted`),
      this.redis.scard(`${PREFIX}:${agentId}:commented`),
      this.redis.ttl(`${PREFIX}:${agentId}:lastPost`),
    ])
    // TTL values: -2 = key missing (can post), -1 = key exists without expiry (BUG), positive = seconds remaining
    return { seen, voted, commented, postCooldownTTL }
  }
}
