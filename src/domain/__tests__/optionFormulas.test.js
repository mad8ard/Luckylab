import { describe, expect, it } from 'vitest'
import {
  asianOption,
  bachelierOption,
  blackScholes,
  buildOptionPortfolio,
  getDeltaBands,
  optionLegsFromTemplate,
  resolveDeltaSlope,
} from '../formulas/core.js'

describe('getDeltaBands', () => {
  it('多空带都是 low < cost < high', () => {
    const b = getDeltaBands({
      entryPrice: 100,
      formulaHorizonSessions: 30,
      iv: 1,
      deltaSlope: 0.3,
      tradingDaysPerYear: 365,
    })
    expect(b.long.low).toBeLessThan(b.long.cost)
    expect(b.long.cost).toBeLessThan(b.long.high)
    expect(b.short.low).toBeLessThan(b.short.cost)
    expect(b.short.cost).toBeLessThan(b.short.high)
  })
  it('保留原式语义：T 是持仓时间，d 是 g(P) 的局部斜率约束', () => {
    const b = getDeltaBands({
      entryPrice: 100,
      formulaHorizonSessions: 30,
      iv: 0.4,
      deltaSlope: 0.3,
      tradingDaysPerYear: 365,
    })
    expect(b.sourceId).toBe('943334771f')
    expect(b.variables.T).toBe(30)
    expect(b.variables.d).toBe(0.3)
    expect(b.long.localSlopeAtEntry).toBeCloseTo(0.3, 8)
    expect(Number.isFinite(b.long.payoffAtEntry)).toBe(true)
  })
  it('targetReturn 不再作为 deltaSlope 的隐式别名', () => {
    expect(resolveDeltaSlope({ targetReturn: 0.8 })).toBeNull()
    expect(resolveDeltaSlope({ deltaSlope: 0.2, targetReturn: 0.8 })).toBe(0.2)
    expect(
      getDeltaBands({
        entryPrice: 100,
        formulaHorizonSessions: 30,
        iv: 0.4,
        targetReturn: 0.3,
        tradingDaysPerYear: 365,
      }),
    ).toBeNull()
  })
  it('空的 deltaSlope 不能被 Number 强转为有效的 0', () => {
    expect(resolveDeltaSlope({ deltaSlope: null })).toBeNull()
    expect(resolveDeltaSlope({ deltaSlope: undefined })).toBeNull()
    expect(resolveDeltaSlope({ deltaSlope: '' })).toBeNull()
    expect(resolveDeltaSlope({ deltaSlope: 0 })).toBe(0)
  })
  it('非法参数返回 null', () => {
    expect(
      getDeltaBands({ entryPrice: 0, formulaHorizonSessions: 30, iv: 1, deltaSlope: 0.3, tradingDaysPerYear: 365 }),
    ).toBeNull()
    expect(
      getDeltaBands({ entryPrice: 100, formulaHorizonSessions: -1, iv: 1, deltaSlope: 0.3, tradingDaysPerYear: 365 }),
    ).toBeNull()
  })
  it('波动率 e_T 接近 1 时拒绝（公式失稳）', () => {
    expect(
      getDeltaBands({ entryPrice: 100, formulaHorizonSessions: 365, iv: 5, deltaSlope: 0.3, tradingDaysPerYear: 365 }),
    ).toBeNull()
  })
  it('tradingDaysPerYear 影响价格带宽度', () => {
    const a = getDeltaBands({
      entryPrice: 100,
      formulaHorizonSessions: 30,
      iv: 0.4,
      deltaSlope: 0.1,
      tradingDaysPerYear: 365,
    })
    const b = getDeltaBands({
      entryPrice: 100,
      formulaHorizonSessions: 30,
      iv: 0.4,
      deltaSlope: 0.1,
      tradingDaysPerYear: 252,
    })
    expect(a.long.high).not.toBeCloseTo(b.long.high, 1)
  })
})

