# stackai-x402 Gateway

HTTP gateway that wraps MCP servers with x402 payment enforcement. Register an MCP server, set tool prices, and the gateway handles payment verification, settlement, and proxying.

## How It Works

1. **Register** an MCP server with the gateway (provide URL, recipient address, tool pricing)
2. **Gateway introspects** the MCP server to discover available tools
3. **Clients call tools** via the gateway's proxy endpoint (`/mcp?id=serverId`)
4. **For priced tools**, the gateway returns HTTP 402 with payment requirements
5. **Client signs** a Stacks transaction and retries with a `payment-signature` header
6. **Gateway settles** the payment via an x402 relay and forwards the request to the upstream MCP server

Free tools (price = 0) are proxied directly with no payment step.

## Setup

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GATEWAY_ENCRYPTION_KEY` | Yes | -- | 64-char hex string (32 bytes AES-256 key). Used to encrypt stored upstream auth tokens. |
| `REDIS_URL` | Yes | -- | Redis connection URL |
| `RELAY_URL` | Yes | -- | Mainnet x402 relay URL for payment settlement |
| `TESTNET_RELAY_URL` | No | `https://x402-relay.aibtc.dev/relay` | Testnet x402 relay URL |
| `TOKEN_PRICE_STX` | No | `3.0` | STX price in USD (for micro-unit conversion) |
| `TOKEN_PRICE_SBTC` | No | `100000.0` | sBTC price in USD |
| `TOKEN_PRICE_USDCX` | No | `1.0` | USDCx price in USD |
| `PORT` | No | `3001` | HTTP server port |
| `OPERATOR_KEY` | No | -- | Operator private key (for admin routes) |
| `TELEGRAM_BOT_TOKEN` | No | -- | Telegram bot token for notifications |
| `MOLTBOOK_API_KEY` | No | -- | Moltbook API key for agent social presence |

All config is validated at startup with Zod. Invalid values cause a descriptive error and exit.

## Running

```bash
# Development (hot reload)
pnpm dev

# Production
pnpm build && pnpm start
```

## API Reference

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Returns `{ "status": "ok" }` |

### MCP Proxy

| Method | Path | Description |
|--------|------|-------------|
| ALL | `/mcp?id={serverId}` | Main proxy endpoint. Sends JSON-RPC requests to the upstream MCP server. Enforces x402 payment for priced tools. |

**Request body**: Standard JSON-RPC 2.0 with `tools/call` method.

**Headers (paid tools)**:
- Request: `payment-signature` -- base64-encoded `PaymentPayloadV2` (signed Stacks transaction)
- Response (402): `payment-required` -- base64-encoded `PaymentRequiredV2` (accepted tokens, price, recipient)
- Response (200): `payment-response` -- base64-encoded JSON with `txid` and `explorerUrl`

### Server Registration

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/servers` | List all registered servers |
| POST | `/api/v1/servers` | Register a new MCP server |
| GET | `/api/v1/servers/:serverId` | Get server details and tool list |
| PATCH | `/api/v1/servers/:serverId` | Update server config (owner only, requires signature) |
| DELETE | `/api/v1/servers/:serverId` | Remove server (owner only, requires signature) |
| GET | `/api/v1/servers/introspect?url={mcpUrl}` | Introspect a remote MCP server to discover its tools |

**POST /api/v1/servers** body:

```json
{
  "url": "https://mcp-server.example.com/sse",
  "name": "My DeFi Server",
  "description": "Stacks DeFi tools",
  "recipientAddress": "SP...",
  "ownerAddress": "SP...",
  "network": "mainnet",
  "acceptedTokens": ["STX", "sBTC", "USDCx"],
  "toolPricing": {
    "swap-tokens": { "price": 0.01 },
    "get-price": { "price": 0 }
  }
}
```

**Response** (201):

```json
{
  "serverId": "abc123",
  "gatewayUrl": "https://gateway.example.com/mcp?id=abc123",
  "ownerAddress": "SP...",
  "tools": [
    { "name": "swap-tokens", "description": "...", "price": 0.01, "acceptedTokens": ["STX", "sBTC", "USDCx"] },
    { "name": "get-price", "description": "...", "price": 0, "acceptedTokens": ["STX", "sBTC", "USDCx"] }
  ]
}
```

**Security**: Only HTTPS URLs on public IPs are accepted. Private IP ranges (127.x, 10.x, 192.168.x, 172.16-31.x) and localhost are blocked (SSRF protection).

### Agent Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/agents` | List agents (paginated: `?page=1&limit=24`) |
| POST | `/api/v1/agents` | Create agent (requires signature) |
| GET | `/api/v1/agents/:agentId` | Get agent with resolved tools and Moltbook status |
| PUT | `/api/v1/agents/:agentId` | Update agent (owner only, requires signature) |
| DELETE | `/api/v1/agents/:agentId` | Delete agent (owner only, requires signature) |

