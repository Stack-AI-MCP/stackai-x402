export type TokenType = 'STX' | 'sBTC' | 'USDCx'

export interface TokenNetworkConfig {
  contractAddress: string | null
  functionName: string | null
}

export interface TokenConfig {
  decimals: number
  mainnet: TokenNetworkConfig
  testnet: TokenNetworkConfig
}

export const TOKEN_REGISTRY: Record<TokenType, TokenConfig> = {
  STX: {
    decimals: 6,
    mainnet: { contractAddress: null, functionName: null },
    testnet: { contractAddress: null, functionName: null },
  },
  sBTC: {
    decimals: 8,
    mainnet: {
      contractAddress: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token',
      functionName: 'transfer',
    },
    testnet: {
      contractAddress: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token',
      functionName: 'transfer',
    },
  },
  USDCx: {
    decimals: 6,
    mainnet: {
      contractAddress: 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx',
      functionName: 'transfer',
    },
    testnet: {
      contractAddress: 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx',
      functionName: 'transfer',
    },
  },
}
