import { describe, expect, it } from 'vitest'
import { buildExecutableContext } from '../strategy-planning/orderPlanContext.js'

const market = { markPrice: 90, costAnchor: 100, annualVol: 0.4 }
const input = {
  entryPrice: 100,
  formulaHorizonSessions: 13,
  iv: 0.4,
  tradingDaysPerYear: 252,
}

describe('planning input semantics', () => {
  it('旧 targetReturn 不能污染 GetDelta 的 deltaSlope，显式 0 仍合法', () => {
    const legacyOnly = buildExecutableContext({ market, input: { ...input, targetReturn: 0.91 } })
    const canonical = buildExecutableContext({ market, input: { ...input, deltaSlope: 0, targetReturn: 0.05 } })

    expect(legacyOnly.inputs.deltaSlope).toBeNull()
    expect(legacyOnly.inputs).not.toHaveProperty('targetReturn')
    expect(legacyOnly.deltaBands).toBeNull()
    expect(canonical.deltaBands.variables.d).toBe(0)
  })
})
