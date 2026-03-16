import { z } from 'zod'

const ConfigSchema = z.object({
  GATEWAY_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'GATEWAY_ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),
  RELAY_URL: z.string().url('RELAY_URL must be a valid URL'),
  TESTNET_RELAY_URL: z.string().url().default('https://x402-relay.aibtc.dev'),
  TOKEN_PRICE_STX: z.coerce.number().positive().default(3.0),
  TOKEN_PRICE_SBTC: z.coerce.number().positive().default(100_000.0),
  TOKEN_PRICE_USDCX: z.coerce.number().positive().default(1.0),
  PORT: z.coerce.number().optional().default(3001),
  OPERATOR_KEY: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  MOLTBOOK_API_KEY: z.string().optional(),
})

export type Config = z.infer<typeof ConfigSchema>

/**
 * Parse and validate environment variables at startup.
 * Throws a ZodError with a clear message if required vars are missing or malformed.
 * Call this once at app bootstrap — never import process.env directly in service code.
 */
export function parseConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse(env)
}
