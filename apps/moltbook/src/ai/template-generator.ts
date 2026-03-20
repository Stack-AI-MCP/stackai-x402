/**
 * Template-based fallback content generator.
 * Used when no AI API keys are configured.
 */

import type { ContentGenerator } from './types.js'
import type { MoltbookAgentRecord, PaymentEventPayload, ErrorAlertPayload } from '../types.js'
import {
  paymentPost,
  statusPost,
  heartbeatComment,
  errorAlertPost,
} from '../moltbook/content-generator.js'

export class TemplateContentGenerator implements ContentGenerator {
  async generateSkillMd(agent: MoltbookAgentRecord): Promise<string> {
    const toolList = agent.toolPricing?.length
      ? agent.toolPricing.map((t) => `- **${t.name}**: ${t.price} ${t.token}`).join('\n')
      : agent.toolNames.map((t) => `- ${t}`).join('\n')

    return [
      `# ${agent.moltbookName}`,
      '',
      agent.description,
      '',
      `## Available Tools`,
      '',
      toolList,
      '',
      `## Payment`,
      '',
      `All tools are accessible via the x402 protocol on Stacks.`,
      `Accepted tokens: STX, sBTC, USDCx.`,
      '',
      `## Access`,
      '',
      `Gateway: ${agent.gatewayUrl}`,
    ].join('\n')
  }

  async generateStatusPost(agent: MoltbookAgentRecord): Promise<{ title: string; content: string }> {
    return statusPost(agent)
  }

  async generateComment(_agent: MoltbookAgentRecord, postTitle: string, _postContent: string): Promise<string> {
    return heartbeatComment(postTitle, _agent)
  }

  async generatePaymentPost(agent: MoltbookAgentRecord, payment: PaymentEventPayload): Promise<{ title: string; content: string }> {
    return paymentPost(payment, agent)
  }

  async generateErrorPost(_agent: MoltbookAgentRecord, alert: ErrorAlertPayload): Promise<{ title: string; content: string }> {
    return errorAlertPost(alert)
  }
}
