import { describe, it, expect, vi, beforeEach } from 'vitest'
import { broadcastTransaction } from './relay-client.js'

const RELAY_URL = 'https://x402-relay.aibtc.com/broadcast'
const SAMPLE_HEX = 'deadbeef'
const MOCK_TXID = 'aabbcc0011223344556677889900aabbcc0011223344556677889900aabbcc00'

describe('broadcastTransaction', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs txHex to the relay endpoint as JSON', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ txid: MOCK_TXID }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', mockFetch)

    await broadcastTransaction(SAMPLE_HEX, RELAY_URL)

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe(RELAY_URL)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ txHex: SAMPLE_HEX })
  })

  it('returns the txid from the relay response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ txid: MOCK_TXID }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const result = await broadcastTransaction(SAMPLE_HEX, RELAY_URL)
    expect(result).toEqual({ txid: MOCK_TXID })
  })

  it('throws when relay response is 200 but missing txid field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'queued' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(broadcastTransaction(SAMPLE_HEX, RELAY_URL)).rejects.toThrow('missing txid field')
  })

  it('throws on non-OK HTTP response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('bad request', { status: 400 })),
    )

    await expect(broadcastTransaction(SAMPLE_HEX, RELAY_URL)).rejects.toThrow('HTTP 400')
  })

  it('throws on network failure (fetch rejects)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network error')),
    )

    await expect(broadcastTransaction(SAMPLE_HEX, RELAY_URL)).rejects.toThrow('network error')
  })
})
