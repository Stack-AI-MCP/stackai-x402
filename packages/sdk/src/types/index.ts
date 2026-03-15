// ─── Agent Configuration Types ──────────────────────────────────────────────
// Shared between gateway, SDK clients, and web app.

/** A tool selected from an upstream MCP server with agent-specific pricing. */
export interface AgentTool {
  /** ID of the upstream MCP server this tool belongs to. */
  serverId: string
  /** Name of the tool on the upstream server. */
  toolName: string
  /** USD price per call. 0 = free. */
  price: number
}

/** Full agent configuration as stored in the gateway. */
export interface AgentConfig {
  agentId: string
  name: string
  description: string
  /** Stacks address of the agent owner (payment recipient + auth). */
  ownerAddress: string
  /** Moltbook agent ID (if linked). */
  moltbookAgentId?: string
  /** Moltbook username for moltbook.com/u/{name} links. */
  moltbookName?: string
  tools: AgentTool[]
  systemPrompt?: string
  starterPrompts?: string[]
  network: 'mainnet' | 'testnet'
  createdAt: string
  updatedAt: string
}

/** Options for creating a new agent via the SDK. */
export interface CreateAgentOptions {
  name: string
  description: string
  tools: AgentTool[]
  moltbookName?: string
  systemPrompt?: string
  starterPrompts?: string[]
  network?: 'mainnet' | 'testnet'
}

/** Paginated agent list response from the gateway. */
export interface AgentListResponse {
  agents: AgentConfig[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
}

/** A settled or free transaction record from the Explorer. */
export interface TransactionRecord {
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

/** Paginated transaction list response. */
export interface TransactionListResponse {
  transactions: TransactionRecord[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
}
