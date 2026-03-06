/**
 * Broadcasts a sponsored transaction hex string to the x402 relay.
 * The relay pays the sponsorship fee and submits to the Stacks network.
 *
 * @param txHex    Hex-encoded serialized transaction (no 0x prefix)
 * @param relayUrl Full URL of the relay broadcast endpoint (e.g. from RELAY_URL env-var)
 * @returns The transaction ID (txid) assigned by the relay after broadcast.
 * @throws Error with HTTP status if relay rejects the transaction
 * @throws Error if relay response is 200 but lacks a `txid` field
 */
export async function broadcastTransaction(
  txHex: string,
  relayUrl: string,
): Promise<{ txid: string }> {
  const res = await fetch(relayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txHex }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)')
    throw new Error(`Relay responded with HTTP ${res.status}: ${body}`)
  }

  const data = (await res.json()) as { txid?: string }
  if (typeof data.txid !== 'string') {
    throw new Error(`Relay response missing txid field: ${JSON.stringify(data)}`)
  }
  return { txid: data.txid }
}
