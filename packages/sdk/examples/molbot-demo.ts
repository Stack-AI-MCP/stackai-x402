#!/usr/bin/env tsx
// ─── Molbot Demo ───────────────────────────────────────────────────────────
// End-to-end demo: two autonomous agents interact via x402 payments.
//
// Agent A: Registers a weather tool provider ($0.001/call), links Moltbook
// Agent B: Discovers Agent A, calls the weather tool, x402 payment settles
// Both check transaction history and verify payments
//
// Usage:
//   GATEWAY_URL=http://localhost:3001 \
//   AGENT_A_KEY=<hex-private-key> \
//   AGENT_B_KEY=<hex-private-key> \
//   npx tsx examples/molbot-demo.ts
//
// Or generate fresh wallets (testnet only):
//   GATEWAY_URL=http://localhost:3001 npx tsx examples/molbot-demo.ts --generate
// ────────────────────────────────────────────────────────────────────────────

import {
  generateAgentWallet,
  getBalance,
  createAgent,
  discoverAgents,
  getAgent,
  listTransactions,
  createAgentClient,
} from '../src/index.js'

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:3001'
const NETWORK = 'testnet' as const

// ─── Helpers ───────────────────────────────────────────────────────────────

function log(label: string, msg: string) {
  console.log(`\n[${'='.repeat(60)}]`)
  console.log(`[${label}] ${msg}`)
  console.log(`[${'='.repeat(60)}]`)
}

