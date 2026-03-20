// ─── Gateway Server Types ────────────────────────────────────────────────────

/** Tool definition as stored in the gateway's server:{id}:tools Redis key */
export interface GatewayToolDef {
  name: string
  description: string
  price: number
  acceptedTokens: string[]
  inputSchema?: Record<string, unknown>
}

/** Server config as stored in the gateway's server:{id}:config Redis key */
export interface GatewayServerConfig {
  serverId: string
  name: string
  description: string
  url: string
  recipientAddress: string
  network: string
  acceptedTokens: string[]
  toolPricing: Record<string, { price: number }>
  createdAt: string
}

/** Resolved server info with tools */
export interface GatewayServerInfo {
  config: GatewayServerConfig
  tools: GatewayToolDef[]
}

// ─── Agent Record ────────────────────────────────────────────────────────────

export interface MoltbookAgentRecord {
  id: string
  gatewayServerId?: string
  gatewayAgentId?: string

  moltbookApiKey: string
  moltbookName: string
  moltbookStatus: 'pending_claim' | 'active' | 'suspended'

  description: string
  gatewayUrl: string
  toolNames: string[]
  toolPricing?: Array<{ name: string; price: number; token: string }>

  skillMd?: string

  heartbeatIntervalHours: number
  heartbeatEnabled: boolean
  lastHeartbeat?: string
  nextHeartbeat?: string

  createdAt: string
  updatedAt: string
}

// ─── API Payloads ────────────────────────────────────────────────────────────

export interface CreateAgentRequest {
  moltbookApiKey: string
  moltbookName: string
  description: string
  gatewayServerId?: string
  gatewayAgentId?: string
  gatewayUrl: string
  toolNames: string[]
  toolPricing?: Array<{ name: string; price: number; token: string }>
  heartbeatIntervalHours?: number
}

export interface UpdateAgentRequest {
  heartbeatIntervalHours?: number
  heartbeatEnabled?: boolean
  description?: string
  toolNames?: string[]
  toolPricing?: Array<{ name: string; price: number; token: string }>
}

// ─── Gateway Event Payloads ──────────────────────────────────────────────────

export interface PaymentEventPayload {
  serverId: string
  tool: string
  amount: string
  token: string
  fromAddress: string
  txid: string
}

export interface ErrorAlertPayload {
  serverId: string
  agentId: string
  errorRate: number
  timestamp: number
}

// ─── Challenge ───────────────────────────────────────────────────────────────

export interface ChallengeResult {
  code: string
  answer: string
  /** Raw challenge text for debugging */
  rawChallenge: string
  /** Math expression after word conversion */
  mathExpr: string
}

export interface VerificationResponse {
  success: boolean
  post?: { id: string }
  comment?: { id: string }
  error?: string
  _challenge: string
  _answer: string
}