**POST /api/v1/agents** body:

```json
{
  "name": "DeFi Agent",
  "description": "Bitcoin DeFi assistant",
  "ownerAddress": "SP...",
  "tools": [
    { "serverId": "abc123", "toolName": "swap-tokens", "price": 0.01 }
  ],
  "moltbookName": "defi-agent",
  "moltbookApiKey": "moltbook_sk_...",
  "heartbeatIntervalHours": 6,
  "systemPrompt": "You are a DeFi assistant.",
  "starterPrompts": ["What can you do?"],
  "network": "mainnet",
  "signature": "...",
  "publicKey": "...",
  "signedMessage": "..."
}
```

When `moltbookApiKey` is provided, the gateway pushes a registration message to the `moltbook:agent-registrations` Redis queue for the Moltbook service to consume.

### Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/servers/:id/analytics` | Server analytics (calls, errors, revenue, unique callers) |
| GET | `/api/v1/servers/transactions` | Paginated transaction history |

### Agent Card

| Method | Path | Description |
|--------|------|-------------|
| GET | `/.well-known/agent.json` | A2A agent discovery card |

## Authentication

Write operations (PATCH, PUT, DELETE on servers/agents) require Stacks message signing:

1. Client constructs a JSON message containing the operation details and a timestamp
2. Client signs the SHA-256 hash of the message with their Stacks private key
3. Client sends `signature`, `publicKey`, and `signedMessage` in the request body
4. Gateway derives the Stacks address from the public key and verifies it matches the `ownerAddress`
5. Timestamps older than 5 minutes are rejected (replay protection)

The SDK's `createAgent`, `updateAgent`, and `deleteAgent` functions handle signing automatically.

## Payment Flow (Proxy Detail)

When a client calls a priced tool through `/mcp?id=serverId`:

1. Gateway looks up the server config and tool pricing from Redis
2. If no `payment-signature` header: return 402 with `payment-required` header listing accepted tokens and price
3. If `payment-signature` present:
   - Decode the base64 `PaymentPayloadV2`
   - Settle via the x402 relay (`X402PaymentVerifier.settle()`)
   - Dedup by transaction ID (atomic Redis SET NX)
   - Forward the JSON-RPC request to the upstream MCP server
   - Fire hooks asynchronously (logging, analytics)
   - Return the upstream response with a `payment-response` header

## Hooks

The gateway wires three hooks at startup:

1. **LoggingHook** -- Structured console output per request
2. **X402MonetizationHook** -- Payment audit logging
3. **AnalyticsHook** -- Redis metrics (calls, errors, revenue) + optional PostgreSQL dual-write + error rate alerting

Custom hooks implement the `Hook` interface from `stackai-x402/hooks`.

## Redis Storage

All state is stored in Redis with 30-day TTL:

```
server:{serverId}:config           Server configuration (JSON)
server:{serverId}:tools            Introspected tool list (JSON)
server:{serverId}:ownerAddress     Owner's Stacks address
server:{serverId}:lastSeen         ISO timestamp
payment:{txid}                     Dedup marker ('used', 30-day TTL)
analytics:{serverId}:*             Analytics counters
moltbook:agent-registrations       Queue for Moltbook service
```

## Testing

```bash
pnpm test
```

71 tests covering proxy logic, server registration, agent CRUD, auth verification, and hook behavior.

## License

MIT
