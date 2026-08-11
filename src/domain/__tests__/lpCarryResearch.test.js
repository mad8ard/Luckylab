import { describe, expect, it } from 'vitest'
import {
  compareFeeCarryToTheta,
  estimateCumulativeFundingProxy,
  estimateLpPathFees,
  fundingRate,
  hedgedLpPortfolioCurve,
  legacyNetCarry,
  netCarry,
  uniswapV2Inventory,
  uniswapV3HedgedInventory,
  uniswapV3HedgedPosition,
} from '../formulas/core.js'

describe('LP / IL / CE / Funding', () => {
  it('fee 与 theta 只有统一口径后才可比较，零成交费不等于零 theta', () => {
    const missingBasis = compareFeeCarryToTheta({
      feeIncomeQuote: 0,
      feeAccrualSessions: 1,
      optionThetaPerSession: -2,
    })
    expect(missingBasis.comparable).toBe(false)
    const compared = compareFeeCarryToTheta({
      feeIncomeQuote: 0,
      feeAccrualSessions: 1,
      optionThetaPerSession: -2,
      optionTimeToExpirySessions: 30,
      feeSignConvention: 'income-positive',
      optionThetaSignConvention: 'long-option-value-change',
      feeCurrency: 'USD',
      optionCurrency: 'USD',
      feeNotional: 1000,
      optionNotional: 1000,
      feeSessionCalendarId: 'XNYS',
      optionSessionCalendarId: 'XNYS',
      feeAccrualStart: '2026-08-03T20:00:00.000Z',
      feeAccrualEnd: '2026-08-04T20:00:00.000Z',
      optionThetaAsOf: '2026-08-03T16:00:00-04:00',
    })
    expect(compared.comparable).toBe(true)
    expect(compared.feeCarryQuotePerSession).toBe(0)
    expect(compared.optionThetaQuotePerSession).toBe(-2)
    expect(compared.feeCarryQuote).toBe(0)
    expect(compared.optionThetaDecayQuote).toBe(2)
    expect(compared.feeThetaGapQuote).toBe(-2)
    expect(compared.comparisonHorizonSessions).toBe(1)
    expect(compared.signConvention.optionThetaInput).toBe('long-option-value-change')
    expect(compared.legacyInputSemantics).toBeNull()
    expect(compared.relation).toBe('analogy-not-identity')
  })

  it('fee-theta 在符号、同名义或期权期限不对齐时保持不可比较', () => {
    const base = {
      feeIncomeQuote: 2,
      feeAccrualSessions: 2,
      optionThetaPerSession: -1,
      optionTimeToExpirySessions: 30,
      feeSignConvention: 'income-positive',
      optionThetaSignConvention: 'long-option-value-change',
      feeCurrency: 'USD',
      optionCurrency: 'USD',
      feeNotional: 100,
      optionNotional: 100,
      feeSessionCalendarId: 'XNYS',
      optionSessionCalendarId: 'XNYS',
      feeAccrualStart: '2026-08-03T20:00:00.000Z',
      feeAccrualEnd: '2026-08-05T20:00:00.000Z',
      optionThetaAsOf: '2026-08-03T20:00:00.000Z',
    }
    expect(compareFeeCarryToTheta({ ...base, optionThetaSignConvention: null }).missingInputs).toContain(
      'aligned-sign-convention',
    )
    expect(compareFeeCarryToTheta({ ...base, optionNotional: 200 }).missingInputs).toContain('same-notional-basis')
    expect(compareFeeCarryToTheta({ ...base, optionTimeToExpirySessions: 1 }).missingInputs).toContain(
      'option-tenor-covering-comparison-horizon',
    )
    expect(compareFeeCarryToTheta({ ...base, optionSessionCalendarId: 'CRYPTO-UTC' }).missingInputs).toContain(
      'same-session-calendar',
    )
    expect(compareFeeCarryToTheta({ ...base, optionThetaAsOf: '2026-08-04T20:00:00.000Z' }).missingInputs).toContain(
      'option-theta-as-of-accrual-start',
    )
  })

  it('旧 day 输入只经显式兼容适配，输出标注 legacyAliases', () => {
    const legacy = compareFeeCarryToTheta({
      feeIncomeQuote: 2,
      feeAccrualDays: 2,
      optionThetaDaily: -1,
      optionTimeToExpirySessions: 30,
      feeSignConvention: 'income-positive',
      optionThetaSignConvention: 'long-option-value-change',
      feeCurrency: 'USD',
      optionCurrency: 'USD',
      feeNotional: 100,
      optionNotional: 100,
      feeSessionCalendarId: 'XNYS',
      optionSessionCalendarId: 'XNYS',
      feeAccrualStart: '2026-08-03T20:00:00.000Z',
      feeAccrualEnd: '2026-08-05T20:00:00.000Z',
      optionThetaAsOf: '2026-08-03T20:00:00.000Z',
    })

    expect(legacy.feeCarryQuotePerSession).toBe(1)
    expect(legacy.optionThetaQuotePerSession).toBe(-1)
    expect(legacy.legacyInputSemantics).toBe('deprecated-day-fields-adapted-as-trading-session-fields')
    expect(legacy.inputSources.feeAccrualSessions).toContain('deprecated:feeAccrualDays')
    expect(legacy.legacyAliases.thetaPerSession).toBe('optionThetaQuotePerSession')
    expect(legacy.legacyAliases.thetaDaily).toBe('optionThetaQuotePerSession')
  })

  it('路径手续费随成交量变化；同价格路径不等于同 fee', () => {
    const base = { feeTier: 0.003, positionLiquidity: 10, activeLiquidity: 100, inRangeFraction: 1 }
    const quiet = estimateLpPathFees({
      steps: [{ ...base, volumeQuote: 0 }],
      initialCapitalQuote: 1000,
      currency: 'USD',
    })
    const active = estimateLpPathFees({
      steps: [{ ...base, volumeQuote: 10000 }],
      initialCapitalQuote: 1000,
      currency: 'USD',
    })
    expect(quiet.feeIncomeQuote).toBe(0)
    expect(active.feeIncomeQuote).toBeCloseTo(3)
    expect(active.feeReturn).toBeGreaterThan(quiet.feeReturn)
    expect(active.pathDependent).toBe(true)
  })

  it('只有 fee tier 或非法 in-range 比例时不生成手续费收入', () => {
    const tierOnly = estimateLpPathFees({ steps: [{ feeTier: 0.003 }], initialCapitalQuote: 1000 })
    const invalidRange = estimateLpPathFees({
      steps: [{ feeTier: 0.003, volumeQuote: 1000, positionLiquidity: 10, activeLiquidity: 100, inRangeFraction: 1.2 }],
      initialCapitalQuote: 1000,
    })
    expect(tierOnly.feeIncomeQuote).toBeNull()
    expect(invalidRange.feeIncomeQuote).toBeNull()
    expect(invalidRange.missingInputs).toContain('steps[0].inRangeFraction')
  })

  it('fundingRate 永续溢价时为正', () => {
    const f = fundingRate({ perpTwap: 101, spotTwap: 100, hours: 8 })
    expect(f.cumulativeFundingProxy).toBeGreaterThan(0)
    expect(f.status).toBe('proxy-only')
    expect(f.cumulativeFundingProxy).toBeCloseTo((f.basisFraction * 8) / 24, 10)
    expect(f.legacyAliases.funding).toBe('cumulativeFundingProxy')
    expect(f.funding).toBe(f.cumulativeFundingProxy)
  })

  it('生产 funding 查询只输出 basis、累计代理和明确 horizon', () => {
    const f = estimateCumulativeFundingProxy({ perpTwap: 101, spotTwap: 100, horizonHours: 8 })
    expect(f.cumulativeFundingProxy).toBeGreaterThan(0)
    expect(f.horizonHours).toBe(8)
    expect(f).not.toHaveProperty('funding')
    expect(f).not.toHaveProperty('ratio')
    expect(f).not.toHaveProperty('fundingProxy')
  })

  it('netCarry 用起点名义、方向和共同周期比较目标收益与 funding', () => {
    const c = netCarry({
      cycleStartPrice: 80,
      targetPrice: 100,
      side: 'long',
      cumulativeFundingProxy: 0.02,
      fundingPositionSide: 'long',
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
    })
    expect(c.cumulativeFundingProxy).toBeCloseTo(0.02, 10)
    expect(c.grossRecoveryReturn).toBeCloseTo(0.25, 10)
    expect(c.fundingCashflowReturn).toBeCloseTo(-0.02, 10)
    expect(c.fundingNetCostReturn).toBeCloseTo(0.02, 10)
    expect(c.netReturn).toBeCloseTo(0.23, 10)
    expect(c.breakEvenFundingNetCostReturn).toBeCloseTo(0.25, 10)
    expect(c.scenarioViable).toBe(true)
    expect(c).not.toHaveProperty('minimumRequiredReturn')
    expect(c).not.toHaveProperty('costDistance')
    expect(c.status).toBe('proxy-only')
  })

  it('旧 costDistance/fundingRate 因方向、分母和周期不明而被拒绝', () => {
    const c = legacyNetCarry({ costDistance: 0.1, fundingRate: 0.02 })
    const strict = netCarry({ costDistance: 0.1, fundingRate: 0.9 })
    expect(c.netReturn).toBeNull()
    expect(c.status).toBe('calibration-required')
    expect(c.deprecatedInputs.costDistance.accepted).toBe(false)
    expect(c.deprecatedInputs.fundingRate.accepted).toBe(false)
    expect(c.legacyCompatibility).toBe(true)
    expect(strict).toBeNull()
  })

  it('uniswapV3HedgedPosition 使用非对称真实 v3 区间', () => {
    const lp = uniswapV3HedgedPosition({
      markPrice: 110,
      startPrice: 100,
      lowerPrice: 70,
      upperPrice: 130,
      liquidity: 10,
      hedgeSize: 0.2,
      feeIncomeQuote: 1,
    })
    expect(lp.status).toBe('research-only')
    expect(lp.zone).toBe('range')
    expect(lp.lowerPrice).toBe(70)
    expect(lp.upperPrice).toBe(130)
    expect(Number.isFinite(lp.combinedValue)).toBe(true)
  })

  it('v2 / v3 / hedged curve 的 feeIncomeQuote 都按 quote currency 一比一计入 PnL', () => {
    const feeIncomeQuote = 7
    const v2Base = uniswapV2Inventory({
      markPrice: 110,
      startPrice: 100,
      liquidity: 10,
      hedgeSize: 0,
      feeIncomeQuote: 0,
    })
    const v2Fee = uniswapV2Inventory({
      markPrice: 110,
      startPrice: 100,
      liquidity: 10,
      hedgeSize: 0,
      feeIncomeQuote,
    })
    const v3Base = uniswapV3HedgedInventory({
      markPrice: 110,
      strikePrice: 100,
      rangeFactor: 1.2,
      liquidity: 10,
      hedgeSize: 0,
      feeIncomeQuote: 0,
    })
    const v3Fee = uniswapV3HedgedInventory({
      markPrice: 110,
      strikePrice: 100,
      rangeFactor: 1.2,
      liquidity: 10,
      hedgeSize: 0,
      feeIncomeQuote,
    })
    const positionBase = uniswapV3HedgedPosition({
      markPrice: 110,
      startPrice: 100,
      lowerPrice: 80,
      upperPrice: 120,
      liquidity: 10,
      feeIncomeQuote: 0,
    })
    const positionFee = uniswapV3HedgedPosition({
      markPrice: 110,
      startPrice: 100,
      lowerPrice: 80,
      upperPrice: 120,
      liquidity: 10,
      feeIncomeQuote,
    })
    const curveBase = hedgedLpPortfolioCurve({
      startPrice: 100,
      lowerPrice: 80,
      upperPrice: 120,
      liquidity: 10,
      feeIncomeQuote: 0,
      fundingCashflowQuote: 0,
      fundingCashflowSource: 'explicit-scenario',
      steps: 2,
    })
    const curveFee = hedgedLpPortfolioCurve({
      startPrice: 100,
      lowerPrice: 80,
      upperPrice: 120,
      liquidity: 10,
      feeIncomeQuote,
      fundingCashflowQuote: 0,
      fundingCashflowSource: 'explicit-scenario',
      steps: 2,
    })

    expect(v2Fee.value - v2Base.value).toBeCloseTo(feeIncomeQuote, 12)
    expect(v3Fee.value - v3Base.value).toBeCloseTo(feeIncomeQuote, 12)
    expect(positionFee.value - positionBase.value).toBeCloseTo(feeIncomeQuote, 12)
    expect(curveFee.points[1].combined - curveBase.points[1].combined).toBeCloseTo(feeIncomeQuote, 12)
    expect([v2Fee, v3Fee, positionFee, curveFee].every((value) => value.feeIncomeUnit === 'quote-currency')).toBe(true)
  })

  it('缺少路径费用输入时不把未观测费用静默写成 0', () => {
    expect(uniswapV2Inventory({ markPrice: 110, startPrice: 100, liquidity: 10, hedgeSize: 0 })).toBeNull()
    expect(
      uniswapV3HedgedPosition({
        markPrice: 110,
        startPrice: 100,
        lowerPrice: 80,
        upperPrice: 120,
        liquidity: 10,
      }),
    ).toBeNull()
  })

  it('LP 组合曲线缺少 funding settlement 时也不静默写成零', () => {
    const base = {
      startPrice: 100,
      lowerPrice: 80,
      upperPrice: 120,
      liquidity: 10,
      feeIncomeQuote: 0,
      steps: 2,
    }
    expect(hedgedLpPortfolioCurve(base)).toBeNull()
    const legacy = hedgedLpPortfolioCurve({ ...base, fundingCost: 2 })
    expect(legacy.fundingCashflowQuote).toBe(-2)
    expect(legacy.fundingCost).toBe(2)
    expect(legacy.fundingInputSemantics).toBe('deprecated-cost-positive-fundingCost-negated-to-signed-cashflow')
    expect(legacy.legacyAliasMetadata.fundingCost).toEqual({
      deprecated: true,
      legacyAliasOf: 'fundingCashflowQuote',
      transform: 'negate-cost-positive-to-cashflow-positive',
    })
  })

  it('旧 fees 输入仅保留为明确的 quote-currency 兼容别名', () => {
    const legacy = uniswapV3HedgedPosition({
      markPrice: 100,
      startPrice: 100,
      lowerPrice: 80,
      upperPrice: 120,
      liquidity: 10,
      fees: 3,
    })
    const canonicalWins = uniswapV3HedgedPosition({
      markPrice: 100,
      startPrice: 100,
      lowerPrice: 80,
      upperPrice: 120,
      liquidity: 10,
      feeIncomeQuote: 5,
      fees: 99,
    })
    expect(legacy.feeIncomeQuote).toBe(3)
    expect(legacy.feeInputSemantics).toBe('deprecated-legacy-fees-as-quote-currency')
    expect(legacy.legacyAliases.fees).toBe('feeIncomeQuote')
    expect(canonicalWins.feeIncomeQuote).toBe(5)
    expect(canonicalWins.feeInputSemantics).toBe('canonical-fee-income-quote')
  })
})
