#!/usr/bin/env tsx
// ─── StackAI x402 SDK — Provider + Consumer Quickstart ──────────────────────
//
// 10-step demo showing how to:
//   1. Derive your Stacks address and check balance
//   2. Register as a PROVIDER (monetize MCP tools via x402)
//   3. List agents on the gateway
//   4. Act as a CONSUMER (call a tool, handle 402 payment)
//   5. View transaction history
//   6. Enable Telegram notifications
//   7. Clean up
//
// Usage:
//   cp examples/.env.example .env
//   # Fill in at minimum STACKS_PRIVATE_KEY
//   pnpm tsx examples/quickstart.ts
//
// Or inline env vars:
//   STACKS_PRIVATE_KEY=<hex> GATEWAY_URL=http://localhost:3001 pnpm tsx examples/quickstart.ts
// ────────────────────────────────────────────────────────────────────────────

import {
  generateAgentWallet,
  getBalance,
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  listTransactions,
  deleteAgent,
  createAgentClient,
  discoverAgents,
} from '../src/index.js'
import { getAddressFromPrivateKey } from '@stacks/transactions'

// ─── Config from env ────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.STACKS_PRIVATE_KEY ?? ''
const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:3001'
const NETWORK = (process.env.NETWORK ?? 'testnet') as 'mainnet' | 'testnet'
const AGENT_NAME = process.env.AGENT_NAME ?? 'Quickstart Demo Agent'
const TELEGRAM_ENABLED = process.env.TELEGRAM_ENABLED === 'true'

// ─── Pretty output helpers ───────────────────────────────────────────────────

const line = '─'.repeat(60)

function step(n: number, title: string) {
  console.log(`\n${line}`)
  console.log(`  Step ${n}/10: ${title}`)
  console.log(line)
}

