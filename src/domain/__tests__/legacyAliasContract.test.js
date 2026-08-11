import { describe, expect, it } from 'vitest'
import {
  bachelierOption,
  blackScholes,
  buildOptionPortfolio,
  compareFeeCarryToTheta,
  fundingRate,
  hedgedLpPortfolioCurve,
  impermanentLoss,
  legacyNetCarry,
  netLpEfficiency,
  riskSurface,
  uniswapV2Inventory,
  uniswapV3HedgedPosition,
  uniswapV3Inventory,
} from '../formulas/core.js'

function expectAuditableAliases(result) {
  expect(result.legacyAliases).toBeTypeOf('object')
  expect(result.legacyAliasMetadata).toBeTypeOf('object')
  for (const [legacyName, legacyAliasOf] of Object.entries(result.legacyAliases)) {
    expect(result.legacyAliasMetadata[legacyName]).toMatchObject({ deprecated: true, legacyAliasOf })
  }
}

describe('legacy alias metadata contract', () => {
  it('期权 quote、surface 与 portfolio 的旧 Greek 均带可审计映射', () => {
    const quote = blackScholes({
      entryPrice: 100,
      strikePrice: 100,
      timeToExpirySessions: 30,
      iv: 0.2,
      tradingDaysPerYear: 252,
    })
    const normalQuote = bachelierOption({
      entryPrice: 100,
      strikePrice: 100,
      timeToExpirySessions: 30,
      normalVol: 20,
      tradingDaysPerYear: 252,
    })
    const surface = riskSurface({
      entryPrice: 100,
      strikePrice: 100,
      timeToExpirySessions: 30,
      iv: 0.2,
      bandLow: 90,
      bandHigh: 110,
      steps: 2,
      tradingDaysPerYear: 252,
    })
    const portfolio = buildOptionPortfolio({
      entryPrice: 100,
      timeToExpirySessions: 30,
      iv: 0.2,
      tradingDaysPerYear: 252,
      legs: [{ type: 'call', side: 'long', strikePrice: 100, quantity: 1, premium: 2 }],
    })

    expectAuditableAliases(quote)
    expectAuditableAliases(normalQuote)
    expectAuditableAliases(surface.points[0])
    expectAuditableAliases(portfolio)
    expectAuditableAliases(portfolio.legs[0])
  })

  it('LP 库存、手续费与 IL 旧字段均带可审计映射', () => {
    const v2 = uniswapV2Inventory({
      markPrice: 100,
      startPrice: 90,
      liquidity: 10,
      hedgeSize: 0,
      fees: 0,
    })
    const v3 = uniswapV3Inventory({ markPrice: 100, lowerPrice: 80, upperPrice: 120, liquidity: 10 })
    const hedged = uniswapV3HedgedPosition({
      markPrice: 100,
      startPrice: 90,
      lowerPrice: 80,
      upperPrice: 120,
      liquidity: 10,
      fees: 0,
    })
    const il = impermanentLoss({ markPrice: 100, startPrice: 90, liquidity: 10 })
    const curve = hedgedLpPortfolioCurve({
      startPrice: 100,
      lowerPrice: 80,
      upperPrice: 120,
      liquidity: 10,
      fees: 0,
      fundingCashflowQuote: 0,
      fundingCashflowSource: 'explicit-scenario',
      steps: 2,
    })

    for (const result of [v2, v3, hedged, il, curve]) expectAuditableAliases(result)
  })

  it('Funding、carry 和 fee-theta 边界别名也带逐字段审计元数据', () => {
    const funding = fundingRate({ perpTwap: 101, spotTwap: 100, hours: 8 })
    const lpEfficiency = netLpEfficiency({
      capitalEfficiency: 2,
      impermanentLoss: -0.01,
      feeRate: 0.003,
      horizonDays: 2,
    })
    const feeTheta = compareFeeCarryToTheta({
      feeIncomeQuote: 1,
      feeAccrualSessions: 1,
      optionThetaPerSession: -1,
      optionTimeToExpirySessions: 2,
      feeSignConvention: 'income-positive',
      optionThetaSignConvention: 'long-option-value-change',
      feeCurrency: 'USD',
      optionCurrency: 'USD',
      feeNotional: 100,
      optionNotional: 100,
      feeSessionCalendarId: 'XNYS',
      optionSessionCalendarId: 'XNYS',
      feeAccrualStart: '2026-08-03T20:00:00.000Z',
      feeAccrualEnd: '2026-08-04T20:00:00.000Z',
      optionThetaAsOf: '2026-08-03T20:00:00.000Z',
    })

    for (const result of [funding, lpEfficiency, feeTheta]) expectAuditableAliases(result)
    const rejectedCarry = legacyNetCarry({ costDistance: 0.1, fundingRate: 0.02 })
    expect(rejectedCarry.status).toBe('calibration-required')
    expect(rejectedCarry.netReturn).toBeNull()
    expect(rejectedCarry.deprecatedInputs.fundingRate.accepted).toBe(false)
  })
})
