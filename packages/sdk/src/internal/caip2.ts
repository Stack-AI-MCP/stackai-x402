const CAIP2_MAP: Record<'mainnet' | 'testnet', string> = {
  mainnet: 'stacks:1',
  testnet: 'stacks:2147483648',
}

export function networkToCAIP2(network: 'mainnet' | 'testnet'): string {
  const id = CAIP2_MAP[network]
  // Defensive guard: TypeScript callers can't reach this at compile time, but
  // runtime callers passing dynamic/JSON-derived values will get a clear error
  // instead of returning undefined.
  if (id === undefined) {
    throw new Error(`Unknown network: ${network}`)
  }
  return id
}
