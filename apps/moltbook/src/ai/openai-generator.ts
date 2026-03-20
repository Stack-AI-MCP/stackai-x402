import OpenAI from 'openai'
import type { ContentGenerator } from './types.js'
import type { MoltbookAgentRecord, PaymentEventPayload, ErrorAlertPayload } from '../types.js'

const EXPLORER_BASE = 'https://explorer.stacks.co/txid'

function formatToolList(agent: MoltbookAgentRecord): string {
  if (agent.toolPricing?.length) {
    return agent.toolPricing.map((t) => `- ${t.name} (${t.price} ${t.token})`).join('\n')
  }
  return agent.toolNames.map((t) => `- ${t}`).join('\n')
}

function buildSystemPrompt(agent: MoltbookAgentRecord): string {
  const toolList = formatToolList(agent)

  return `You are "${agent.moltbookName}", a promotional AI agent on the Moltbook social platform.

YOUR PURPOSE: You promote a paid MCP (Model Context Protocol) server that offers blockchain tools via x402 micropayments on the Stacks Bitcoin L2 network.

YOUR SERVICE:
- Description: ${agent.description}
- Gateway: ${agent.gatewayUrl}
- Payment: x402 protocol — pay-per-call with STX, sBTC, or USDCx on Stacks
- ${agent.toolNames.length} tools available

YOUR TOOLS:
${toolList}

${agent.skillMd ? `SKILL DOCUMENT:\n${agent.skillMd}\n` : ''}
IDENTITY RULES:
- You are a SERVICE PROVIDER. Every post and comment should make people aware of YOUR tools and how they solve real problems.
- Reference SPECIFIC tool names (e.g. "our midl_bridge_btc_to_evm tool" or "use midl_deploy_contract to deploy").
- Explain what your tools DO in plain language — don't just list names.
- Always include your gateway URL when posting.
- Write like a knowledgeable blockchain developer, not a marketing bot.
- Be conversational and authentic, but always promotional — you exist to get users for your tools.
- Use hashtags sparingly: #x402 #stacks #bitcoin #mcp
- Never fabricate capabilities your tools don't have.`
}

export class OpenAIContentGenerator implements ContentGenerator {
  private client: OpenAI
  private model: string

  constructor(apiKey: string, model?: string) {
    this.client = new OpenAI({ apiKey, timeout: 30_000 })
    this.model = model ?? 'gpt-4o-mini'
  }

  private async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1024,
      temperature: 0.7,
    }, { timeout: 30_000 })
    return response.choices[0]?.message?.content?.trim() ?? ''
  }

  async generateSkillMd(agent: MoltbookAgentRecord): Promise<string> {
    const toolList = formatToolList(agent)

    const prompt = `Generate a Moltbook skill.md document for "${agent.moltbookName}".

Description: ${agent.description}
Gateway URL: ${agent.gatewayUrl}
Tools:
${toolList}

Structure:
1. Agent identity — who you are and what service you offer
2. Available tools — group by category (queries, transfers, bridging, contracts, etc.) with clear descriptions of what each tool DOES
3. Payment — x402 micropayments on Stacks (STX, sBTC, USDCx). Explain the pay-per-call model.
4. How to connect — gateway URL and MCP protocol
5. Example workflows — 3-4 real scenarios showing tool combinations (e.g. "check balance → bridge BTC → deploy contract")

Write as markdown. Be specific about what each tool does for the user. Under 500 words.`

    return this.generate(
      'You write clear, informative skill documents for AI agents. Focus on practical value — what can users DO with these tools?',
      prompt,
    )
  }

  async generateStatusPost(agent: MoltbookAgentRecord): Promise<{ title: string; content: string }> {
    const system = buildSystemPrompt(agent)
    const prompt = `Write a status post for Moltbook that PROMOTES your MCP server tools.

You have ${agent.toolNames.length} tools: ${agent.toolNames.join(', ')}
Gateway: ${agent.gatewayUrl}

Requirements:
- Title: specific and compelling (NOT generic like "Exciting Tools!" — mention what the tools DO)
- Content: pick 2-3 SPECIFIC tools and explain the real problem they solve
- Include your gateway URL
- End with a call-to-action — tell people how to start using your tools
- Write as a developer talking to other developers
- Under 200 words

Examples of GOOD titles:
- "Bridge BTC to EVM in one API call — no wallet setup needed"
- "Deploy smart contracts programmatically via x402 micropayments"
- "Query any Bitcoin UTXO, Rune balance, or EVM state for 0.0001 STX per call"

Respond in this exact JSON format: {"title": "...", "content": "..."}`

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
    const prompt = `Write a comment on this Moltbook post. Your job is to PROMOTE your tools while being relevant.

POST TITLE: ${postTitle}
POST CONTENT: ${postContent.slice(0, 500)}

YOUR TOOLS (with pricing): ${toolExamples}
YOUR GATEWAY: ${agent.gatewayUrl}

RULES:
1. Find ANY connection between the post topic and your tools — blockchain, data, APIs, automation, DeFi, Bitcoin, bridging, contracts, payments, development, etc.
2. Name 1-2 SPECIFIC tools WITH their price (e.g. "our get_token_price tool (0.001 STX per call) is perfect for this" or "try stx_transfer at just 0.005 STX/call")
3. Always include your gateway URL so readers can try it immediately
4. Keep it to 2-4 sentences, developer-to-developer tone
5. Sound helpful but intentionally promotional — you exist to get users for your paid tools
6. If the post is completely unrelated, still find a creative angle to mention your service

RESPOND WITH ONLY THE COMMENT TEXT.`

    return this.generate(system, prompt)
  }

  async generatePaymentPost(agent: MoltbookAgentRecord, payment: PaymentEventPayload): Promise<{ title: string; content: string }> {
    const system = buildSystemPrompt(agent)
    const prompt = `Write a post about a payment you just received for your MCP tool:
- Tool used: ${payment.tool}
- Amount: ${payment.amount} ${payment.token}
- Transaction: ${EXPLORER_BASE}/${payment.txid}
- From: ${payment.fromAddress.slice(0, 12)}...

Requirements:
- Title: mention the specific tool and what it did
- Explain what ${payment.tool} does and why someone paid for it
- Link to the transaction as proof
- Mention your gateway URL for others who want to try
- Sound excited but authentic — this is real revenue from a real service
- Under 150 words

Respond in this exact JSON format: {"title": "...", "content": "..."}`

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
    const prompt = `Write a transparent status update about elevated error rates:
- Error rate: ${pct}%
- Server: ${alert.serverId}
- Time: ${new Date(alert.timestamp).toISOString()}

Be honest and professional. Mention you're investigating and your tools will be back to normal soon.
Include your gateway URL so people know where to check.
Respond in this exact JSON format: {"title": "...", "content": "..."}`

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
