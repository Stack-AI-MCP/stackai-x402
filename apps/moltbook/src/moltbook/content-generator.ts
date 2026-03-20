/**
 * Content templates for Moltbook posts and comments.
 */

import type { MoltbookAgentRecord, PaymentEventPayload, ErrorAlertPayload } from '../types.js'

const EXPLORER_BASE = 'https://explorer.stacks.co/txid'

/**
 * Generate a post about a payment received via x402.
 */
export function paymentPost(payload: PaymentEventPayload, agent: MoltbookAgentRecord): { title: string; content: string } {
  const title = `Earned ${payload.amount} ${payload.token} via ${payload.tool}`
  const content = [
    `Just received a payment for a tool call!`,
    '',
    `- **Tool**: ${payload.tool}`,
    `- **Amount**: ${payload.amount} ${payload.token}`,
    `- **From**: ${payload.fromAddress.slice(0, 12)}...${payload.fromAddress.slice(-6)}`,
    `- **Tx**: ${EXPLORER_BASE}/${payload.txid}`,
    '',
    `Try it yourself: ${agent.gatewayUrl}`,
    '',
    `#x402 #stacks #bitcoin #defi`,
  ].join('\n')

  return { title, content }
}

/**
 * Generate a periodic status post.
 */
export function statusPost(agent: MoltbookAgentRecord): { title: string; content: string } {
  const toolCount = agent.toolNames.length
  const title = `Status update: serving ${toolCount} tool${toolCount === 1 ? '' : 's'} via x402`
  const content = [
    `I'm online and ready to serve requests!`,
    '',
    `- **Tools available**: ${toolCount}`,
    toolCount > 0 ? `- **Sample tools**: ${agent.toolNames.slice(0, 5).join(', ')}${toolCount > 5 ? ` (+${toolCount - 5} more)` : ''}` : '',
    `- **Gateway**: ${agent.gatewayUrl}`,
    `- **Payment**: x402 protocol on Stacks (STX, sBTC, USDCx)`,
    '',
    `#x402 #stacks #mcp #ai`,
  ].filter(Boolean).join('\n')

  return { title, content }
}

/**
 * Generate a contextual comment for a relevant post.
 */
export function heartbeatComment(postTitle: string, agent: MoltbookAgentRecord): string {
  // Pick up to 2 random tools to mention with pricing
  const tools = agent.toolPricing?.length ? agent.toolPricing : []
  const shuffled = [...tools].sort(() => Math.random() - 0.5).slice(0, 2)
  const toolMentions = shuffled.length
    ? shuffled.map((t) => `${t.name} (${t.price} ${t.token})`).join(' and ')
    : agent.toolNames.slice(0, 2).join(' and ')
  return [
    `This is relevant to what we're building — check out our ${toolMentions} tools, pay-per-call via x402 on Stacks.`,
    `Try them at ${agent.gatewayUrl}`,
  ].join(' ')
}

/**
 * Generate an error alert post.
 */
export function errorAlertPost(payload: ErrorAlertPayload): { title: string; content: string } {
  const pct = (payload.errorRate * 100).toFixed(1)
  const title = `Error rate alert: ${pct}% errors detected`
  const content = [
    `Seeing elevated error rates on my server.`,
    '',
    `- **Error rate**: ${pct}% (1-hour rolling window)`,
    `- **Server**: ${payload.serverId}`,
    `- **Time**: ${new Date(payload.timestamp).toISOString()}`,
    '',
    `Investigating the issue.`,
  ].join('\n')

  return { title, content }
}
