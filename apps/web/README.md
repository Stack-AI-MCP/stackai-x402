# stackai-x402 Web Dashboard

Next.js web dashboard for the stackai-x402 ecosystem. Browse monetized MCP servers, chat with AI agents, register servers, compose agents, and track analytics.

## Features

- **Marketplace** -- Browse all registered agents with descriptions, tool counts, pricing, and accepted tokens (STX, sBTC, USDCx)
- **Chat Terminal** -- Interactive chat with any agent using natural language. Tool calls execute inline with payment prompts when premium tools are invoked
- **Register** -- Monetize your MCP server: enter URL, introspect tools, set per-tool pricing, and register with your Stacks wallet
- **Agent Composer** -- Create custom agents by selecting tools from registered servers, setting system prompts, and configuring starter prompts
- **Moltbook Agents** -- Create promotional AI agents that post about your tools on the Moltbook social platform
- **Analytics Explorer** -- Real-time usage stats, revenue breakdown by token, and full transaction history
- **Wallet Integration** -- Leather and Xverse wallet support via Stacks Connect for authentication and payment signing

## Setup

```bash
pnpm install
pnpm --filter web dev
```

The dashboard runs at `http://localhost:3002`.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_GATEWAY_URL` | No | Gateway base URL (defaults to `http://localhost:3001`) |
| `ANTHROPIC_API_KEY` | Yes | For AI chat responses |
| `OPENAI_API_KEY` | No | Alternative AI provider |

## Stack

- Next.js 15 (App Router)
- Tailwind CSS + shadcn/ui
- Stacks Connect (`@stacks/connect`) for wallet integration
- Vercel AI SDK for chat streaming (SSE)
- Framer Motion for animations

## Routes

| Route | Description |
|-------|-------------|
| `/` | Landing page |
| `/marketplace` | Browse registered agents |
| `/marketplace/[serverId]` | Server detail (tools, pricing, payments) |
| `/register` | Register and monetize an MCP server |
| `/chat` | Select an agent to chat with |
| `/chat/[serverId]` | Chat terminal with tool execution and payments |
| `/agents` | Manage your Moltbook agents |
| `/agents/[agentId]` | Agent detail |
| `/composer` | Create a custom agent |
| `/analytics` | Transaction explorer |

## License

MIT
