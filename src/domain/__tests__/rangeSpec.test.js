import { describe, expect, it } from 'vitest'
import { buildResearchSnapshot } from '../formula-research/researchSnapshot.js'
import { buildFormulaPath } from '../market-data/formulaPath.js'

const rows = Array.from({ length: 40 }, (_, index) => {
  const close = 100 + Math.sin(index / 5)
  return {
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000,
  }
})

const input = {
  entryPrice: 100,
  formulaHorizonSessions: 30,
  optionTenorSessions: 30,
  iv: 0.3,
  deltaSlope: 0.2,
  strikePrice: 100,
  lpScenarioEnabled: true,
  lpScenarioStartPrice: 100,
  lpScenarioRangeWidth: 1.2,
  lpScenarioSkew: 1,
  lpScenarioLiquidity: 1,
  capital: 10000,
  optionType: 'put',
  tradingDaysPerYear: 252,
}

describe('arithmetic LP range validation', () => {
  it('formula path does not silently clamp an invalid declared LP width', () => {
    const path = buildFormulaPath(rows, input)
    const point = path.at(-1)
    expect(point.lpLowerPrice).toBeTypeOf('number')
    expect(point.lpUpperPrice).toBeTypeOf('number')
    expect(point.fieldStates.lpLowerPrice.context).toMatchObject({ notAPosition: true, valuationAuthority: 'none' })
    expect(point.lpValue).toBeNull()
    expect(point.capitalEfficiency).toBeNull()
    expect(point.fieldStates.lpValue.missingInputs).toContain('lp-scenario-range-width')
  })

  it('research snapshot blocks the same invalid declared LP width', () => {
    const snapshot = buildResearchSnapshot({
      market: { costAnchor: 100 },
      input,
      executable: { inputs: { entryPrice: 100, formulaHorizonSessions: 30, iv: 0.3, capital: 10000 } },
    })
    expect(snapshot.researchInputs.rangeStatus).toBe('missing-input')
    expect(snapshot.lpV3).toBeNull()
    expect(snapshot.efficiency).toBeNull()
    expect(snapshot.portfolioResearch.missingInputs).toContain('lp-scenario-range-width')
    expect(snapshot.portfolioResearch.pnl.missingInputs).toEqual(snapshot.portfolioResearch.missingInputs)
    expect(snapshot.portfolioResearch.pnl.total).toBeNull()
    expect(snapshot.portfolioResearch.status).toBe('calibration-required')
  })

  it('research snapshot directly unions optionPortfolio missingInputs into the final ledger', () => {
    const snapshot = buildResearchSnapshot({
      market: { costAnchor: 100 },
      input: {
        ...input,
        lpScenarioRangeWidth: 0.1,
        optionPremium: 1,
        ivSource: 'market-option-quote-implied',
        ivSourceVerified: false,
      },
      executable: { inputs: { entryPrice: 100, formulaHorizonSessions: 30, iv: 0.3, capital: 10000 } },
    })
    expect(snapshot.optionPortfolio.missingInputs).toContain('verified-market-iv-source')
    expect(snapshot.portfolioResearch.missingInputs).toContain('verified-market-iv-source')
    expect(snapshot.portfolioResearch.pnl.missingInputs).toEqual(snapshot.portfolioResearch.missingInputs)
    expect(snapshot.portfolioResearch.pnl.total).toBeNull()
  })
})
