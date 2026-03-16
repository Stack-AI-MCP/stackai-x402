# stackai-x402

TypeScript SDK for x402 HTTP payments on Stacks Bitcoin L2. Handles wallet generation, automatic 402 payment flows, and agent lifecycle management.

## Installation

```bash
pnpm add stackai-x402
```

## Two Roles

The SDK serves two roles:

- **Consumer** -- An AI agent or client that pays for tool calls. Uses a private key to sign payments locally when it encounters HTTP 402 responses.
- **Provider** -- A developer or service that registers agents and monetizes MCP server tools through the gateway.

## Consumer API

### Generate a Wallet

```typescript
import { generateAgentWallet } from 'stackai-x402'

const wallet = generateAgentWallet('mainnet')
// {
//   privateKey: string,  // 64-char hex
//   address: string,     // SP... (mainnet) or ST... (testnet)
//   network: 'mainnet'
// }
```

### Check Balance

```typescript
import { getBalance } from 'stackai-x402'

const balance = await getBalance('SP...address', 'mainnet')
// {
//   balance: string,  // available STX in microSTX
//   locked: string,   // stacked STX in microSTX
//   nonce: number
// }
```

### Create an Agent Client

The core consumer function. Returns an axios instance that intercepts 402 responses, signs a Stacks transaction with your private key, and retries the request automatically.

```typescript
import { createAgentClient } from 'stackai-x402'

const client = createAgentClient(privateKey, 'mainnet')

// Use like normal axios -- 402s are handled transparently
const response = await client.post('https://gateway.example.com/mcp?id=server123', {
  jsonrpc: '2.0',
  method: 'tools/call',
  params: { name: 'swap-tokens', arguments: { tokenA: 'STX', tokenB: 'sBTC', amount: '100' } },
  id: 1,
})

console.log(response.data) // tool result
```

The private key signs transactions locally. It is never sent over the network.

### Lower-Level Wrappers

If you need more control, use the re-exported `x402-stacks` functions:

```typescript
import { wrapAxiosWithPayment, decodePaymentRequired, decodePaymentResponse } from 'stackai-x402'
```

- `wrapAxiosWithPayment` -- Wraps an existing axios instance with 402 handling
- `decodePaymentRequired` -- Decodes the base64 `payment-required` header
- `decodePaymentResponse` -- Decodes the base64 `payment-response` header

## Provider API

All provider functions communicate with the gateway and use Stacks message signing for authentication. The private key signs a timestamped message (5-minute replay window) -- it does not sign blockchain transactions.

### Create an Agent

```typescript
import { createAgent } from 'stackai-x402'

const agent = await createAgent('https://gateway.example.com', privateKey, {
  name: 'Bitcoin DeFi Agent',
  description: 'Swap, lend, and bridge on Stacks',
  tools: [
    { serverId: 'srv_abc', toolName: 'swap-tokens', price: 0.01 },
    { serverId: 'srv_abc', toolName: 'get-price', price: 0 },
    { serverId: 'srv_xyz', toolName: 'deposit-btc', price: 0.05 },
  ],
  moltbookName: 'defi-agent',     // optional: Moltbook username
  systemPrompt: 'You are a DeFi assistant.', // optional
  starterPrompts: ['What can you do?'],       // optional
  network: 'mainnet',                         // optional, defaults to mainnet
})

console.log(agent.agentId) // ULID
```

### List Agents

```typescript
import { listAgents } from 'stackai-x402'

const result = await listAgents('https://gateway.example.com', { page: 1, limit: 24 })
// {
//   agents: AgentConfig[],
//   pagination: { page, limit, total, pages }
// }
```

### Get Agent

```typescript
import { getAgent } from 'stackai-x402'

const agent = await getAgent('https://gateway.example.com', agentId)
```

### Update Agent

```typescript
import { updateAgent } from 'stackai-x402'

const updated = await updateAgent('https://gateway.example.com', privateKey, agentId, {
  name: 'Updated Name',
  tools: [{ serverId: 'srv_abc', toolName: 'new-tool', price: 0.02 }],
})
```

### Delete Agent

```typescript
import { deleteAgent } from 'stackai-x402'

await deleteAgent('https://gateway.example.com', privateKey, agentId)
```

### List Transactions

```typescript
import { listTransactions } from 'stackai-x402'

const result = await listTransactions('https://gateway.example.com', {
  page: 1,
  limit: 50,
  serverId: 'srv_abc',  // optional filter
  agentId: 'agent123',  // optional filter
})
// {
//   transactions: TransactionRecord[],
//   pagination: { page, limit, total, pages }
// }
```

### Discover Agents

```typescript
import { discoverAgents } from 'stackai-x402'

const result = await discoverAgents('https://gateway.example.com')
// same shape as listAgents response
```

## Hooks

Hooks are async, non-blocking observers that fire after each tool call. They cannot modify responses. Errors in hooks are silently swallowed.

### Hook Interface

