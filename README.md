# stackai-x402

A Turborepo monorepo implementing the x402 HTTP payment protocol for Stacks Bitcoin Layer 2.

## Packages

| Package | Path | Description |
|---|---|---|
| `stackai-x402` | `packages/sdk/` | SDK for building and verifying x402 payments (STX, sBTC, USDCx) |
| `gateway` | `apps/gateway/` | HTTP gateway server — proxies MCP tool calls, enforces payment requirements |

## Quick Start

```bash
pnpm install
pnpm build   # turbo: SDK first, then gateway
pnpm test    # turbo: all packages, CI mode
```

## Development

```bash
pnpm dev     # start all packages in watch mode
```

## Gateway

The gateway runs on `PORT` (env var) or `3001` (default).

```bash
cp apps/gateway/.env.example apps/gateway/.env
# fill in values, then:
pnpm --filter gateway dev
```

Health check: `GET /health` → `{ "status": "ok" }`

## Architecture

- `packages/sdk/src/server/` — x402 payment builder (MCP server side)
- `packages/sdk/src/client/` — x402 payment client (agent side)
- `packages/sdk/src/proxy/` — gateway proxy logic
- `packages/sdk/src/hooks/` — request lifecycle hooks
- `packages/sdk/src/moltbook/` — Moltbook social presence integration
- `packages/sdk/src/internal/` — Stacks blockchain internals (private, not exported)
- `packages/sdk/src/types/` — shared TypeScript types
