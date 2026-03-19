import { Hono } from 'hono'
import type { AppEnv } from '../app.js'
import { verifyMessageSignature } from '../services/auth.service.js'

const STACKS_RE = /^S[TPMN][0-9A-Z]{38,}$/

export const telegramRouter = new Hono<AppEnv>()

/**
 * Check if a wallet address has Telegram linked.
 * The web app polls this after the user clicks "Connect Telegram".
 * Returns only { connected: boolean } — chatId is internal and not exposed.
 */
telegramRouter.get('/status', async (c) => {
  const address = c.req.query('address')
  if (!address || !STACKS_RE.test(address)) {
    return c.json({ error: 'Valid Stacks address required', code: 'INVALID_REQUEST' }, 400)
  }

  const redis = c.get('redis')
  const chatId = await (redis as any).get(`tg:${address}`) // eslint-disable-line @typescript-eslint/no-explicit-any

  return c.json({ connected: Boolean(chatId) })
})

/**
 * Disconnect Telegram from a wallet address.
 * Requires wallet signature to prevent unauthorized unlinking.
 */
telegramRouter.post('/disconnect', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.address || !STACKS_RE.test(body.address)) {
    return c.json({ error: 'Valid Stacks address required', code: 'INVALID_REQUEST' }, 400)
  }

  // Verify wallet ownership — same pattern as agent CRUD endpoints
  if (!body.signature || !body.publicKey || !body.signedMessage) {
    return c.json({ error: 'Signature, publicKey, and signedMessage are required', code: 'UNAUTHORIZED' }, 403)
  }

  const valid = verifyMessageSignature(
    { message: body.signedMessage, signature: body.signature, publicKey: body.publicKey },
    body.address,
  )
  if (!valid) {
    return c.json({ error: 'Invalid signature', code: 'UNAUTHORIZED' }, 403)
  }

  const redis = c.get('redis')
  await (redis as any).del(`tg:${body.address}`) // eslint-disable-line @typescript-eslint/no-explicit-any

  return c.json({ disconnected: true })
})
