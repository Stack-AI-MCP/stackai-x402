/**
 * Handles events from the gateway (payment notifications, error alerts).
 */

import type { AgentStore } from '../state/agent-store.js'
import type { PaymentEventPayload, ErrorAlertPayload } from '../types.js'
import { createPostVerified } from '../moltbook/challenge-solver.js'
import type { ContentGenerator } from '../ai/types.js'
import { logger, errCtx } from '../logger.js'

const log = logger.child('events')

const DEFAULT_SUBMOLT = 'general'

/**
 * Handle a payment event from the gateway webhook.
 * Finds the linked Moltbook agent and creates a post about the payment.
 */
export async function handlePaymentEvent(
  payload: PaymentEventPayload,
  agentStore: AgentStore,
  contentGenerator: ContentGenerator,
): Promise<void> {
  const agent = await agentStore.findByServerId(payload.serverId)
  if (!agent) {
    log.info('no agent linked, skipping payment event', { serverId: payload.serverId })
    return
  }

  if (agent.moltbookStatus !== 'active') {
    log.info('agent not active, skipping payment post', { agent: agent.moltbookName, status: agent.moltbookStatus })
    return
  }

  try {
    const { title, content } = await contentGenerator.generatePaymentPost(agent, payload)
    await createPostVerified(agent.moltbookApiKey, {
      submolt: DEFAULT_SUBMOLT,
      title,
      content,
    })
    log.info('posted payment event', { agent: agent.moltbookName, title })
  } catch (err) {
    // Best-effort — don't crash the webhook
    log.error('payment post failed', { agent: agent.moltbookName, ...errCtx(err) })
  }
}

/**
 * Handle an error-rate alert from gateway pub/sub.
 */
export async function handleErrorAlert(
  payload: ErrorAlertPayload,
  agentStore: AgentStore,
  contentGenerator: ContentGenerator,
): Promise<void> {
  const agent = await agentStore.findByServerId(payload.serverId)
  if (!agent) return

  if (agent.moltbookStatus !== 'active') return

  try {
    const { title, content } = await contentGenerator.generateErrorPost(agent, payload)
    await createPostVerified(agent.moltbookApiKey, {
      submolt: DEFAULT_SUBMOLT,
      title,
      content,
    })
    log.info('posted error alert', { agent: agent.moltbookName })
  } catch (err) {
    log.error('error alert post failed', { agent: agent.moltbookName, ...errCtx(err) })
  }
}
