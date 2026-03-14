import { describe, it, expect } from 'vitest'
import * as sdk from './index.js'

describe('sdk barrel', () => {
  it('exports client SDK functions', () => {
    expect(sdk.createAgentClient).toBeTypeOf('function')
    expect(sdk.wrapAxios).toBeTypeOf('function')
    expect(sdk.wrapAxiosWithPayment).toBeTypeOf('function')
    expect(sdk.decodePaymentRequired).toBeTypeOf('function')
    expect(sdk.decodePaymentResponse).toBeTypeOf('function')
  })
})