describe('blackScholes', () => {
  it('匹配标准 Black-Scholes call benchmark', () => {
    const o = blackScholes({
      entryPrice: 100,
      strikePrice: 100,
      timeToExpirySessions: 365,
      iv: 0.2,
      riskFreeRate: 0.05,
      type: 'call',
      tradingDaysPerYear: 365,
    })
    expect(o.price).toBeCloseTo(10.4506, 2)
    expect(o.optionDelta).toBeCloseTo(0.6368, 2)
    expect(Number.isFinite(o.optionGamma)).toBe(true)
    expect(Number.isFinite(o.optionRhoPerPct)).toBe(true)
    expect(Number.isFinite(o.optionVegaPerPct)).toBe(true)
    expect(Number.isFinite(o.optionThetaPerSession)).toBe(true)
    expect(Number.isFinite(o.optionThetaAnnual)).toBe(true)
    expect(o.thetaDaily).toBe(o.optionThetaPerSession)
    expect(o.legacyAliases.thetaDaily).toBe('optionThetaPerSession')
  })
  it('看跌的 delta 在 [-1, 0]', () => {
    const o = blackScholes({
      entryPrice: 100,
      strikePrice: 100,
      timeToExpirySessions: 30,
      iv: 0.4,
      riskFreeRate: 0.04,
      type: 'put',
      tradingDaysPerYear: 365,
    })
    expect(o.optionDelta).toBeLessThanOrEqual(0)
    expect(o.optionDelta).toBeGreaterThanOrEqual(-1)
    expect(o.optionGamma).toBeGreaterThan(0)
    expect(o.optionRhoPerPct).toBeLessThanOrEqual(0)
  })
  it('看涨的 delta 在 [0, 1]', () => {
    const o = blackScholes({
      entryPrice: 100,
      strikePrice: 100,
      timeToExpirySessions: 30,
      iv: 0.4,
      riskFreeRate: 0.04,
      type: 'call',
      tradingDaysPerYear: 365,
    })
    expect(o.optionDelta).toBeGreaterThanOrEqual(0)
    expect(o.optionDelta).toBeLessThanOrEqual(1)
    expect(o.optionRhoPerPct).toBeGreaterThanOrEqual(0)
  })
})

describe('Asian / Bachelier research formulas', () => {
  it('输出有限研究值并拒绝非法参数', () => {
    const asian = asianOption({
      entryPrice: 100,
      strikePrice: 105,
      timeToExpirySessions: 30,
      iv: 0.4,
      riskFreeRate: 0.02,
      type: 'put',
      tradingDaysPerYear: 365,
    })
    const bach = bachelierOption({
      entryPrice: 100,
      strikePrice: 105,
      timeToExpirySessions: 30,
      normalVol: 40,
      riskFreeRate: 0.02,
      type: 'put',
      tradingDaysPerYear: 365,
    })
    expect(Number.isFinite(asian.price)).toBe(true)
    expect(Number.isFinite(asian.optionGamma)).toBe(true)
    expect(Number.isFinite(bach.price)).toBe(true)
    expect(Number.isFinite(bach.optionGamma)).toBe(true)
    expect(Number.isFinite(bach.optionNormalVegaPerUnit)).toBe(true)
    expect(bach.optionVegaPerPct).toBeNull()
    expect(bach.optionThetaPerSession).toBeNull()
    expect(bach.optionThetaAnnual).toBeNull()
    expect(bach.optionRhoPerPct).toBeNull()
    expect(bach.thetaDaily).toBeNull()
    expect(
      asianOption({ entryPrice: 0, strikePrice: 105, timeToExpirySessions: 30, iv: 0.4, tradingDaysPerYear: 365 }),
    ).toBeNull()
    expect(
      bachelierOption({
        entryPrice: 100,
        strikePrice: 105,
        timeToExpirySessions: 30,
        normalVol: 0,
        tradingDaysPerYear: 365,
      }),
    ).toBeNull()
  })
})

