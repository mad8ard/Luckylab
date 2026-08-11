import { describe, expect, it } from 'vitest'
import {
  buildDensityComponents,
  deviationScore,
  deriveDrawdownFeatures,
  deriveDynamicHoldingState,
  integrateTrapezoid,
  lambertW,
  liquidityFingerprint,
  logLaplaceDensity,
  numoenSnapshot,
  normalCdf,
} from '../formulas/core.js'

describe('normalCdf', () => {
  it('返回 0~1 区间', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 3)
    expect(normalCdf(2)).toBeGreaterThan(0.97)
    expect(normalCdf(-2)).toBeLessThan(0.03)
  })
  it('处理无穷', () => {
    expect(normalCdf(Infinity)).toBe(1)
    expect(normalCdf(-Infinity)).toBe(0)
  })
})

describe('deviationScore probability semantics', () => {
  it('只输出正态参考极端度与双尾质量，不伪造均值回归概率', () => {
    const score = deviationScore({
      costDistance: -0.04,
      annualVol: 0.3,
      formulaHorizonSessions: 20,
      tradingDaysPerYear: 252,
    })
    expect(score.deviationPercentile).toBeGreaterThan(0)
    expect(score.twoSidedTailProbability).toBeCloseTo(1 - score.deviationPercentile, 10)
    expect(score.probabilitySemantics).toContain('not-mean-reversion-probability')
    expect(score).not.toHaveProperty('regressionProb')
  })

  it('缺少交易会话年基或只给旧 holdingDays 时拒绝计算', () => {
    expect(deviationScore({ costDistance: -0.04, annualVol: 0.3, formulaHorizonSessions: 20 })).toBeNull()
    expect(deviationScore({ costDistance: -0.04, annualVol: 0.3, holdingDays: 20, tradingDaysPerYear: 252 })).toBeNull()
  })
})

