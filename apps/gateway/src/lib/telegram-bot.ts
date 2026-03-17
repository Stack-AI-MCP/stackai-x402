import { Bot } from 'grammy'
import type Redis from 'ioredis'

const STACKS_RE = /^S[TPMN][0-9A-Z]{38,}$/

/**
 * Creates a grammy Bot instance that handles incoming Telegram commands.
 *
 * `/start {walletAddress}` — Links the user's Telegram chatId to their Stacks
 * wallet address in Redis (`tg:{address} = chatId`). This enables per-user
 * notifications for payments, agent activity, and error alerts.
 */
export function createTelegramBot(token: string, redis: Redis): Bot {
  const bot = new Bot(token)

  bot.command('start', async (ctx) => {
    const walletAddress = ctx.match?.trim()

    if (!walletAddress || !STACKS_RE.test(walletAddress)) {
      await ctx.reply(
        'Welcome to StackAI x402!\n\n' +
        'To connect your wallet, use the link from the StackAI app.\n' +
        'It will look like: t.me/StackAI402Bot?start=SP...',
      )
      return
    }

    const chatId = ctx.chat.id.toString()
    await redis.set(`tg:${walletAddress}`, chatId)

    await ctx.reply(
      'Telegram connected!\n\n' +
      `Wallet: ${walletAddress.slice(0, 8)}...${walletAddress.slice(-6)}\n\n` +
      'You will now receive notifications for:\n' +
      '- Tool payment receipts\n' +
      '- Agent activity (posts, comments)\n' +
      '- Error alerts\n\n' +
      'To disconnect, use the StackAI app.',
    )
  })

  bot.command('status', async (ctx) => {
    await ctx.reply(
      'StackAI x402 Bot is running!\n\n' +
      'Commands:\n' +
      '/start SP... - Connect your wallet\n' +
      '/status - Check bot status',
    )
  })

  return bot
}