describe('Option portfolio research model', () => {
  it('支持多腿组合并聚合 Greeks', () => {
    const legs = optionLegsFromTemplate({
      strategy: 'straddle',
      side: 'long',
      entryPrice: 100,
      strikePrice: 100,
      quantity: 2,
    })
    const combo = buildOptionPortfolio({
      entryPrice: 100,
      timeToExpirySessions: 30,
      iv: 0.3,
      riskFreeRate: 0.02,
      legs,
      tradingDaysPerYear: 365,
    })
    expect(combo.status).toBe('research-only')
    expect(combo.legs).toHaveLength(2)
    expect(Number.isFinite(combo.optionDelta)).toBe(true)
    expect(combo.optionGamma).toBeGreaterThan(0)
    expect(Number.isFinite(combo.optionThetaPerSession)).toBe(true)
    expect(Number.isFinite(combo.optionThetaAnnual)).toBe(true)
    expect(combo.delta).toBe(combo.optionDelta)
    expect(combo.legacyAliases.delta).toBe('optionDelta')
    expect(combo.points.length).toBeGreaterThan(20)
  })

  it('价差组合允许 long/short legs 抵消部分风险', () => {
    const legs = optionLegsFromTemplate({
      strategy: 'vertical',
      side: 'long',
      optionType: 'call',
      entryPrice: 100,
      strikePrice: 100,
      strikePrice2: 110,
    })
    const combo = buildOptionPortfolio({
      entryPrice: 100,
      timeToExpirySessions: 45,
      iv: 0.25,
      legs,
      tradingDaysPerYear: 365,
    })
    expect(combo.legs.map((item) => item.side)).toEqual(['long', 'short'])
    expect(Math.abs(combo.optionDelta)).toBeLessThan(1)
    expect(combo.scope).toContain('LP replication only')
  })

  it('BSM + Bachelier 混合组合传播不可比较的 Theta/Vega/Rho 缺失，不伪装为零', () => {
    const combo = buildOptionPortfolio({
      entryPrice: 100,
      timeToExpirySessions: 30,
      iv: 0.3,
      legs: [
        {
          type: 'put',
          side: 'long',
          strikePrice: 95,
          quantity: 1,
          premium: 2,
          model: 'black-scholes',
        },
        {
          type: 'call',
          side: 'long',
          strikePrice: 100,
          quantity: 1,
          premium: 3,
          model: 'bachelier',
          normalVol: 30,
        },
      ],
      tradingDaysPerYear: 365,
    })

    expect(Number.isFinite(combo.optionDelta)).toBe(true)
    expect(Number.isFinite(combo.optionGamma)).toBe(true)
    expect(combo.optionVegaPerPct).toBeNull()
    expect(Number.isFinite(combo.legs[0].optionVegaPerPct)).toBe(true)
    expect(combo.legs[1].optionThetaPerSession).toBeNull()
    expect(combo.legs[1].optionVegaPerPct).toBeNull()
    expect(combo.legs[1].optionRhoPerPct).toBeNull()
    expect(combo.optionThetaPerSession).toBeNull()
    expect(combo.optionThetaAnnual).toBeNull()
    expect(combo.optionRhoPerPct).toBeNull()
    expect(combo.thetaDaily).toBeNull()
    expect(combo.rho).toBeNull()
    expect(combo.missingGreeks).toEqual([
      'option-theta-per-session',
      'option-theta-annual',
      'option-vega-per-pct',
      'option-rho-per-pct',
    ])
  })

  it('空权利金保持 missing，显式零仍是输入值', () => {
    const missing = buildOptionPortfolio({
      entryPrice: 100,
      timeToExpirySessions: 30,
      iv: 0.3,
      legs: [{ type: 'put', side: 'long', strikePrice: 100, quantity: 1, premium: null }],
      tradingDaysPerYear: 365,
    })
    const explicitZero = buildOptionPortfolio({
      entryPrice: 100,
      timeToExpirySessions: 30,
      iv: 0.3,
      legs: [{ type: 'put', side: 'long', strikePrice: 100, quantity: 1, premium: 0 }],
      tradingDaysPerYear: 365,
    })
    expect(missing.missingInputs).toContain('option-leg-premium')
    expect(missing.legs[0].premiumSource).toBe('model')
    expect(explicitZero.missingInputs).not.toContain('option-leg-premium')
    expect(explicitZero.legs[0].premiumSource).toBe('input')
    expect(explicitZero.entryCost).toBe(0)
  })

  it('市场 IV 标签必须有独立来源校验才成立', () => {
    const args = {
      entryPrice: 100,
      timeToExpirySessions: 30,
      iv: 0.3,
      volatilitySource: 'market-option-quote-implied',
      legs: [{ type: 'put', side: 'long', strikePrice: 100, quantity: 1, premium: 4 }],
      tradingDaysPerYear: 365,
    }
    const unverified = buildOptionPortfolio(args)
    const verified = buildOptionPortfolio({ ...args, volatilitySourceVerified: true })

    expect(unverified.isMarketIv).toBe(false)
    expect(unverified.missingInputs).toContain('verified-market-iv-source')
    expect(verified.isMarketIv).toBe(true)
    expect(verified.missingInputs).not.toContain('verified-market-iv-source')
  })

  it('非法或空 legs 返回 null', () => {
    expect(
      buildOptionPortfolio({ entryPrice: 100, timeToExpirySessions: 30, iv: 0.2, legs: [], tradingDaysPerYear: 365 }),
    ).toBeNull()
    expect(
      buildOptionPortfolio({
        entryPrice: 0,
        timeToExpirySessions: 30,
        iv: 0.2,
        legs: [{ type: 'call', strikePrice: 100, quantity: 1 }],
        tradingDaysPerYear: 365,
      }),
    ).toBeNull()
  })
})
