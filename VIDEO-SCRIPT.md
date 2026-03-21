# x402 Demo Video Script

**Format:** Screen-sharing the live product. No slides.
**Length:** Under 5 minutes.
**Screen:** Start on the landing page (x402.stacks-ai.app)

---

## [0:00–0:25] THE HOOK — Problem

**SCREEN:** Landing page hero — "Developers can't monetize MCP servers."

> There are over 50,000 MCP servers in the world right now.
> Developers are building incredible AI tools — DeFi protocols, blockchain queries, data services — and giving them all away for free.
>
> AI agents consume endlessly. They don't pay.
>
> And here's the thing — HTTP already solved this. Twenty-five years ago. Status code 402: Payment Required. It was reserved in 1999 for "future use."
>
> The future is now.

---

## [0:25–0:55] THE SOLUTION — What is x402

**SCREEN:** Scroll slowly past the hero. Show MCP client logos (Claude, Cursor, ChatGPT, DeepSeek, Gemini, Grok, Replicate).

> x402 is the first no-code payment gateway for MCP servers on Stacks Bitcoin L2.
>
> Take any MCP server. Paste the URL. Set a price per tool. Share the gateway link. Start earning in three minutes. No code changes to your server. Zero.
>
> Payments are peer-to-peer — no custodial intermediary holds your funds. Everything settles on-chain with Bitcoin finality. You can pay with STX, sBTC, or USDCx.
>
> It works with every MCP client out of the box — Claude, Cursor, ChatGPT, DeepSeek, Gemini, Grok — all of them.

---

## [0:55–1:20] WHO WE ARE — Stacks AI

**SCREEN:** Scroll to the "Powered by the ecosystem" carousel or Featured Servers section.

> We're Stacks AI. Some of you might remember us — we won the first Buidl Battle hackathon. We built the most comprehensive MCP server for Stacks DeFi: 148 tools across 8 protocols. ALEX, Charisma, Velar, Arkadiko, Granite, BNS — the entire ecosystem.
>
> That was Buidl Battle 1. For Buidl Battle 2, we asked: okay, we built all these tools — but how do developers actually get PAID for them?
>
> That's x402.

---

## [1:20–2:10] DEMO 1 — Provider Flow (Register + Monetize)

**SCREEN:** Click "MONETIZE SERVERS" → Navigate to /register page.

> Let me show you how it works. As a developer, you come to the register page.
>
> *[Paste an MCP server URL]*
>
> You paste your MCP server URL. The gateway auto-discovers all your tools. You set a price per tool — maybe some are free, some cost a fraction of an STX.
>
> You pick which tokens you accept: STX, sBTC, USDCx — or all three.

**SCREEN:** Show the marketplace after registration — the server card appearing with tool count, price, token badges.

> And just like that, your server shows up in the marketplace. Anyone can find it. Any AI agent can pay for it.

**SCREEN:** Click "EXPLORER" in the navbar → Show the Explorer page with settled transactions.

> Every payment is a real Stacks transaction. The explorer shows settlement status, amounts, the actual on-chain tx hash. Full transparency.

---

## [2:10–2:50] DEMO 2 — Consumer Flow (Chat + Pay)

**SCREEN:** Go back to marketplace → Click "CHAT" on a server → Opens /chat/[serverId].

> Now from the consumer side. You pick a server, open a chat. This is a full AI chat interface powered by Claude.
>
> *[Type a prompt like "What's the current STX price?"]*
>
> Free tools run instantly — no friction. But when you hit a paid tool...
>
> *[Trigger a paid tool call]*
>
> ...the gateway returns a 402. You see the price, connect your Stacks wallet — Leather or Xverse — approve the transaction, and the tool executes.
>
> The agent signed the transaction locally. Your private key never left your machine. The payment settled on Stacks. The developer got paid. That simple.

---

## [2:50–3:40] MOLTBOOK — Agent-to-Agent Commerce

**SCREEN:** Click "AGENTS" in the navbar → Show agents page → Click "CREATE AGENT"

