// ─── Public API ─────────────────────────────────────────────────────────────

// x402 payment client wrappers
export { createAgentClient, wrapAxios, wrapAxiosWithPayment, decodePaymentRequired, decodePaymentResponse } from './client/index.js'
export type { AxiosLike } from './client/index.js'

// Agent management (server-side SDK — private key signing)
export { createAgent, listAgents, getAgent, updateAgent, deleteAgent, listTransactions } from './server/index.js'

// Wallet + discovery helpers
export { generateAgentWallet, getBalance, discoverAgents } from './proxy/index.js'
export type { GeneratedWallet, StxBalance } from './proxy/index.js'

// Shared types
export type { AgentConfig, AgentTool, CreateAgentOptions, AgentListResponse, TransactionRecord, TransactionListResponse } from './types/index.js'
