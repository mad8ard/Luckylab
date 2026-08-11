import { describe, expect, it } from 'vitest'
import { resolveDynamicHoldingData } from '../formulaDynamicHolding.js'

describe('resolveDynamicHoldingData', () => {
  it('兼容入口只返回 OrderPlan 的同一门禁结果，不再自行复算', () => {
    const dynamicHolding = { status: '观察', source: 'current-formula-path-prefix' }
    expect(resolveDynamicHoldingData({ graph: { dynamicHolding } })).toBe(dynamicHolding)
    expect(resolveDynamicHoldingData({ graph: {} })).toBeNull()
  })
})
