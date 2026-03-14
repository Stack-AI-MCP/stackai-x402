// Public API
export { createAgentClient, wrapAxios, wrapAxiosWithPayment, decodePaymentRequired, decodePaymentResponse } from './client/index.js'
export type { AxiosLike } from './client/index.js'

// Moltbook social registration
export { registerMoltbookAgent, MoltbookError } from './moltbook/index.js'
export type {
  MoltbookAgentConfig,
  MoltbookRegistrationResult,
  MoltbookErrorCode,
} from './moltbook/index.js'
