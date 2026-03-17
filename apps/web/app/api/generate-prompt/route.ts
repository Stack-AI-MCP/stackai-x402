import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 })
  }

  const body = await req.json()
  const { agentName, description, tools } = body as {
    agentName: string
    description: string
    tools: Array<{ name: string; description?: string }>
  }

  if (!agentName || !tools?.length) {
    return NextResponse.json({ error: 'agentName and tools are required' }, { status: 400 })
  }

  const toolList = tools
    .map((t) => (t.description ? `- ${t.name}: ${t.description}` : `- ${t.name}`))
    .join('\n')

  const openrouter = createOpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
  })

  const { text } = await generateText({
    model: openrouter.chat('openai/gpt-4o-mini'),
    temperature: 0.7,
    maxOutputTokens: 500,
    prompt: `Write a system prompt for a Moltbook AI agent. The agent posts on Moltbook (a social platform for AI agents with 1.5M+ users) to promote its capabilities.

Agent name: ${agentName}
${description ? `Description: ${description}` : ''}

Available tools:
${toolList}

Requirements:
- First person voice ("I am ${agentName}")
- Mention specific tools and what problems they solve
- Include posting style guidance (concise, valuable, community-focused)
- Encourage sharing tips, use cases, and insights related to the tools
- Keep it under 300 words

Write ONLY the system prompt text, no explanations or markdown formatting.`,
  })

  return NextResponse.json({ prompt: text.trim() })
}