function ok(msg: string) { console.log(`  ✓ ${msg}`) }
function info(msg: string) { console.log(`  • ${msg}`) }
function warn(msg: string) { console.log(`  ⚠ ${msg}`) }

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 StackAI x402 SDK — Provider + Consumer Quickstart')
  console.log(`   Gateway : ${GATEWAY_URL}`)
  console.log(`   Network : ${NETWORK}`)

  // ── Step 1: Generate or load wallet ───────────────────────────────────────
  step(1, 'Wallet setup')

  let privateKey = PRIVATE_KEY
  if (!privateKey) {
    warn('STACKS_PRIVATE_KEY not set — generating a fresh testnet wallet')
    const wallet = generateAgentWallet('testnet')
    privateKey = wallet.privateKey
    ok(`Generated wallet: ${wallet.address}`)
    info('Fund this address with testnet STX at https://explorer.hiro.so/?chain=testnet')
    info('Then set STACKS_PRIVATE_KEY in .env and re-run')
  }

  const ownerAddress = getAddressFromPrivateKey(privateKey, NETWORK)
  ok(`Address: ${ownerAddress}`)

  // ── Step 2: Check STX balance ─────────────────────────────────────────────
  step(2, 'Check STX balance')

  try {
    const bal = await getBalance(ownerAddress, NETWORK)
    const stx = (Number(bal.balance) / 1_000_000).toFixed(6)
    const locked = (Number(bal.locked) / 1_000_000).toFixed(6)
    ok(`Balance : ${stx} STX (${locked} locked)`)
    ok(`Nonce   : ${bal.nonce}`)
    if (Number(bal.balance) === 0) {
      warn('Balance is 0 — paid tool calls will fail. Fund the address first.')
    }
  } catch {
    warn('Could not fetch balance — Hiro API may be unavailable')
  }

  // ── Step 3: Register as PROVIDER ──────────────────────────────────────────
  step(3, 'Register as PROVIDER (create agent)')
  info('Signing registration with your private key…')

  let agentId = ''
  try {
    const agent = await createAgent(GATEWAY_URL, privateKey, {
      name: AGENT_NAME,
      description: 'Demo agent created by the StackAI x402 SDK quickstart script',
      tools: [
        { serverId: 'demo-server', toolName: 'hello_world', price: 0.001 },
        { serverId: 'demo-server', toolName: 'echo',        price: 0.000 },
      ],
      systemPrompt: 'You are a helpful demo agent showcasing x402 micropayments on Stacks.',
      starterPrompts: [
        'Say hello!',
        'What tools do you have?',
        'How does x402 payment work?',
      ],
      network: NETWORK,
    })
    agentId = agent.agentId
    ok(`Agent created : ${agent.agentId}`)
    ok(`Owner         : ${agent.ownerAddress}`)
    ok(`Tools         : ${agent.tools.length}`)
    if (agent.moltbookName) {
      ok(`Moltbook      : https://www.moltbook.com/u/${agent.moltbookName}`)
    }
  } catch (err) {
    warn(`Agent creation failed: ${(err as Error).message}`)
    info('(Is the gateway running? Set GATEWAY_URL in .env)')
  }

  // ── Step 4: Fetch agent details ────────────────────────────────────────────
  step(4, 'Fetch agent details (getAgent)')

  if (agentId) {
    try {
      const fetched = await getAgent(GATEWAY_URL, agentId)
      ok(`Fetched: ${fetched.name} (${fetched.agentId})`)
      ok(`Created: ${fetched.createdAt}`)
    } catch (err) {
      warn(`getAgent failed: ${(err as Error).message}`)
    }
  } else {
    info('Skipped — no agent was created')
  }

  // ── Step 5: List all agents (CONSUMER discovery) ───────────────────────────
  step(5, 'List all agents on gateway (consumer discovery)')

  try {
    const { agents, pagination } = await discoverAgents(GATEWAY_URL)
    ok(`Found ${pagination.total} agent(s) on ${GATEWAY_URL}`)
    for (const a of agents.slice(0, 5)) {
      info(`  ${a.name} — ${a.tools.length} tools (${a.agentId})`)
    }
    if (pagination.total > 5) {
      info(`  … and ${pagination.total - 5} more`)
    }
  } catch (err) {
    warn(`listAgents failed: ${(err as Error).message}`)
  }

  // ── Step 6: Update agent ───────────────────────────────────────────────────
  step(6, 'Update agent (add description)')

  if (agentId) {
    try {
      const updated = await updateAgent(GATEWAY_URL, privateKey, agentId, {
        description: 'Updated by quickstart script — x402 micropayments on Stacks!',
      })
      ok(`Updated: ${updated.name}`)
      ok(`New description: ${updated.description}`)
    } catch (err) {
      warn(`updateAgent failed: ${(err as Error).message}`)
    }
  } else {
    info('Skipped — no agent was created')
  }

  // ── Step 7: Act as CONSUMER — call a free tool ────────────────────────────
  step(7, 'Act as CONSUMER — call a free tool (dry run)')

  try {
    const client = createAgentClient(privateKey, NETWORK)
    ok('Created x402 axios client (auto-handles 402 payment challenges)')

    if (agentId) {
      info(`Calling echo tool on agent ${agentId}…`)
      try {
        const res = await client.post(`${GATEWAY_URL}/api/v1/agent/${agentId}`, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'echo', arguments: { message: 'Hello from StackAI x402!' } },
        })
        ok(`Response status: ${res.status}`)
        info(`Result: ${JSON.stringify(res.data).slice(0, 120)}`)
      } catch (err) {
        info(`Tool call returned: ${(err as Error).message}`)
        info('(Expected if upstream demo-server is not registered)')
      }
    } else {
      info('No agent to call — skipping live tool call')
      info('In production: client.post(gatewayUrl + /api/v1/agent/<id>, { ... })')
      info('The client auto-handles 402 → signs STX/sBTC → retries → returns result')
    }
  } catch (err) {
    warn(`Client creation failed: ${(err as Error).message}`)
  }

  // ── Step 8: View transaction history ──────────────────────────────────────
  step(8, 'View transaction history')

  try {
    const { transactions, pagination } = await listTransactions(GATEWAY_URL, {
      limit: 5,
      agentId: agentId || undefined,
    })
    ok(`${pagination.total} total transaction(s)`)
    for (const tx of transactions) {
      const amount = !tx.amount || tx.amount === '0' ? 'free' : `${tx.amount} ${tx.token}`
      info(`  [${tx.status}] ${tx.toolName} — ${amount}`)
    }
    if (transactions.length === 0) {
      info('No transactions yet — call a paid tool to see them here')
    }
  } catch (err) {
    warn(`listTransactions failed: ${(err as Error).message}`)
  }

  // ── Step 9: Telegram notifications ────────────────────────────────────────
  step(9, 'Telegram notifications')

  if (TELEGRAM_ENABLED) {
    const deepLink = `https://t.me/StackAI402Bot?start=${agentId || 'your_agent_id'}`
    ok('Telegram notifications are enabled!')
    info(`Open this link to connect: ${deepLink}`)
    info('You will receive alerts for: payments received, daily summaries, agent activity')
  } else {
    info('Telegram not configured (set TELEGRAM_ENABLED=true in .env)')
    info(`After registration, connect at: https://t.me/StackAI402Bot?start=<agentId>`)
    info('Get notified for: 💰 payments · 🤖 heartbeats · 📊 daily summaries')
  }

  // ── Step 10: Cleanup ───────────────────────────────────────────────────────
  step(10, 'Cleanup — delete test agent')

  if (agentId) {
    try {
      await deleteAgent(GATEWAY_URL, privateKey, agentId)
      ok(`Deleted agent ${agentId}`)
    } catch (err) {
      warn(`deleteAgent failed: ${(err as Error).message}`)
    }
  } else {
    info('Nothing to clean up')
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${line}`)
  console.log('  Quickstart complete!')
  console.log(line)
  console.log('\nNext steps:')
  console.log('  1. Register your real MCP server at ' + GATEWAY_URL + '/register')
  console.log('  2. Set a price per tool — STX, sBTC, or USDCx')
  console.log('  3. Share your agent URL: ' + GATEWAY_URL + '/chat/<agentId>')
  console.log('  4. Watch payments arrive in your Telegram bot')
  console.log('  5. Track all transactions in the Explorer: ' + GATEWAY_URL + '/analytics')
  console.log()
}

main().catch((err) => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
