import { Hono } from 'hono'
import { z } from 'zod'
import { registerServer } from '../services/registration.service.js'
import type { AppEnv } from '../app.js'

const RegisterBodySchema = z.object({
  url: z.string().url('url must be a valid URL'),
  name: z.string().min(1, 'name is required'),
  description: z.string().optional(),
  recipientAddress: z
    .string()
    .regex(
      /^S[TPMN][0-9A-Z]{38,}$/,
      'recipientAddress must be a valid Stacks address (SP/ST/SM/SN prefix, min 40 chars)',
    ),
  acceptedTokens: z.array(z.enum(['STX', 'sBTC', 'USDCx'])).optional(),
  toolPricing: z.record(z.string(), z.object({ price: z.number() })).optional(),
  upstreamAuth: z.string().optional(),
  telegramChatId: z.string().optional(),
  webhookUrl: z.string().url().optional(),
})

export const serversRouter = new Hono<AppEnv>()

serversRouter.post('/', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Request body must be valid JSON', code: 'INVALID_REQUEST' }, 400)
  }

  const parsed = RegisterBodySchema.safeParse(body)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return c.json(
      { error: firstError.message, code: 'INVALID_REQUEST', field: firstError.path.join('.') },
      400,
    )
  }

  try {
    const result = await registerServer(parsed.data, {
      redis: c.get('redis'),
      encryptionKey: c.get('encryptionKey'),
    })
    return c.json(result, 201)
  } catch (err) {
    console.error('Registration failed:', err instanceof Error ? err.message : err)
    return c.json({ error: 'Registration failed', code: 'REGISTRATION_FAILED' }, 500)
  }
})
