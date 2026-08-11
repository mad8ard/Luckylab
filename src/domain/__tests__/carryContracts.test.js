import { describe, expect, it } from 'vitest'
import { buildResearchSnapshot } from '../formula-research/researchSnapshot.js'
import { netCarry } from '../formulas/core.js'

const commonCarry = {
  cumulativeFundingProxy: 0.02,
  fundingPositionSide: 'short',
  recoveryNotionalBasis: 'cycle-start-quote-notional',
  fundingNotionalBasis: 'cycle-start-quote-notional',
  fundingHorizonHours: 72,
  comparisonHorizon: {
    sessions: 3,
    sessionDurationHours: 24,
    sessionCalendarId: 'CRYPTO-UTC-24H',
    source: 'formula-derived-target',
    availableAt: '2026-08-03T00:00:00.000Z',
  },
}

describe('carry comparison contracts', () => {
  it('short 修复收益保留方向，short funding 收益按同一起点名义进入净 carry', () => {
    const result = netCarry({
      ...commonCarry,
      cycleStartPrice: 120,
      targetPrice: 100,
      side: 'short',
    })

    expect(result.grossRecoveryReturn).toBeCloseTo(1 / 6, 10)
    expect(result.fundingCashflowReturn).toBeCloseTo(0.02, 10)
    expect(result.fundingNetCostReturn).toBeCloseTo(-0.02, 10)
    expect(result.netReturn).toBeCloseTo(1 / 6 + 0.02, 10)
    expect(result.breakEvenFundingNetCostReturn).toBeCloseTo(1 / 6, 10)
  })

  it('周期映射或名义本金不一致时拒绝净 carry', () => {
    const base = { ...commonCarry, cycleStartPrice: 80, targetPrice: 100, side: 'long' }
    expect(netCarry({ ...base, fundingNotionalBasis: 'anchor-quote-notional' })).toBeNull()
    expect(
      netCarry({
        ...base,
        comparisonHorizon: { ...base.comparisonHorizon, sessionDurationHours: 8 },
      }),
    ).toBeNull()
    expect(netCarry({ ...base, comparisonHorizon: { ...base.comparisonHorizon, availableAt: null } })).toBeNull()
  })

  it('funding proxy 不再伪装成组合 settlement 或按总资本强制扣款', () => {
    const baseInput = {
      optionTenorSessions: 12,
      tradingDaysPerYear: 365,
      lpScenarioEnabled: true,
      lpScenarioStartPrice: 100,
      lpScenarioRangeWidth: 0.1,
      lpScenarioSkew: 1,
      lpScenarioLiquidity: 10,
      hedgeSize: 1,
      feeIncomeQuote: 0,
      perpTwap: 101,
      spotTwap: 100,
      fundingPositionSide: 'short',
      fundingSessionDurationHours: 24,
      fundingSessionCalendarId: 'CRYPTO-UTC-24H',
      recoveryNotionalBasis: 'cycle-start-quote-notional',
      fundingNotionalBasis: 'cycle-start-quote-notional',
    }
    const executable = {
      inputs: {
        entryPrice: 80,
        iv: 0.3,
        capital: 100000,
        formulaHorizonSessions: 3,
        formulaHorizonSide: 'long',
        horizonCycleStartPrice: 80,
        horizonTargetPrice: 90,
        horizonTargetSource: 'test-target',
        horizonAvailableAt: '2026-08-03:close',
      },
    }
    const proxyOnly = buildResearchSnapshot({ market: { costAnchor: 100 }, input: baseInput, executable })

    expect(proxyOnly.funding.cumulativeFundingProxy).toBeGreaterThan(0)
    expect(proxyOnly.netCarry).not.toBeNull()
    expect(proxyOnly.lpPortfolio).toBeNull()
    expect(proxyOnly.portfolioResearch.pnl.fundingCashflowQuote).toBeNull()
    expect(proxyOnly.researchInputs.fundingCashflowQuote).toBeNull()

    const scenarioCashflow = buildResearchSnapshot({
      market: { costAnchor: 100 },
      input: { ...baseInput, fundingCashflowQuote: -2, fundingCashflowSource: 'explicit-scenario' },
      executable,
    })
    expect(scenarioCashflow.lpPortfolio.fundingCashflowQuote).toBe(-2)
    expect(scenarioCashflow.portfolioResearch.pnl.fundingCashflowQuote).toBe(-2)
    expect(scenarioCashflow.portfolioResearch.missingInputs).toContain('observed-funding-settlement')
    expect(scenarioCashflow.lpPortfolio).not.toHaveProperty('fundingSettlementQuote')
  })
})