```typescript
import type { Hook, RequestContext } from 'stackai-x402/hooks'

interface RequestContext {
  serverId: string
  toolName: string
  payer?: string          // Stacks address (undefined for free tools)
  txid?: string           // on-chain tx ID (undefined for free tools)
  amount?: string         // micro-units (undefined for free tools)
  token?: string          // 'STX' | 'sBTC' | 'USDCx' (undefined for free tools)
  success: boolean
  durationMs: number
  timestamp: string       // ISO 8601
}

interface Hook {
  onRequest(ctx: RequestContext): Promise<void>
}
```

### Built-in Hooks

```typescript
import { LoggingHook, X402MonetizationHook, AnalyticsHook } from 'stackai-x402/hooks'
```

| Hook | Purpose |
|------|---------|
| `LoggingHook` | Structured console logging. One line per tool call with timing, outcome, payer. Never logs raw payment signatures. |
| `X402MonetizationHook` | Payment context extraction. Logs paid calls for audit. |
| `AnalyticsHook` | Redis + PostgreSQL metrics. Tracks calls, errors, revenue, unique callers. Error rate alerting with 1-hour dedup. |

**AnalyticsHook Redis key schema:**

```
analytics:{serverId}:{YYYY-MM-DD}:calls          INCR per call
analytics:{serverId}:{YYYY-MM-DD}:errors         INCR on failed calls
analytics:{serverId}:{YYYY-MM-DD}:revenue:{tok}  INCRBY amount
analytics:{serverId}:1h:calls                    rolling 1h window (EX 3600)
analytics:{serverId}:1h:errors                   rolling 1h window (EX 3600)
analytics:{serverId}:callers                     PFADD unique callers
alert:{serverId}:error-rate                      SET NX EX 3600 (max 1/hour)
audit:{txHash}                                   SET with 90-day TTL
```

### Custom Hook

```typescript
import type { Hook, RequestContext } from 'stackai-x402/hooks'

class SlackAlertHook implements Hook {
  async onRequest(ctx: RequestContext) {
    if (!ctx.success) {
      await fetch(SLACK_WEBHOOK, {
        method: 'POST',
        body: JSON.stringify({ text: `Tool ${ctx.toolName} failed on ${ctx.serverId}` }),
      })
    }
  }
}
```

## Types

```typescript
import type {
  AgentConfig,
  AgentTool,
  CreateAgentOptions,
  AgentListResponse,
  TransactionRecord,
  TransactionListResponse,
} from 'stackai-x402/types'
```

### AgentTool

```typescript
interface AgentTool {
  serverId: string    // upstream MCP server ID
  toolName: string    // tool name on the upstream server
  price: number       // USD price per call (0 = free)
}
```

### AgentConfig

```typescript
interface AgentConfig {
  agentId: string
  name: string
  description: string
  ownerAddress: string          // Stacks address (payment recipient + auth)
  moltbookAgentId?: string
  moltbookName?: string
  tools: AgentTool[]
  systemPrompt?: string
  starterPrompts?: string[]
  network: 'mainnet' | 'testnet'
  createdAt: string
  updatedAt: string
}
```

### TransactionRecord

```typescript
interface TransactionRecord {
  id: string
  status: 'settled' | 'free' | 'failed'
  serverId: string
  serverName: string
  agentId?: string
  agentName?: string
  moltbookName?: string
  toolName: string
  amount: string
  token: string
  network: 'mainnet' | 'testnet'
  payer: string
  txHash?: string
  timestamp: string
}
```

## Sub-path Exports

The package exposes granular entry points:

| Import Path | Contents |
|-------------|----------|
| `stackai-x402` | Main entry -- all consumer and provider functions |
| `stackai-x402/client` | `createAgentClient`, `wrapAxios`, `wrapAxiosWithPayment`, decode helpers |
| `stackai-x402/server` | `createAgent`, `updateAgent`, `deleteAgent`, `listAgents`, `getAgent`, `listTransactions` |
| `stackai-x402/proxy` | `generateAgentWallet`, `getBalance`, `discoverAgents` |
| `stackai-x402/hooks` | `Hook`, `RequestContext`, `LoggingHook`, `X402MonetizationHook`, `AnalyticsHook` |
| `stackai-x402/types` | All shared TypeScript interfaces |
| `stackai-x402/internal` | SDK internals -- crypto, price conversion, `RedisLike` interface (not part of public API) |

## Supported Tokens

| Token | Networks | Description |
|-------|----------|-------------|
| STX | mainnet, testnet | Native Stacks token |
| sBTC | mainnet, testnet | Wrapped Bitcoin on Stacks |
| USDCx | mainnet | Circle xReserve USDC |

## Dependencies

- `@stacks/network` -- Stacks network configuration
- `@stacks/transactions` -- Transaction building and signing
- `axios` -- HTTP client
- `x402-stacks` -- x402 protocol primitives (payment encoding, verification)

## License

MIT
