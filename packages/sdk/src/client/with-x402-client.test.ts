import { describe, it, expect, vi } from 'vitest'
import { createAgentClient } from './with-x402-client.js'

// Mock x402-stacks so tests don't require real Stacks keys or network calls
vi.mock('x402-stacks', () => ({
  privateKeyToAccount: vi.fn((key: string, network: string) => ({ address: 'SP1TEST', privateKey: key, network })),
  wrapAxiosWithPayment: vi.fn((axiosInstance: unknown) => axiosInstance),
}))

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({ _mock: 'axios-instance' })),
  },
}))

describe('createAgentClient', () => {
  it('returns an axios instance wrapped with payment interceptor', () => {
    const client = createAgentClient('mock-private-key', 'testnet')
    // wrapAxiosWithPayment returns the axios instance unchanged (mocked above)
    expect(client).toEqual({ _mock: 'axios-instance' })
  })

  it('calls privateKeyToAccount with the provided key and network', async () => {
    const { privateKeyToAccount } = await import('x402-stacks')
    vi.mocked(privateKeyToAccount).mockClear()

    createAgentClient('test-key-123', 'mainnet')

    expect(vi.mocked(privateKeyToAccount)).toHaveBeenCalledWith('test-key-123', 'mainnet')
  })
})
