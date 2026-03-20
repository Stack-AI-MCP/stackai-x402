import { Hono } from 'hono'
import { z } from 'zod'
import type { AgentStore } from '../state/agent-store.js'
import { handlePaymentEvent } from '../events/event-handler.js'
import type { ContentGenerator } from '../ai/types.js'
import { logger, errCtx } from '../logger.js'

const log = logger.child('routes:events')

const PaymentEventSchema = z.object({
  serverId: z.string().min(1),
  tool: z.string().min(1),
  amount: z.string().min(1),
  token: z.string().min(1),
  fromAddress: z.string().min(1),
  txid: z.string().min(1),
})

export function eventRoutes(agentStore: AgentStore, contentGenerator: ContentGenerator): Hono {
  const app = new Hono()

  // Gateway webhook receiver
  app.post('/events', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const parsed = PaymentEventSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]
      return c.json({ error: `Validation failed: ${firstError.message} (${firstError.path.join('.')})` }, 400)
    }

    // Best-effort — don't fail the webhook
    void handlePaymentEvent(parsed.data, agentStore, contentGenerator).catch((err) => {
      log.error('async handler error', errCtx(err))
    })

    return c.json({ received: true })
  })

  return app
}