function step(n: number, title: string) {
  console.log(`\n── Step ${n}: ${title} ${'─'.repeat(50 - title.length)}`)
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const useGenerated = process.argv.includes('--generate')

  console.log('\n🤖 Molbot x402 Demo — Two agents interacting via payments')
  console.log(`   Gateway: ${GATEWAY_URL}`)
  console.log(`   Network: ${NETWORK}\n`)

  // ── Step 1: Wallet setup ──────────────────────────────────────────────

  step(1, 'Wallet Setup')

  let agentAKey: string
  let agentBKey: string

  if (useGenerated) {
    console.log('Generating fresh testnet wallets...')
    const walletA = generateAgentWallet(NETWORK)
    const walletB = generateAgentWallet(NETWORK)
    agentAKey = walletA.privateKey
    agentBKey = walletB.privateKey
    console.log(`  Agent A: ${walletA.address}`)
    console.log(`  Agent B: ${walletB.address}`)
    console.log('\n⚠️  Fund these addresses with testnet STX before running paid calls')
  } else {
    agentAKey = process.env.AGENT_A_KEY ?? ''
    agentBKey = process.env.AGENT_B_KEY ?? ''
    if (!agentAKey || !agentBKey) {
      console.error('ERROR: Set AGENT_A_KEY and AGENT_B_KEY env vars, or use --generate')
      process.exit(1)
    }
  }

  // Check balances using actual private keys
  try {
    // Import to derive address from the actual key
    const { getAddressFromPrivateKey, TransactionVersion } = await import('@stacks/transactions')
    const version = TransactionVersion.Testnet
    const addrA = getAddressFromPrivateKey(agentAKey, version)
    const addrB = getAddressFromPrivateKey(agentBKey, version)
    console.log(`  Agent A address: ${addrA}`)
    console.log(`  Agent B address: ${addrB}`)

    const balanceA = await getBalance(addrA, NETWORK)
    const balanceB = await getBalance(addrB, NETWORK)
    console.log(`  Agent A balance: ${(Number(balanceA.balance) / 1_000_000).toFixed(2)} STX`)
    console.log(`  Agent B balance: ${(Number(balanceB.balance) / 1_000_000).toFixed(2)} STX`)
  } catch {
    console.log('  (Could not check balances — Hiro API may be unavailable)')
  }

  // ── Step 2: Agent A registers as a provider ───────────────────────────

  step(2, 'Agent A registers as provider')

  // Agent A needs a registered MCP server first. In production, the server
  // would be registered separately. For this demo, we assume a server exists
  // and Agent A creates an agent config that wraps its tools.

  let agentA
  try {
    agentA = await createAgent(GATEWAY_URL, agentAKey, {
      name: 'WeatherBot',
      description: 'Real-time weather data for any location — powered by x402 micropayments',
      // In a real demo, you'd reference tools from a registered MCP server.
      // For standalone testing, we use a placeholder tool reference.
      tools: [{ serverId: 'demo-server', toolName: 'get_weather', price: 0.001 }],
      moltbookName: 'weatherbot',
      network: NETWORK,
      systemPrompt: 'You are a weather data provider. Return accurate weather information.',
      starterPrompts: ['What is the weather in New York?', 'Give me a 5-day forecast for Tokyo'],
    })
    console.log(`  Created agent: ${agentA.agentId}`)
    console.log(`  Owner: ${agentA.ownerAddress}`)
    console.log(`  Moltbook: https://www.moltbook.com/u/${agentA.moltbookName}`)
  } catch (err) {
    console.log(`  Agent creation: ${(err as Error).message}`)
    console.log('  (This is expected if the gateway is not running)')
  }

  // ── Step 3: Agent B discovers Agent A ─────────────────────────────────

  step(3, 'Agent B discovers agents')

  try {
    const { agents, pagination } = await discoverAgents(GATEWAY_URL)
    console.log(`  Found ${pagination.total} agent(s) on the gateway:`)
    for (const agent of agents) {
      console.log(`    - ${agent.name} (${agent.agentId}) — ${agent.tools.length} tools`)
      if (agent.moltbookName) {
        console.log(`      Moltbook: https://www.moltbook.com/u/${agent.moltbookName}`)
      }
    }
  } catch (err) {
    console.log(`  Discovery: ${(err as Error).message}`)
  }

  // ── Step 4: Agent B calls Agent A's tool via x402 ─────────────────────

  step(4, 'Agent B calls tool with x402 payment')

  if (agentA) {
    try {
      // Create an x402-enabled HTTP client for Agent B
      const client = createAgentClient(agentBKey, NETWORK)

      // Call Agent A's agent endpoint
      // The gateway handles: 402 challenge → payment signing → settlement → forward
      const response = await client.post(`${GATEWAY_URL}/api/v1/agent/${agentA.agentId}`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'get_weather',
          arguments: { location: 'San Francisco, CA' },
        },
      })

      console.log(`  Response status: ${response.status}`)
      console.log(`  Result:`, JSON.stringify(response.data, null, 2).slice(0, 200))
    } catch (err) {
      console.log(`  Tool call: ${(err as Error).message}`)
      console.log('  (Expected if no upstream server is registered with this tool)')
    }
  } else {
    console.log('  Skipped — Agent A was not created')
  }

  // ── Step 5: Check transaction history ─────────────────────────────────

  step(5, 'Check transaction history')

  try {
    const { transactions, pagination } = await listTransactions(GATEWAY_URL, { limit: 10 })
    console.log(`  ${pagination.total} total transaction(s)`)
    for (const tx of transactions.slice(0, 5)) {
      const amount = !tx.amount || tx.amount === '0' ? 'Free' : `${tx.amount} ${tx.token}`
      console.log(`    [${tx.status}] ${tx.toolName} — ${amount} (${tx.network})`)
      if (tx.moltbookName) {
        console.log(`      Moltbook: https://www.moltbook.com/u/${tx.moltbookName}`)
      }
    }
  } catch (err) {
    console.log(`  Transactions: ${(err as Error).message}`)
  }

  // ── Done ──────────────────────────────────────────────────────────────

  log('DONE', 'Molbot demo complete')
  console.log('\nKey takeaways:')
  console.log('  1. Agents are configurations — no server hosting required')
  console.log('  2. x402 payments settle automatically per tool call')
  console.log('  3. Moltbook profiles link agents to social identities')
  console.log('  4. All transactions are visible in the public Explorer')
  console.log('  5. SDK handles wallet generation, signing, and discovery\n')
}

main().catch((err) => {
  console.error('Demo failed:', err)
  process.exit(1)
})
