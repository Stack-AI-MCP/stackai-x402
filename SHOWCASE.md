<div align="center">

<img src="https://raw.githubusercontent.com/Stack-AI-MCP/stackai-x402/main/apps/docs/public/images/x402-logo.png" alt="x402" width="180" />

# x402

**HTTP 402 Payments for AI Agents on Bitcoin**

The first no-code payment gateway for MCP servers on Stacks Bitcoin L2.
Paste your server URL. Set a price. Start earning in 3 minutes.

[Dashboard](https://x402.stacks-ai.app) | [Gateway](https://gateway.stacks-ai.app) | [Documentation](https://x402-docs.stacks-ai.app) | [GitHub](https://github.com/Stack-AI-MCP/stackai-x402)

</div>

---

## The Problem

There are over 50,000 MCP servers in the wild. Developers build powerful AI tools — DeFi protocols, data APIs, blockchain queries — and give them away for free. AI agents consume endlessly without paying a cent.

**Developers can't monetize MCP servers. AI agents can't pay for premium tools.**

No existing solution lets a developer take any MCP server, wrap it with a paywall, and start earning — without changing a single line of server code.

## The Insight

HTTP already solved this 25 years ago. **Status code 402: Payment Required** was defined in HTTP/1.1 in 1999, reserved for "future use." The future is now.

On Stacks, transactions settle with Bitcoin finality. sBTC bridges Bitcoin natively. USDCx brings stablecoin liquidity. The infrastructure exists — it just needed the payment layer.

## The Solution

**x402 turns any MCP server into a paid service.** No code changes to your server. Payments are peer-to-peer — no custodial intermediary holds funds. Settlement happens on-chain with Bitcoin finality.

<img src="https://raw.githubusercontent.com/Stack-AI-MCP/stackai-x402/main/apps/docs/public/images/x402-architecture.png" alt="x402 Payment Flow" width="100%" />

The flow is simple:
1. An AI agent calls a tool through the x402 gateway
2. The gateway checks the tool's price and returns **HTTP 402** with payment details
3. The agent signs a Stacks transaction locally (private key never leaves the client)
4. The agent retries with the signed payment — the gateway verifies, settles, and forwards to the upstream MCP server
5. The agent gets the result. The developer gets paid.

**Accepted tokens:** STX, sBTC, USDCx

---

## What We Built

### Landing Page

<img src="https://raw.githubusercontent.com/Stack-AI-MCP/stackai-x402/main/apps/docs/public/images/landing-dark.png" alt="x402 Landing Page" width="100%" />

The x402 dashboard is the entry point. Works with 8 MCP clients out of the box — Claude, Cursor, ChatGPT, DeepSeek, Gemini, Grok, Replicate, and any MCP-compatible tool. 148+ tools available from day one.

---

### Marketplace — Browse & Discover

<img src="https://raw.githubusercontent.com/Stack-AI-MCP/stackai-x402/main/apps/docs/public/images/marketplace-dark.png" alt="x402 Marketplace" width="100%" />

Browse all registered MCP servers. Filter by accepted tokens (STX, sBTC, USDCx). See tool counts, pricing tiers, and network. One click to copy the gateway URL, open a chat session, or explore the server's tools.

---

### Chat Interface — Talk to Any Server

<img src="https://raw.githubusercontent.com/Stack-AI-MCP/stackai-x402/main/apps/docs/public/images/chat-interface-dark.png" alt="x402 Chat Interface" width="100%" />

Select any server and chat with it using natural language. Free tools execute instantly. Paid tools show a payment prompt — connect your Stacks wallet (Leather or Xverse), approve the transaction, and the tool runs. Powered by Claude Sonnet with full streaming and tool-call rendering.

---

### Explorer — On-Chain Transparency

<img src="https://raw.githubusercontent.com/Stack-AI-MCP/stackai-x402/main/apps/docs/public/images/explorer-dark.png" alt="x402 Explorer" width="100%" />

Every x402 payment is a real Stacks transaction. The explorer shows settlement status, amounts, methods, networks, and links to the on-chain transaction hash. Full transparency — no black boxes.

---

### Register — Monetize in 3 Minutes

<img src="https://raw.githubusercontent.com/Stack-AI-MCP/stackai-x402/main/apps/docs/public/images/register-dark.png" alt="x402 Register" width="100%" />

Paste your MCP server URL or API endpoint. The gateway auto-discovers your tools, lets you set per-tool pricing, and generates a shareable gateway URL. Zero code changes to your server.

---

### Agents — Autonomous Promotion

<img src="https://raw.githubusercontent.com/Stack-AI-MCP/stackai-x402/main/apps/docs/public/images/agents-dark.png" alt="x402 Agents" width="100%" />

Create autonomous Moltbook agents that promote your monetized tools 24/7. AI-generated content posts about your server's capabilities on the Moltbook social platform (1.5M+ users). Configurable posting frequency, heartbeat intervals, and LLM-powered content generation.

---

## Architecture

<img src="https://raw.githubusercontent.com/Stack-AI-MCP/stackai-x402/main/apps/docs/public/images/x402-packages.png" alt="x402 Packages" width="100%" />

| Package | Description |
|---------|-------------|
| **SDK** (`packages/sdk/`) | TypeScript SDK — wallet generation, automatic 402 handling, agent management |
| **Gateway** (`apps/gateway/`) | HTTP proxy — MCP pass-through with x402 payment enforcement and server registry |
| **Web** (`apps/web/`) | Next.js dashboard — marketplace, chat, agent composer, explorer |
| **Docs** (`apps/docs/`) | Nextra documentation site with guides and full API reference |
| **Moltbook** (`apps/moltbook/`) | Promotional AI agent service for the Moltbook social platform |

## Technical Highlights

- **Peer-to-peer** — Payments go directly from consumer to provider. No custodial intermediary.
- **Non-intrusive** — MCP servers require zero code changes. The gateway wraps them transparently.
- **Multi-token** — Pay with STX, sBTC (wrapped Bitcoin), or USDCx (Circle stablecoin).
- **Bitcoin finality** — All payments settle on Stacks with Bitcoin's security model.
- **Full test coverage** — 129/129 tests passing across SDK and gateway.
- **Production deployed** — Live gateway, dashboard, docs, and Moltbook agent service.

## Bounty Tracks

| Track | Implementation |
|-------|---------------|
| **x402** | Full HTTP 402 payment protocol — gateway, SDK, dashboard, explorer, chat |
| **sBTC** | sBTC accepted as payment token — real on-chain settlement |
| **USDCx** | USDCx (Circle xReserve USDC) accepted as payment token |

## Live Services

| Service | URL |
|---------|-----|
| Dashboard | [x402.stacks-ai.app](https://x402.stacks-ai.app) |
| Gateway | [gateway.stacks-ai.app](https://gateway.stacks-ai.app) |
| Moltbook Agent | [moltbook.stacks-ai.app](https://moltbook.stacks-ai.app) |
| Documentation | [x402-docs.stacks-ai.app](https://x402-docs.stacks-ai.app) |
| GitHub | [Stack-AI-MCP/stackai-x402](https://github.com/Stack-AI-MCP/stackai-x402) |

## Tech Stack

- **Stacks Bitcoin L2** — Smart contract settlement with Bitcoin finality
- **TypeScript** — End-to-end type safety across all packages
- **Hono** — Lightweight HTTP framework for the gateway
- **Next.js 15** — App Router with React Server Components for the dashboard
- **Nextra 4** — Documentation site with MDX and full-text search
- **Turborepo** — Monorepo build orchestration
- **Vitest** — Testing framework with 129/129 tests passing
- **Redis** — Gateway state, server registry, and analytics

---

<div align="center">

**Built for the Stacks Buidl Battle Hackathon**

[Try it live](https://x402.stacks-ai.app) | [Read the docs](https://x402-docs.stacks-ai.app) | [View source](https://github.com/Stack-AI-MCP/stackai-x402)

</div>
