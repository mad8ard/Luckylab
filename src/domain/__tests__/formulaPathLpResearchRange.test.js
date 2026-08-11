import { describe, expect, it } from 'vitest'
import { deriveFormulaPathLpResearchRange } from '../market-data/formulaPathLpResearchRange.js'

describe('deriveFormulaPathLpResearchRange', () => {
  it('从 GetDelta 的动态 r(T) 在 sqrt-price 空间推导研究区间', () => {
    const range = deriveFormulaPathLpResearchRange({
      bandAnchor: 100,
      deltaBands: { rT: 1.21, wave: 0.047619 },
      horizon: { modelHorizonSessions: 7, recoveryFraction: 0.37, availableAt: '2026-08-07:close' },
    })

    expect(range).toMatchObject({
      status: 'research-only',
      available: true,
      inputMode: 'formula-derived-research-scenario',
      claimClass: 'scenario-proxy',
      executionAuthority: 'none',
      horizonSessions: 7,
      recoveryFraction: 0.37,
    })
    expect(range.lowerPrice).toBeCloseTo(100 / 1.1, 12)
    expect(range.upperPrice).toBeCloseTo(110, 12)
  })

  it('缺少动态 GetDelta 输出时不回退固定百分比', () => {
    expect(deriveFormulaPathLpResearchRange({ bandAnchor: 100, deltaBands: null })).toMatchObject({
      available: false,
      lowerPrice: null,
      upperPrice: null,
      missingInputs: ['formula-derived-getdelta-wave'],
    })
  })

  it('即使 payoff slope 未声明，也可由同一动态 T/IV 波动项推导 LP 几何区间', () => {
    const range = deriveFormulaPathLpResearchRange({
      bandAnchor: 100,
      horizon: { modelHorizonSessions: 6 },
      iv: 0.5,
      tradingDaysPerYear: 242,
    })

    expect(range.available).toBe(true)
    expect(range.lowerPrice).toBeLessThan(100)
    expect(range.upperPrice).toBeGreaterThan(100)
    expect(range.executionAuthority).toBe('none')
  })
})