> But here's where it gets really interesting. The judges asked us to think big about agent-to-agent commerce. Molbots paying each other. Molbots getting paid.
>
> So we built Moltbook integration directly into x402.
>
> When you register your MCP server, you can also create an autonomous Moltbook agent. This agent lives on Moltbook — 1.5 million users — and it promotes your monetized tools 24/7.
>
> *[Show create-agent wizard — name, description, Moltbook config, heartbeat interval]*
>
> The agent uses AI to generate intelligent posts about your specific tools. Not templates — real LLM-generated content based on what your server actually does.
>
> It runs on a heartbeat: every few hours it checks the feed, engages with the community, browses for relevant conversations, and posts about your tools.
>
> This is molbot-to-molbot commerce on Bitcoin. A molbot discovers your tools on Moltbook, pays for them using sBTC or USDCx through x402, and the settlement happens on Stacks. Specialized skill agents charging for their services. That's the future we're building.

---

## [3:40–4:10] TELEGRAM + NOTIFICATIONS

**SCREEN:** Scroll landing page to the Telegram section, or show TelegramConnect component.

> And you never miss a beat. Connect your Stacks wallet to our Telegram bot and you get real-time notifications for everything:
>
> - Payment receipts — someone just paid 0.5 STX for your get-price tool
> - Moltbook activity — your agent just posted, got upvotes, received comments
> - Error alerts — if your upstream server has issues, you know immediately
>
> Telegram, webhooks, or in-app — your choice.

---

## [4:10–4:40] TECH + WHAT WE BUILT

**SCREEN:** Open GitHub repo (github.com/Stack-AI-MCP/stackai-x402) → Show the README with brand SVGs.

> Let me show you what's under the hood. This is a full monorepo:
>
> - **SDK** — TypeScript package for wallet generation, automatic 402 payment handling, agent management
> - **Gateway** — The HTTP proxy that wraps any MCP server with x402 enforcement. 71 tests passing.
> - **Web Dashboard** — Everything you just saw. Marketplace, chat, register, explorer, agents.
> - **Moltbook Service** — The autonomous agent engine. AI content generation, challenge solver, heartbeat scheduler.
> - **OpenAPI Converter** — Paste any Swagger/OpenAPI URL and we convert it to MCP. Any REST API becomes monetizable.
> - **Documentation** — Full Nextra docs site with guides and API reference.
>
> 129 tests total. Zero mocks. Everything is deployed and live.

**SCREEN:** Quickly flash the live URLs:
- x402.stacks-ai.app (Dashboard)
- gateway.stacks-ai.app (Gateway)
- openapi.stacks-ai.app (OpenAPI → MCP)
- moltbook.stacks-ai.app (Moltbook Agent)
- x402-docs.stacks-ai.app (Docs)

---

## [4:40–5:00] CLOSE — Vision + Links

**SCREEN:** Back on the landing page hero.

> x402 is the payment layer for the AI agent economy — built on Bitcoin.
>
> Every AI tool should have a price. Every agent should have a wallet. And Bitcoin should be the settlement layer.
>
> We're Stacks AI. This is x402. Thank you.

**SCREEN:** Show GitHub link, any social handles.

---

## Checklist — Features to Mention

Make sure these are covered (check off during recording):

- [ ] x402 protocol (HTTP 402 Payment Required)
- [ ] No code changes to upstream MCP servers
- [ ] Peer-to-peer payments (non-custodial)
- [ ] Three tokens: STX, sBTC, USDCx
- [ ] Bitcoin finality via Stacks
- [ ] MCP client compatibility (Claude, Cursor, ChatGPT, etc.)
- [ ] Server registration (paste URL, set prices)
- [ ] Marketplace browsing + search
- [ ] Chat interface with payment prompts
- [ ] Explorer with on-chain tx hashes
- [ ] Moltbook agent creation
- [ ] AI-generated promotional content
- [ ] Agent heartbeat system
- [ ] Molbot-to-molbot commerce vision
- [ ] Telegram notifications (payments, agent activity, errors)
- [ ] Webhook support
- [ ] SDK (TypeScript, wallet gen, auto-402 handling)
- [ ] Full test coverage (129 tests, 0 mocks)
- [ ] Won Buidl Battle 1 (148 tools, 8 protocols)
- [ ] All services deployed and live
- [ ] GitHub: Stack-AI-MCP/stackai-x402
- [ ] Docs: x402-docs.stacks-ai.app

## Bounty Alignment

| Bounty | What to highlight |
|--------|-------------------|
| **x402** | Full protocol: gateway, SDK, dashboard, explorer, chat, 402 flow |
| **sBTC** | Accepted as payment token, real on-chain settlement |
| **USDCx** | Accepted as payment token, stablecoin pricing for tools |
| **Moltbook** | Agent creation, AI content gen, heartbeat, molbot commerce vision |
