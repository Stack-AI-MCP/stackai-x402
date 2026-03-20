/**
 * Per-agent heartbeat scheduler with jitter.
 * Uses a two-map approach to avoid timer reference races between
 * the initial jitter timeout and the recurring interval.
 */

import type { Redis } from 'ioredis'
import type { AgentStore } from '../state/agent-store.js'
import { runHeartbeat } from './heartbeat-routine.js'
import type { EngagementTracker } from '../state/engagement-tracker.js'
import type { ContentGenerator } from '../ai/types.js'
import { logger, errCtx } from '../logger.js'

const log = logger.child('heartbeat')

export class HeartbeatEngine {
  /** Stores the recurring interval timer */
  private intervals = new Map<string, NodeJS.Timeout>()
  /** Stores the initial jitter timeout so both can be cleared on stop() */
  private jitterTimers = new Map<string, NodeJS.Timeout>()
  /** Agents stopped while runSafe() was in-flight — prevents orphaned recurring intervals */
  private stoppedDuringRun = new Set<string>()

  constructor(
    private agentStore: AgentStore,
    private tracker: EngagementTracker,
    private contentGenerator: ContentGenerator,
    private redis?: Redis,
  ) {}

  /**
   * Start a recurring heartbeat for an agent.
   * Adds random jitter of 0-30 minutes to avoid thundering herd.
   */
  start(agentId: string, intervalHours: number): void {
    this.stop(agentId)

    const intervalMs = intervalHours * 60 * 60 * 1000
    // Jitter: 10% of interval, capped at 30 min
    const jitterMs = Math.random() * Math.min(intervalMs * 0.1, 30 * 60 * 1000)

    this.stoppedDuringRun.delete(agentId)

    const jitterTimer = setTimeout(async () => {
      // Remove jitter ref — it has fired
      this.jitterTimers.delete(agentId)

      await this.runSafe(agentId)

      // Schedule recurring — but only if stop() wasn't called during runSafe()
      if (this.stoppedDuringRun.has(agentId)) {
        this.stoppedDuringRun.delete(agentId)
        return
      }
      if (!this.intervals.has(agentId)) {
        const recurringTimer = setInterval(() => {
          void this.runSafe(agentId)
        }, intervalMs)
        this.intervals.set(agentId, recurringTimer)
      }
    }, jitterMs)

    this.jitterTimers.set(agentId, jitterTimer)

    log.info('started', { agentId, intervalHours, jitterSec: Math.round(jitterMs / 1000) })
  }

  stop(agentId: string): void {
    const jitter = this.jitterTimers.get(agentId)
    if (jitter) {
      clearTimeout(jitter)
      this.jitterTimers.delete(agentId)
    }

    const interval = this.intervals.get(agentId)
    if (interval) {
      clearInterval(interval)
      this.intervals.delete(agentId)
    }

    if (jitter || interval) {
      // If jitter already fired and runSafe() is in-flight, mark as stopped
      // so the callback doesn't create a new recurring interval.
      this.stoppedDuringRun.add(agentId)
      log.info('stopped', { agentId })
    }
  }

  stopAll(): void {
    const ids = [...this.jitterTimers.keys(), ...this.intervals.keys()]
    const unique = [...new Set(ids)]
    for (const agentId of unique) {
      this.stop(agentId)
    }
  }

  async triggerNow(agentId: string): Promise<void> {
    await this.runSafe(agentId)
  }

  isRunning(agentId: string): boolean {
    return this.jitterTimers.has(agentId) || this.intervals.has(agentId)
  }

  get activeCount(): number {
    const ids = new Set([...this.jitterTimers.keys(), ...this.intervals.keys()])
    return ids.size
  }

  /**
   * Load all agents from Redis and start heartbeats for enabled ones.
   */
  async loadAll(): Promise<void> {
    const agents = await this.agentStore.list()
    for (const agent of agents) {
      if (agent.heartbeatEnabled && agent.moltbookStatus !== 'suspended') {
        this.start(agent.id, agent.heartbeatIntervalHours)
      }
    }
    log.info('loaded', { total: agents.length, active: this.activeCount })
  }

  private async runSafe(agentId: string): Promise<void> {
    try {
      await runHeartbeat(agentId, this.agentStore, this.tracker, this.contentGenerator, this.redis)
    } catch (err) {
      log.error('heartbeat error', { agentId, ...errCtx(err) })
    }
  }
}
