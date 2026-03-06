import { describe, it, expect } from 'vitest'
import { TOKEN_REGISTRY } from './token-registry.js'

describe('TOKEN_REGISTRY', () => {
  it('STX has 6 decimals and no contract address on mainnet or testnet', () => {
    expect(TOKEN_REGISTRY.STX.decimals).toBe(6)
    expect(TOKEN_REGISTRY.STX.mainnet.contractAddress).toBeNull()
    expect(TOKEN_REGISTRY.STX.testnet.contractAddress).toBeNull()
    expect(TOKEN_REGISTRY.STX.mainnet.functionName).toBeNull()
    expect(TOKEN_REGISTRY.STX.testnet.functionName).toBeNull()
  })

  it('sBTC has 8 decimals and correct mainnet contract address', () => {
    expect(TOKEN_REGISTRY.sBTC.decimals).toBe(8)
    expect(TOKEN_REGISTRY.sBTC.mainnet.contractAddress).toBe(
      'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token',
    )
    expect(TOKEN_REGISTRY.sBTC.mainnet.functionName).toBe('transfer')
  })

  it('sBTC testnet uses the same contract address as mainnet (mainnet-only deployment)', () => {
    // sBTC is a mainnet-only token — testnet uses the same contract address
    expect(TOKEN_REGISTRY.sBTC.testnet.contractAddress).toBe(
      'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token',
    )
    expect(TOKEN_REGISTRY.sBTC.testnet.functionName).toBe('transfer')
  })

  it('USDCx has 6 decimals and correct mainnet contract address', () => {
    expect(TOKEN_REGISTRY.USDCx.decimals).toBe(6)
    expect(TOKEN_REGISTRY.USDCx.mainnet.contractAddress).toBe(
      'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx',
    )
    expect(TOKEN_REGISTRY.USDCx.mainnet.functionName).toBe('transfer')
  })

  it('USDCx testnet uses the same contract address as mainnet', () => {
    expect(TOKEN_REGISTRY.USDCx.testnet.contractAddress).toBe(
      'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx',
    )
    expect(TOKEN_REGISTRY.USDCx.testnet.functionName).toBe('transfer')
  })
})
