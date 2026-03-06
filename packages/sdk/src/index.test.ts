import { describe, it, expect } from 'vitest'
import * as sdk from './index.js'

describe('sdk barrel', () => {
  it('exports client SDK functions', () => {
    expect(sdk.createAgentClient).toBeTypeOf('function')
    expect(sdk.selectToken).toBeTypeOf('function')
    expect(sdk.wrapFetch).toBeTypeOf('function')
    expect(sdk.wrapAxios).toBeTypeOf('function')
  })
})