describe('deriveDynamicHoldingState', () => {
  const repairDrawdown = {
    status: 'ok',
    drawdownDepth: -0.22,
    drawdownSpeedFast: 0.002,
    drawdownSpeedSlow: 0.04,
    drawdownRepair: 0.22,
    drawdownAge: { peakSessions: 58, troughSessions: 6 },
  }

  it('回撤继续扩张时，即使 z/LP 很强也输出等待', () => {
    const state = deriveDynamicHoldingState({
      zScore: -3.2,
      halfLifeSessions: 6,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100, lpUpper: 103 },
      lpPercentile: 1,
      drawdown: { ...repairDrawdown, drawdownSpeedFast: -0.03, drawdownSpeedSlow: -0.08 },
    })

    expect(state.status).toBe('等待')
    expect(state.phase).toBe('falling-expansion')
    expect(state.holdingPlan.shortTrade.blockedReasons).toContain('drawdown-expanding')
  })

  it('修复启动时允许 costLower 和 nearAnchor 进入候选里程碑', () => {
    const state = deriveDynamicHoldingState({
      zScore: -2.8,
      halfLifeSessions: 6,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100, lpUpper: 103 },
      costSlopePct: 0,
      drawdown: repairDrawdown,
    })

    expect(state.status).toBe('观察')
    expect(state.phase).toBe('repair-start')
    expect(state.milestones.map((item) => item.id)).toEqual(['firstRepair', 'baseAnchor', 'stretch'])
    expect(state.holdingPlan.shortTrade.targetId).toBe('firstRepair')
    expect(state.expectation.profileExpectations.shortTrade.targetId).toBe('firstRepair')
    expect(state.expectation.profileExpectations.shortTrade.expectedSessions).toBeCloseTo(
      state.holdingPlan.shortTrade.expectedSessions,
      2,
    )
    expect(state.expectation.profileExpectations.fundCycle.targetId).toBe('firstRepair')
    expect(state.milestones[0].returnPerSessionPct).toBeGreaterThan(0)
    expect(state.expectation.profileExpectations.fundCycle).not.toHaveProperty('monthlyEfficiencyPct')
    expect(state.state).not.toHaveProperty('halfLifeDays')
  })

  it('固定周期旧字段不进入规范化契约，两个计划只消费目标推导周期', () => {
    const state = deriveDynamicHoldingState({
      zScore: -3.1,
      halfLifeSessions: 20,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100, lpUpper: 104 },
      drawdown: repairDrawdown,
      profiles: {
        shortTrade: { minDays: 2, maxDays: 10, minimumGrossReturn: 0.03 },
        fundCycle: { minDays: 20, maxDays: 120, minimumGrossReturn: 0.03 },
      },
    })

    expect(state.holdingPlan.shortTrade.status).toBe('观察')
    expect(state.holdingPlan.shortTrade.blockedReasons).not.toContain('holding-window')
    expect(state.holdingPlan.fundCycle.status).toBe('观察')
    expect(state.holdingPlan.fundCycle.action).toBe('review')
    expect(state.holdingPlan.fundCycle.targetId).toBe('firstRepair')
    expect(state.profiles.shortTrade).not.toHaveProperty('minDays')
    expect(state.profiles.shortTrade).not.toHaveProperty('maxDays')
    expect(state.profiles.fundCycle).not.toHaveProperty('minDays')
    expect(state.profiles.fundCycle).not.toHaveProperty('maxDays')
  })

  it('lpUpper 超过锚点时标记为 post-anchor-extension 且不作为默认短线退出', () => {
    const state = deriveDynamicHoldingState({
      zScore: -3,
      halfLifeSessions: 5,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100, lpUpper: 104 },
      drawdown: repairDrawdown,
    })

    const stretch = state.milestones.find((item) => item.id === 'stretch')
    expect(stretch.blockedReasons).toContain('post-anchor-extension')
    expect(state.holdingPlan.shortTrade.targetId).not.toBe('stretch')
  })

  it('数据不足时输出需刷新数据和 insufficient-history', () => {
    const rows = Array.from({ length: 2 }, (_, index) => ({ close: 100 - index }))
    const drawdown = deriveDrawdownFeatures({ rows })
    const state = deriveDynamicHoldingState({
      zScore: -2,
      halfLifeSessions: 5,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100 },
      drawdown,
    })

    expect(drawdown.status).toBe('insufficient-history')
    expect(state.status).toBe('需刷新数据')
    expect(state.phase).toBe('insufficient-history')
  })

  it('回撤速度窗口由可见前缀推导，追加未来数据不改写旧时点', () => {
    const prefix = Array.from({ length: 40 }, (_, index) => ({ close: 120 - index * 0.4 + Math.sin(index) }))
    const future = Array.from({ length: 20 }, (_, index) => ({ close: 90 + index * 3 }))
    const before = deriveDrawdownFeatures({ rows: prefix })
    const after = deriveDrawdownFeatures({ rows: [...prefix, ...future], index: prefix.length - 1 })

    expect(after).toEqual(before)
    expect(before.windowSpec.mode).toBe('expanding-prefix')
    expect(before.windowSpec.fastLagSessions).toBeLessThan(before.windowSpec.slowLagSessions)
    expect(before).not.toHaveProperty('lookbackDays')
    expect(before.drawdownAge).not.toHaveProperty('peakDays')
  })
})

