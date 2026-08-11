import { describe, expect, it } from 'vitest'
import { resolveLpValuationSpec } from '../lpValuationSpec.js'

describe('LP valuation specification', () => {
  it('never turns legacy generic values into an LP position', () => {
    const result = resolveLpValuationSpec({
      input: {
        startPrice: 100,
        rangeWidth: 0.1,
        skew: 1,
        liquidity: 10,
        pathUsesScenarioInputs: true,
      },
    })

    expect(result.available).toBe(false)
    expect(result.mode).toBe('missing-input')
    expect(result.missingInputs).toEqual(['declared-lp-scenario-or-complete-position'])
    expect(result.lowerPrice).toBeNull()
    expect(result.upperPrice).toBeNull()
  })

  it('reports each missing field after an LP research scenario is explicitly enabled', () => {
    const result = resolveLpValuationSpec({
      input: {
        lpScenarioEnabled: true,
        lpScenarioStartPrice: 100,
        lpScenarioRangeWidth: 0.1,
      },
    })

    expect(result.available).toBe(false)
    expect(result.missingInputs).toEqual(['lp-scenario-skew', 'lp-scenario-liquidity'])
  })

  it('only values a complete declared LP research scenario', () => {
    const result = resolveLpValuationSpec({
      input: {
        lpScenarioEnabled: true,
        lpScenarioStartPrice: 100,
        lpScenarioRangeWidth: 0.2,
        lpScenarioSkew: 1,
        lpScenarioLiquidity: 10,
      },
    })

    expect(result).toMatchObject({
      available: true,
      mode: 'explicit-scenario',
      isSynthetic: true,
      startPrice: 100,
      liquidity: 10,
      rangeWidth: 0.2,
      skew: 1,
      valuationBasis: 'declared-lp-scenario',
      missingInputs: [],
    })
    expect(result.lowerPrice).toBeLessThan(100)
    expect(result.upperPrice).toBeGreaterThan(100)
  })
})
