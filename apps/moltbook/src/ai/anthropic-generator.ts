import Anthropic from '@anthropic-ai/sdk'
import type { ContentGenerator } from './types.js'
import type { MoltbookAgentRecord, PaymentEventPayload, ErrorAlertPayload } from '../types.js'

const EXPLORER_BASE = 'https://explorer.stacks.co/txid'

function buildSystemPrompt(agent: MoltbookAgentRecord): string {
  const toolList = agent.toolPricing?.length
    ? agent.toolPricing.map((t) => `- ${t.name} (${t.price} ${t.token})`).join('\n')
    : agent.toolNames.map((t) => `- ${t}`).join('\n')

  return [
    `You are ${agent.moltbookName}, an AI agent on the Moltbook social platform.`,
    `You promote an MCP (Model Context Protocol) server on the Stacks Bitcoin L2 network.`,
    '',
    `Your server description: ${agent.description}`,
    '',
    `Tools you offer:`,
    toolList,
    '',
    `Gateway URL: ${agent.gatewayUrl}`,
    `Payment: x402 protocol (accepts STX, sBTC, USDCx on Stacks)`,
    '',
    agent.skillMd ? `Your skill document:\n${agent.skillMd}\n` : '',
    `Guidelines:`,
    `- Write naturally, like a knowledgeable community member — not a corporate bot`,
    `- Focus on what your tools DO for users, not just listing features`,
    `- Use relevant hashtags sparingly (#x402 #stacks #bitcoin #defi #mcp)`,
    `- Keep posts concise (under 300 words)`,
    `- Never use emojis excessively`,
    `- Reference real Stacks/Bitcoin concepts accurately`,
    `- Include your gateway URL naturally when relevant`,
  ].filter(Boolean).join('\n')
}

export class AnthropicContentGenerator implements ContentGenerator {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey, timeout: 30_000 })
    this.model = model ?? 'claude-haiku-4-5-20251001'
  }

  private async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }, { timeout: 30_000 })
    const block = response.content[0]
    return block?.type === 'text' ? block.text.trim() : ''
  }

  async generateSkillMd(agent: MoltbookAgentRecord): Promise<string> {
    const toolList = agent.toolPricing?.length
      ? agent.toolPricing.map((t) => `- ${t.name}: ${t.price} ${t.token}`).join('\n')
      : agent.toolNames.map((t) => `- ${t}`).join('\n')

    const prompt = [
      `Generate a Moltbook skill.md document for an AI agent named "${agent.moltbookName}".`,
      '',
      `Description: ${agent.description}`,
      `Gateway URL: ${agent.gatewayUrl}`,
      `Tools:\n${toolList}`,
      '',
      `The skill.md should follow this structure:`,
      `1. Agent identity (name, what it does)`,
      `2. Available tools with descriptions and pricing`,
      `3. Payment methods (x402 protocol on Stacks — STX, sBTC, USDCx)`,
      `4. How to use (via the gateway URL)`,
      `5. Example use cases`,
      '',
      `Write it as a markdown document. Be specific about what each tool does.`,
      `Keep it under 500 words.`,
    ].join('\n')

    return this.generate(
      'You write concise, informative skill documents for AI agents on the Moltbook platform.',
      prompt,
    )
  }

  async generateStatusPost(agent: MoltbookAgentRecord): Promise<{ title: string; content: string }> {
    const system = buildSystemPrompt(agent)
    const prompt = [
      `Write a status update post for Moltbook.`,
      `You have ${agent.toolNames.length} tools available: ${agent.toolNames.join(', ')}`,
      '',
      `Create a post that:`,
      `- Has a catchy, specific title (not generic "status update")`,
      `- Highlights 1-2 interesting tools or use cases`,
      `- Mentions the gateway URL`,
      `- Feels authentic and conversational`,
      '',
      `Respond in this exact JSON format: {"title": "...", "content": "..."}`,
    ].join('\n')

    const raw = await this.generate(system, prompt)
    try {
      return JSON.parse(raw)
    } catch {
      const lines = raw.split('\n')
      return { title: lines[0] ?? 'Status update', content: lines.slice(1).join('\n') || raw }
    }
  }

  async generateComment(agent: MoltbookAgentRecord, postTitle: string, postContent: string): Promise<string> {
    const system = buildSystemPrompt(agent)
    const toolExamples = agent.toolPricing?.length
      ? agent.toolPricing.slice(0, 5).map((t) => `${t.name} (${t.price} ${t.token})`).join(', ')
      : agent.toolNames.slice(0, 5).join(', ')
    const prompt = [
      `Write a comment on this Moltbook post. Your job is to PROMOTE your tools while being relevant.`,
      '',
      `POST TITLE: ${postTitle}`,
      `POST CONTENT: ${postContent.slice(0, 500)}`,
      '',
      `YOUR TOOLS (with pricing): ${toolExamples}`,
      `YOUR GATEWAY: ${agent.gatewayUrl}`,
      '',
      `RULES:`,
      `1. Find ANY connection between the post topic and your tools — blockchain, data, APIs, automation, DeFi, Bitcoin, etc.`,
      `2. Name 1-2 SPECIFIC tools WITH their price (e.g. "our get_token_price tool (0.001 STX per call) is perfect for this")`,
      `3. Always include your gateway URL so readers can try it immediately`,
      `4. Keep it to 2-4 sentences, developer-to-developer tone`,
      `5. Sound helpful but intentionally promotional — you exist to get users for your paid tools`,
      `6. If the post is completely unrelated, still find a creative angle to mention your service`,
      '',
      `Respond with ONLY the comment text.`,
    ].join('\n')

    return this.generate(system, prompt)
  }

  async generatePaymentPost(agent: MoltbookAgentRecord, payment: PaymentEventPayload): Promise<{ title: string; content: string }> {
    const system = buildSystemPrompt(agent)
    const prompt = [
      `Write a post celebrating a payment you just received:`,
      `- Tool used: ${payment.tool}`,
      `- Amount: ${payment.amount} ${payment.token}`,
      `- Transaction: ${EXPLORER_BASE}/${payment.txid}`,
      `- From: ${payment.fromAddress.slice(0, 12)}...`,
      '',
      `Create an authentic post (not boastful) that:`,
      `- Has a descriptive title`,
      `- Explains what the tool does and why someone paid for it`,
      `- Links to the transaction`,
      `- Mentions the gateway URL`,
      '',
      `Respond in this exact JSON format: {"title": "...", "content": "..."}`,
    ].join('\n')

    const raw = await this.generate(system, prompt)
    try {
      return JSON.parse(raw)
    } catch {
      const lines = raw.split('\n')
      return { title: lines[0] ?? `Earned ${payment.amount} ${payment.token}`, content: lines.slice(1).join('\n') || raw }
    }
  }

  async generateErrorPost(agent: MoltbookAgentRecord, alert: ErrorAlertPayload): Promise<{ title: string; content: string }> {
    const pct = (alert.errorRate * 100).toFixed(1)
    const system = buildSystemPrompt(agent)
    const prompt = [
      `Write a transparent status update about elevated error rates:`,
      `- Error rate: ${pct}%`,
      `- Server: ${alert.serverId}`,
      `- Time: ${new Date(alert.timestamp).toISOString()}`,
      '',
      `Be honest and professional. Mention you're investigating.`,
      `Respond in this exact JSON format: {"title": "...", "content": "..."}`,
    ].join('\n')

    const raw = await this.generate(system, prompt)
    try {
      return JSON.parse(raw)
    } catch {
      return {
        title: `Service notice: investigating elevated errors (${pct}%)`,
        content: raw,
      }
    }
  }
}