describe('Liquidity / AMM research formulas', () => {
  it('log 价格密度映射到价格轴时保持等比例区间质量', () => {
    const density = (price) => logLaplaceDensity(price, { mu: Math.log(100), lambda: 2, kappa: 1 })
    const lowerMass = integrateTrapezoid(density, 80, 100, 512)
    const upperMass = integrateTrapezoid(density, 100, 125, 512)

    expect(lowerMass).toBeCloseTo(upperMass, 3)
  })

  it('流动性指纹按积分离散且权重归一', () => {
    const fp = liquidityFingerprint({
      entryPrice: 100,
      priceGrid: 80,
      segmentCount: 12,
      lowerFactor: 0.8,
      upperFactor: 1.3,
      volatility: 0.35,
      tradingDaysPerYear: 252,
    })
    const total = fp.segments.reduce((sum, seg) => sum + seg.weight, 0)
    expect(total).toBeCloseTo(1, 5)
    expect(fp.params.priceGrid).toBe(80)
    expect(fp.segments.every((seg, index, arr) => index === 0 || seg.lower >= arr[index - 1].upper)).toBe(true)
  })

  it('流动性指纹拆出价格、成本、区间和挂单成分', () => {
    const fp = liquidityFingerprint({
      entryPrice: 100,
      activePrice: 97,
      costAnchor: 101,
      targetRange: { lower: 92, upper: 108 },
      orderLevels: [
        { side: 'buy', price: 94, notional: 1000 },
        { side: 'sell', price: 109, notional: 600 },
      ],
      volatility: 0.42,
      tradingDaysPerYear: 252,
      priceGrid: 96,
      segmentCount: 16,
      lowerFactor: 0.85,
      upperFactor: 1.18,
    })
    expect(fp.status).toBe('research-only')
    expect(fp.inputMode).toBe('hybrid-model')
    expect(fp.components.map((component) => component.id)).toEqual(['base', 'active', 'cost', 'orders', 'range'])
    expect(fp.stats.orderShare).toBeGreaterThan(0)
    expect(fp.stats.activeShare).toBeGreaterThan(0)
    expect(fp.segments.some((segment) => segment.componentMass.orders > 0)).toBe(true)
    expect(fp.prices.some((point) => point.orderDensity > 0 && point.rangeDensity > 0)).toBe(true)
    expect(fp.segments.reduce((sum, seg) => sum + seg.weight, 0)).toBeCloseTo(1, 5)
    expect(fp.semantics.isProbabilityForecast).toBe(false)
    expect(fp.semantics.interpretation).toBe('target-allocation-weight')
    expect(fp.params.volatility).toBe(0.42)
    expect(fp.params.tradingDaysPerYear).toBe(252)
    expect(fp.params.timeBasis).toBe('trading-session')
    expect(fp.params.declaredMinimum).toBe(0.015)
    expect(fp.params.declaredScale).toBe(4)
    expect(fp.params.sessionVolatility).toBeCloseTo(fp.params.appliedVolatility / Math.sqrt(252), 12)
    expect(fp.params.bumpBandwidthLogSigma).toBeCloseTo(
      Math.max(fp.params.declaredMinimum, fp.params.declaredScale * fp.params.sessionVolatility),
      12,
    )
    expect(fp.params.rangeSupportMinimum).toBe(0.015)
    expect(fp.params.rangeSupportDivisor).toBe(4)
  })

  it('流动性指纹带宽参数可显式覆盖并在输出中公开', () => {
    const fp = liquidityFingerprint({
      entryPrice: 100,
      activePrice: 100,
      volatility: 0.2,
      tradingDaysPerYear: 252,
      declaredMinimum: 0.08,
      declaredScale: 2,
      rangeSupportMinimum: 0.03,
      rangeSupportDivisor: 6,
    })

    expect(fp.params).toMatchObject({
      declaredMinimum: 0.08,
      declaredScale: 2,
      bumpBandwidthLogSigma: 0.08,
      rangeSupportMinimum: 0.03,
      rangeSupportDivisor: 6,
    })
  })

  it('流动性指纹缺少波动率或交易日基准时返回 null', () => {
    expect(liquidityFingerprint({ entryPrice: 100, tradingDaysPerYear: 252 })).toBeNull()
    expect(liquidityFingerprint({ entryPrice: 100, volatility: 0.35 })).toBeNull()
    expect(buildDensityComponents({ volatility: 0.35 })).toBeNull()
    expect(buildDensityComponents({ tradingDaysPerYear: 252 })).toBeNull()
    expect(buildDensityComponents({ volatility: 0.35, tradingDaysPerYear: 252 })).toBeNull()
    expect(
      liquidityFingerprint({ entryPrice: 100, volatility: 0.35, tradingDaysPerYear: 252, declaredMinimum: 0 }),
    ).toBeNull()
    expect(
      liquidityFingerprint({ entryPrice: 100, volatility: 0.35, tradingDaysPerYear: 252, declaredScale: 0 }),
    ).toBeNull()
  })

  it('Lambert W principal branch 满足定义', () => {
    const w = lambertW(1)
    expect(w * Math.exp(w)).toBeCloseTo(1, 8)
  })

  it('Numoen 快照有限且保持 protocol-unverified', () => {
    const n = numoenSnapshot()
    expect(n.status).toBe('protocol-unverified')
    expect(Number.isFinite(n.R0)).toBe(true)
    expect(Number.isFinite(n.R1)).toBe(true)
    expect(Number.isFinite(n.slippageY)).toBe(true)
  })
})
