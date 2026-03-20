import { z } from 'zod'

const envSchema = z.object({
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PORT: z.coerce.number().default(3003),
  SERVICE_SECRET: z.string().min(8, 'SERVICE_SECRET must be at least 8 characters'),
  GATEWAY_URL: z.string().url().default('http://localhost:3001'),
  AI_PROVIDER: z.enum(['openai', 'anthropic', 'template']).default('template'),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
})

export type Config = z.infer<typeof envSchema>

let _config: Config | null = null

export function loadConfig(): Config {
  if (_config) return _config
  _config = envSchema.parse(process.env)
  return _config
}
