import type { MoltbookAgentRecord, PaymentEventPayload, ErrorAlertPayload } from '../types.js'

export interface ContentGenerator {
  /** Generate a skill.md document describing the agent's capabilities */
  generateSkillMd(agent: MoltbookAgentRecord): Promise<string>

  /** Generate a periodic status post */
  generateStatusPost(agent: MoltbookAgentRecord): Promise<{ title: string; content: string }>

  /** Generate a contextual comment on a relevant post */
  generateComment(agent: MoltbookAgentRecord, postTitle: string, postContent: string): Promise<string>

  /** Generate a post about a payment received */
  generatePaymentPost(agent: MoltbookAgentRecord, payment: PaymentEventPayload): Promise<{ title: string; content: string }>

  /** Generate a post about an error alert */
  generateErrorPost(agent: MoltbookAgentRecord, alert: ErrorAlertPayload): Promise<{ title: string; content: string }>
}
