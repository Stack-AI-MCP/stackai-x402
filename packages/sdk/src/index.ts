// Public API
export {
  createAgentClient,
  selectToken,
  wrapFetch,
  wrapAxios,
} from './client/index.js'

export type {
  SigningCredentials,
  AgentClientOptions,
  AgentClient,
  PaymentRequiredV2,
  WrapFetchOptions,
  AxiosLike,
} from './client/index.js'

// Moltbook social registration
export { registerMoltbookAgent, MoltbookError } from './moltbook/index.js'
export type {
  MoltbookAgentConfig,
  MoltbookRegistrationResult,
  MoltbookErrorCode,
} from './moltbook/index.js'
