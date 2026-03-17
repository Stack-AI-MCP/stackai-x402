import { Hono } from 'hono'
import type { AppEnv } from '../app.js'

const STACKS_RE = /^S[TPMN][0-9A-Z]{38,}$/

export const telegramRouter = new Hono<AppEnv>()

/**
 * Check if a wallet address has Telegram linked.
 * The web app polls this after the user clicks "Connect Telegram".
 */
telegramRouter.get('/status', async (c) => {
  const address = c.req.query('address')
  if (!address || !STACKS_RE.test(address)) {
    return c.json({ error: 'Valid Stacks address required', code: 'INVALID_REQUEST' }, 400)
  }

  const redis = c.get('redis')
  const chatId = await (redis as any).get(`tg:${address}`) // eslint-disable-line @typescript-eslint/no-explicit-any

  return c.json({
    connected: Boolean(chatId),
    ...(chatId && { chatId }),
  })
})

/**
 * Disconnect Telegram from a wallet address.
 */
telegramRouter.post('/disconnect', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.address || !STACKS_RE.test(body.address)) {
    return c.json({ error: 'Valid Stacks address required', code: 'INVALID_REQUEST' }, 400)
  }

  const redis = c.get('redis')
  await (redis as any).del(`tg:${body.address}`) // eslint-disable-line @typescript-eslint/no-explicit-any

  return c.json({ disconnected: true })
})
