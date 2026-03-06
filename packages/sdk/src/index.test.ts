import { describe, it, expect } from 'vitest'
import * as sdk from './index.js'

describe('sdk barrel', () => {
  it('exports nothing yet (empty barrel)', () => {
    expect(Object.keys(sdk)).toHaveLength(0)
  })
})
