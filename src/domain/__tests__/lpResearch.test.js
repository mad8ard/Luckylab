import { describe, expect, it } from 'vitest'
import {
  capitalEfficiency,
  capitalEfficiencyAtPrice,
  capitalEfficiencyFrontier,
  capitalEfficiencySecondDerivative,
  ckCapitalEfficiencyReference,
  fullRangeV2ImpermanentLoss,
  impermanentLoss,
  lpResearchAttribution,
  netLpEfficiency,
  rangeV3ImpermanentLoss,
  resolveArithmeticRangeSpec,
  uniswapV2Inventory,
  uniswapV3Inventory,
} from '../formulas/core.js'

describe('LP / IL / CE / Funding', () => {
  it('uniswapV3Inventory 区间内 token0/token1 都为正', () => {
    const lp = uniswapV3Inventory({ markPrice: 100, lowerPrice: 80, upperPrice: 120, liquidity: 10 })
    expect(lp.token0).toBeGreaterThan(0)
    expect(lp.token1).toBeGreaterThan(0)
    expect(Number.isFinite(lp.value)).toBe(true)
    expect(lp.inventoryDeltaToken0).toBe(lp.token0)
    expect(lp.inventoryDelta).toBe(lp.inventoryDeltaToken0)
    expect(lp.legacyAliases.inventoryDelta).toBe('inventoryDeltaToken0')
    expect(lp).not.toHaveProperty('delta')
  })

  it('v2 区分 LP token0 库存敏感度与扣除对冲后的净敏感度', () => {
    const lp = uniswapV2Inventory({
      markPrice: 100,
      startPrice: 90,
      liquidity: 10,
      hedgeSize: 0.25,
      feeIncomeQuote: 0,
    })

    expect(lp.lpInventoryDeltaToken0).toBeCloseTo(1, 12)
    expect(lp.netInventoryDeltaToken0).toBeCloseTo(0.75, 12)
    expect(lp.inventoryDelta).toBe(lp.netInventoryDeltaToken0)
    expect(lp.legacyAliases.inventoryDelta).toBe('netInventoryDeltaToken0')
    expect(lp).not.toHaveProperty('delta')
  })

  it('旧 impermanentLoss 明确保持为 v2 全区间兼容别名', () => {
    const il = impermanentLoss({ markPrice: 100, startPrice: 100, liquidity: 10 })
    expect(Math.abs(il.impermanentLoss)).toBeLessThan(1e-9)
    expect(il.fullRangeV2IlProxy).toBe(il.impermanentLoss)
    expect(il.model).toBe('constant-product-v2-full-range-no-fees')
    expect(il.legacyAliases.impermanentLoss).toBe('fullRangeV2IlProxy')
  })

  it('v2 全区间 IL 与 v3 指定区间 IL 使用不同规范字段和对照模型', () => {
    const fullRange = fullRangeV2ImpermanentLoss({ markPrice: 110, startPrice: 100, liquidity: 10 })
    const range = rangeV3ImpermanentLoss({
      markPrice: 110,
      startPrice: 100,
      lowerPrice: 80,
      upperPrice: 120,
      liquidity: 10,
    })
    const samePriceRange = rangeV3ImpermanentLoss({
      markPrice: 100,
      startPrice: 100,
      lowerPrice: 80,
      upperPrice: 120,
      liquidity: 10,
    })

    expect(fullRange.fullRangeV2IlProxy).toBeTypeOf('number')
    expect(fullRange.rangeV3Il).toBeUndefined()
    expect(fullRange.impermanentLoss).toBeUndefined()
    expect(range.rangeV3Il).toBeTypeOf('number')
    expect(range.fullRangeV2IlProxy).toBeUndefined()
    expect(range.model).toBe('uniswap-v3-same-range-same-entry-inventory-no-fees')
    expect(Math.abs(samePriceRange.rangeV3Il)).toBeLessThan(1e-12)
  })

  it('capitalEfficiency 区间越窄效率越高', () => {
    const wide = capitalEfficiency({ rangeWidth: 0.5, skew: 1 })
    const narrow = capitalEfficiency({ rangeWidth: 0.05, skew: 1 })
    expect(narrow.efficiency).toBeGreaterThan(wide.efficiency)
  })

  it('CK ±84.13% 是解析资本效率边际拐点', () => {
    const ref = ckCapitalEfficiencyReference()
    expect(ref.rangeWidth).toBeCloseTo(0.8412994160945599, 14)
    expect(256 * ref.rangeWidth ** 4 - 160 * ref.rangeWidth ** 2 - 15).toBeCloseTo(0, 11)
    expect(ref.efficiency).toBeCloseTo(2.1825988321891194, 13)
    expect(ref.efficiency).toBeCloseTo(0.5 + 2 * ref.rangeWidth, 13)
    expect(ref.geometricMidpointRatio).toBeCloseTo(0.5405694150420948, 13)
    expect(ref.arithmeticCenterEfficiency).toBeCloseTo(2.312999824139203, 13)
    expect(ref.efficiencyAtGeometricMidpoint).toBe(ref.efficiency)
    expect(ref.efficiencyAtReferencePrice).toBeCloseTo(2.312999824139203, 13)
    expect(capitalEfficiencyAtPrice({ markPrice: 1, lowerPrice: ref.lower, upperPrice: ref.upper })).toBeCloseTo(
      2.312999824139203,
      13,
    )
    expect(ref.efficiencyValuationBasis).toBe('range-geometric-midpoint')
    expect(ref.claimClass).toBe('exact-identity')
    expect(ref.claimDetail).toBe('geometric-midpoint-capital-efficiency-curve')
    expect(ref.frontierSlope).toBeCloseTo(4.416501970495096, 12)
    expect(Math.abs(ref.secondDerivative)).toBeLessThan(1e-10)
    expect(capitalEfficiencySecondDerivative({ rangeWidth: 0.8, skew: 1 })).toBeGreaterThan(0)
    expect(capitalEfficiencySecondDerivative({ rangeWidth: 0.9, skew: 1 })).toBeLessThan(0)
    expect(ref.isFeeOptimal).toBe(false)
    expect(ref.isPnlOptimal).toBe(false)
    expect(ref.isProbabilityCoverage).toBe(false)
  })

  it('算术范围宽度只接受 0<x<1，缺失值才使用显式默认值', () => {
    expect(resolveArithmeticRangeSpec({ referencePrice: 100, rangeWidth: 1, skew: 1 })).toBeNull()
    expect(resolveArithmeticRangeSpec({ referencePrice: 100, rangeWidth: -0.1, skew: 1 })).toBeNull()
    const fallback = resolveArithmeticRangeSpec({
      referencePrice: 100,
      rangeWidth: null,
      skew: 1,
      defaultRangeWidth: 0.1,
    })
    expect(fallback.rangeWidth).toBe(0.1)
    expect(fallback.lowerPrice).toBeCloseTo(90)
    expect(fallback.upperPrice).toBeCloseTo(110)
  })

  it('CK Part 2 方向性前沿计算自己的拐点，不套用对称 ±84%', () => {
    const frontier = capitalEfficiencyFrontier({ skew: 2 })
    expect(frontier.rangeWidth).not.toBeCloseTo(ckCapitalEfficiencyReference().rangeWidth, 8)
    expect(frontier.theorem).toBe('ck-arithmetic-directional-capital-efficiency-inflection')
    expect(frontier.variant).toBe('ck-arithmetic-directional')
    expect(frontier.sourceId).toBe('0l7i8kmukx')
    expect(frontier.exact).toBe(true)
    expect(frontier.lawExact).toBe(true)
    expect(frontier.closedForm).toBe(false)
    expect(frontier.numericalSolution).toBe(true)
    expect(frontier.solutionMethod).toBe('numerical-root-of-exact-condition')
    expect(Math.abs(frontier.secondDerivative)).toBeLessThan(1e-10)
  })

  it('CE 几何不能与 IL 和 fee tier 相加', () => {
    const result = lpResearchAttribution({
      capitalEfficiency: 2.18,
      lpIlFraction: -0.04,
      ilModel: 'uniswap-v3-same-range-same-entry-inventory-no-fees',
      capitalBasis: 'same-entry-inventory-hold-value',
      horizonSessions: 30,
    })
    expect(result.geometry.capitalEfficiency).toBeCloseTo(2.18)
    expect(result.returns.netReturn).toBeNull()
    expect(result.missingInputs).toContain('realized-or-path-fee-return')
  })

  it('LP attribution 不接受无模型、无资本基准的 generic IL', () => {
    const result = lpResearchAttribution({
      capitalEfficiency: 2.18,
      lpIlFraction: -0.04,
      horizonSessions: 30,
    })
    expect(result.returns.netReturn).toBeNull()
    expect(result.missingInputs).toContain('il-model')
    expect(result.missingInputs).toContain('common-capital-basis')
    expect(result.returns).not.toHaveProperty('impermanentLoss')
  })

  it('V3 IL 归因必须携带同一起点、mark、区间、资本、费用与周期', () => {
    const complete = lpResearchAttribution({
      capitalEfficiency: 2.18,
      lpIlFraction: -0.04,
      ilModel: 'uniswap-v3-same-range-same-entry-inventory-no-fees',
      capitalBasis: 'same-entry-inventory-hold-value',
      startPrice: 100,
      markPrice: 90,
      lowerPrice: 80,
      upperPrice: 120,
      feeReturn: 0.01,
      feeSource: 'explicit-path-scenario',
      feeTreatment: 'explicit-scenario',
      horizonSessions: 30,
    })
    expect(complete.status).toBe('scenario-attribution')
    expect(complete.returns.netReturn).toBeCloseTo(-0.03)

    const missingRange = lpResearchAttribution({
      ...complete.returns,
      capitalEfficiency: 2.18,
      lowerPrice: null,
      upperPrice: null,
      feeSource: 'explicit-path-scenario',
      feeTreatment: 'explicit-scenario',
    })
    expect(missingRange.status).toBe('calibration-required')
    expect(missingRange.missingInputs).toContain('il-model-range')
  })

  it('零流动性时 IL 比率未定义，不伪造为 0', () => {
    expect(fullRangeV2ImpermanentLoss({ markPrice: 110, startPrice: 100, liquidity: 0 })).toBeNull()
    expect(
      rangeV3ImpermanentLoss({ markPrice: 110, startPrice: 100, lowerPrice: 80, upperPrice: 120, liquidity: 0 }),
    ).toBeNull()
  })

  it('legacy netLpEfficiency 不把 pool fee tier 当成已实现手续费收益', () => {
    const result = netLpEfficiency({ capitalEfficiency: 2.18, impermanentLoss: -0.04, feeRate: 0.003, horizonDays: 30 })
    expect(result.returns.feeReturn).toBeNull()
    expect(result.returns.netReturn).toBeNull()
    expect(result.legacyAliases).toEqual({
      impermanentLoss: 'lpIlFraction',
      horizonDays: 'horizonSessions',
    })
    expect(result.deprecatedInputs.feeRate).toEqual({
      deprecated: true,
      accepted: false,
      reason: 'fee-tier-is-not-realized-fee-income',
      replacementRequirements: ['feeReturn', 'feeSource', 'feeTreatment', 'horizonSessions'],
    })
    expect(result.ignoredInputs).toEqual(['feeRate-without-volume-path'])
  })
})
