import { describe, expect, it } from 'vitest'
import { buildMarketStatePath } from '../market-data/cost.js'
import { buildDecisionGraph } from '../strategy-planning/orderPlan.js'

function makeRows(n, gen) {
  return Array.from({ length: n }, (_, i) => {
    const close = gen(i)
    return {
      date: `2024-${String(Math.floor(i / 30) + 1).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`,
      timestamp: i,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000,
    }
  })
}

function moveBelowCost(market) {
  const markPrice = market.costLow * 0.99
  return {
    ...market,
    markPrice,
    costDistance: (markPrice - market.costAnchor) / market.costAnchor,
  }
}

describe('buildDecisionGraph', () => {
  const rows = makeRows(120, (i) => 100 + Math.sin(i / 10) * 5)
  const market = buildMarketStatePath(rows, 252).at(-1)
  const baseInput = {
    entryPrice: market.markPrice,
    formulaHorizonSessions: 13,
    formulaHorizonState: {
      context: {
        mode: 'formula-derived',
        side: 'long',
        cycleStartPrice: 90,
        anchorPrice: 100,
        targetPrice: 95,
        targetSource: 'adaptive-cost-lower',
        halfLifeSessions: 13,
        availableAt: 'test:close',
        executionAuthority: 'none',
      },
    },
    iv: market.annualVol,
    deltaSlope: 0.3,
    exitTargetReturn: 0,
    capital: 10000,
    baseNotional: 0,
    strategyProfile: 'balanced',
    strikePrice: market.markPrice * 1.05,
    riskFreeRate: 0.04,
    optionType: 'put',
    startPrice: market.costAnchor,
    rangeWidth: 0.1,
    skew: 1,
    liquidity: 1,
    hedgeSize: 0,
    fees: 0,
    perpTwap: market.markPrice,
    spotTwap: market.costAnchor,
    tradingDaysPerYear: 252,
    dynamicHoldingGate: {
      status: '观察',
      candidateStatus: '观察',
      phase: 'repair-start',
      phaseLabel: '修复启动',
      blockedReasons: [],
      executionAuthority: 'none',
    },
  }
  const noAccountInput = {
    ...baseInput,
    capital: 0,
    baseNotional: 0,
  }

  it('返回结构包含 timing/position/plan', () => {
    const g = buildDecisionGraph({ market, input: baseInput })
    expect(['buy', 'sell', null]).toContain(g.decision.timing.side)
    expect(g.decision.triggeredConditions).toBeDefined()
    expect(g.decision.blockedReasons).toBeDefined()
    expect(g.decision.missingInputs).toBeDefined()
    expect(g.decision.signalSemantics).toMatch(/not-confidence-or-win-probability$/)
    expect(g.formulaStrategy.steps.map((step) => step.id)).toEqual([
      'cost',
      'delta-band',
      'deviation-score',
      'order-plan',
    ])
    expect(g.formulaStrategy.formulaBasis.sourceId).toBe('943334771f')
    expect(g.formulaStrategy.formulaBasis.terms.map((row) => row[0])).toContain('r_T')
    expect(g.plan.primaryOrders.every((o) => Number.isFinite(o.price))).toBe(true)
  })

  it('deltaSlope 驱动 GetDelta，exitTargetReturn 独立驱动退出目标', () => {
    const buyMarket = {
      rows: 120,
      markPrice: 90,
      costAnchor: 100,
      costRecent: 100,
      costLow: 95,
      costHigh: 105,
      costDistance: -0.1,
      annualVol: 0.4,
      atrPercent: 0.02,
      momentumFast: 0.03,
      momentumSlow: 0.01,
      costSlopeRecent: 0,
    }
    const input = { ...baseInput, entryPrice: 100, iv: 0.4, deltaSlope: 0.12, exitTargetReturn: 0.08 }
    const g = buildDecisionGraph({ market: buyMarket, input })
    expect(g.inputs.deltaSlope).toBe(0.12)
    expect(g.inputs.exitTargetReturn).toBe(0.08)
    expect(g.deltaBands.variables.d).toBe(0.12)
    expect(g.position.exitTargetReturn).toBe(0.08)
    expect(g.plan.primaryOrders[0]?.exitTargetReturn).toBe(0.08)
    expect(g.plan.primaryOrders[0]).not.toHaveProperty('targetReturn')
    expect(g.plan.primaryOrders.length).toBeGreaterThan(0)
    for (const order of g.plan.primaryOrders) {
      expect(order.horizonBinding.cycleStartPrice).toBe(order.price)
      expect(order.horizonBinding.targetPrice).toBe(order.targetPrice)
      expect(order.formulaHorizonSessions).toBe(order.horizonBinding.modelHorizonSessions)
      expect(order.horizonBinding.rederivedForLimitScenario).toBe(true)
    }
  })

  it('折价 + 动量止跌时使用市场缩放 profile 生成买入挂单', () => {
    const buyMarket = {
      rows: 120,
      markPrice: 90,
      costAnchor: 100,
      costRecent: 100,
      costLow: 95,
      costHigh: 105,
      costDistance: -0.1,
      annualVol: 0.4,
      atrPercent: 0.02,
      momentumFast: 0.03,
      momentumSlow: 0.01,
      costSlopeRecent: 0,
    }
    const g = buildDecisionGraph({ market: buyMarket, input: { ...baseInput, entryPrice: 100, iv: 0.4 } })
    expect(g.profile.minEdge).toBeGreaterThan(0)
    expect(g.profile.riskMin).toBeGreaterThan(0)
    expect(g.decision.timing.side).toBe('buy')
    expect(g.plan.primaryOrders.length).toBeGreaterThan(0)
    expect(g.plan.primaryOrders.every((o) => o.side === 'buy')).toBe(true)
    expect(g.position.executionStatus).toBe('simulation-only')
    expect(g.plan.executionStatus).toBe('simulation-only')
    expect(g.plan.primaryOrders.every((o) => o.executionStatus === 'simulation-only')).toBe(true)
  })

  it('偏离强度使用每个事件自己的公式周期口径', () => {
    const buyMarket = {
      rows: 120,
      markPrice: 90,
      costAnchor: 100,
      costRecent: 100,
      costLow: 95,
      costHigh: 105,
      costDistance: -0.1,
      annualVol: 0.4,
      atrPercent: 0.02,
      momentumFast: 0.03,
      momentumSlow: 0.01,
      costSlopeRecent: 0,
    }
    const short = buildDecisionGraph({
      market: buyMarket,
      input: { ...baseInput, formulaHorizonSessions: 2, entryPrice: 100, iv: 0.4 },
    })
    const long = buildDecisionGraph({
      market: buyMarket,
      input: { ...baseInput, formulaHorizonSessions: 19, entryPrice: 100, iv: 0.4 },
    })
    expect(Math.abs(long.decision.timing.zScore)).toBeLessThan(Math.abs(short.decision.timing.zScore))
    expect(long.formulaStrategy.steps.find((step) => step.id === 'deviation-score').formula).toBe(
      'costDistance / periodVol',
    )
  })

  it('缺少公式周期时关闭默认挂单，不回退到 holdingDays', () => {
    const belowCostMarket = moveBelowCost(market)
    const blocked = buildDecisionGraph({
      market: belowCostMarket,
      input: { ...baseInput, formulaHorizonSessions: null, holdingDays: 30 },
    })

    expect(blocked.deltaBands).toBeNull()
    expect(blocked.plan.primaryOrders).toEqual([])
    expect(blocked.decision.missingInputs).toContain('formula-derived-horizon')
    expect(blocked.decision.holdingWindow).toBe('当前无执行方向；研究周期待公式推导')
  })

  it('缺少 tradingDaysPerYear 时关闭默认挂单', () => {
    const belowCostMarket = moveBelowCost(market)
    const blocked = buildDecisionGraph({
      market: belowCostMarket,
      input: { ...baseInput, tradingDaysPerYear: null },
    })

    expect(blocked.inputs.tradingDaysPerYear).toBeNull()
    expect(blocked.deltaBands).toBeNull()
    expect(blocked.plan.primaryOrders).toEqual([])
    expect(blocked.decision.missingInputs).toContain('trading-days-per-year')
  })

  it('无账户资金输入时不生成名义金额和候选订单', () => {
    const buyMarket = {
      rows: 120,
      markPrice: 90,
      costAnchor: 100,
      costRecent: 100,
      costLow: 95,
      costHigh: 105,
      costDistance: -0.1,
      annualVol: 0.4,
      atrPercent: 0.02,
      momentumFast: 0.03,
      momentumSlow: 0.01,
      costSlopeRecent: 0,
    }
    const g = buildDecisionGraph({ market: buyMarket, input: { ...noAccountInput, entryPrice: 100, iv: 0.4 } })
    expect(g.decision.timing.side).toBe('buy')
    expect(g.position.maxNotional).toBeNull()
    expect(g.position.riskBudget).toBeNull()
    expect(g.position.executionStatus).toBe('blocked')
    expect(g.plan.executionStatus).toBe('blocked')
    expect(g.decision.missingInputs).toContain('account.capital')
    expect(g.plan.primaryOrders).toEqual([])
  })

  it('未触发默认条件时不把账户资金缺口混入当前门禁', () => {
    const g = buildDecisionGraph({ market, input: noAccountInput })
    expect(g.plan.primaryOrders).toEqual([])
    expect(g.position.maxNotional).toBeNull()
    expect(g.position.missingInputs).toEqual([])
    expect(g.decision.missingInputs).not.toContain('account.capital')
  })

  it('long-side 成本下沿周期不能复用于溢价减仓', () => {
    const sellMarket = {
      rows: 120,
      markPrice: 110,
      costAnchor: 100,
      costRecent: 100,
      costLow: 95,
      costHigh: 105,
      costDistance: 0.1,
      annualVol: 0.4,
      atrPercent: 0.02,
      momentumFast: 0,
      momentumSlow: 0,
      costSlopeRecent: 0,
    }
    const g = buildDecisionGraph({
      market: sellMarket,
      input: { ...baseInput, entryPrice: 110, iv: 0.4, baseNotional: 10000 },
    })
    expect(g.profile.exposureMax).toBeGreaterThan(0)
    expect(g.decision.timing.side).toBeNull()
    expect(g.plan.primaryOrders).toEqual([])
    expect(g.decision.missingInputs).toContain('short-side-target-horizon-binding')
  })

  it('独立 short-side 成本上沿周期才允许生成减仓模拟单', () => {
    const sellMarket = {
      rows: 120,
      markPrice: 110,
      costAnchor: 100,
      costRecent: 100,
      costLow: 95,
      costHigh: 105,
      costDistance: 0.1,
      annualVol: 0.4,
      atrPercent: 0.02,
      momentumFast: 0,
      momentumSlow: 0,
      costSlopeRecent: 0,
    }
    const g = buildDecisionGraph({
      market: sellMarket,
      input: {
        ...baseInput,
        entryPrice: 110,
        iv: 0.4,
        baseNotional: 10000,
        formulaHorizonState: {
          context: {
            mode: 'formula-derived',
            side: 'short',
            cycleStartPrice: 110,
            anchorPrice: 100,
            targetPrice: 105,
            targetSource: 'adaptive-cost-upper',
            halfLifeSessions: 13,
            availableAt: 'test:close',
            executionAuthority: 'none',
          },
        },
      },
    })
    expect(g.decision.timing.side).toBe('sell')
    expect(g.plan.primaryOrders.length).toBeGreaterThan(0)
    expect(g.plan.primaryOrders.every((order) => order.horizonBinding.side === 'short')).toBe(true)
    expect(g.plan.primaryOrders.every((order) => order.horizonBinding.cycleStartPrice === order.price)).toBe(true)
    expect(g.plan.primaryOrders.every((order) => order.horizonBinding.targetPrice === order.targetPrice)).toBe(true)
    expect(g.plan.primaryOrders.every((order) => order.horizonBinding.rederivedForLimitScenario === true)).toBe(true)
    expect(new Set(g.plan.primaryOrders.map((order) => order.formulaHorizonSessions)).size).toBeGreaterThan(1)
    expect(g.plan.primaryOrders.every((o) => o.side === 'sell')).toBe(true)
  })

  it('纯底仓账户在卖出信号下不要求现金本金', () => {
    const sellMarket = {
      rows: 120,
      markPrice: 110,
      costAnchor: 100,
      costRecent: 100,
      costLow: 95,
      costHigh: 105,
      costDistance: 0.1,
      annualVol: 0.4,
      atrPercent: 0.02,
      momentumFast: 0,
      momentumSlow: 0,
      costSlopeRecent: 0,
    }
    const g = buildDecisionGraph({
      market: sellMarket,
      input: {
        ...baseInput,
        capital: 0,
        baseNotional: 10000,
        entryPrice: 110,
        iv: 0.4,
        formulaHorizonState: {
          context: {
            mode: 'formula-derived',
            side: 'short',
            cycleStartPrice: 110,
            anchorPrice: 100,
            targetPrice: 105,
            targetSource: 'adaptive-cost-upper',
            halfLifeSessions: 13,
            availableAt: 'test:close',
            executionAuthority: 'none',
          },
        },
      },
    })
    expect(g.decision.timing.side).toBe('sell')
    expect(g.decision.missingInputs).not.toContain('account.capital')
    expect(g.plan.primaryOrders.length).toBeGreaterThan(0)
    expect(g.plan.primaryOrders.every((o) => o.side === 'sell')).toBe(true)
  })

  it('回测账户按当前权益缩放仓位，不继续用启动本金放大风险', () => {
    const buyMarket = {
      rows: 120,
      markPrice: 90,
      costAnchor: 100,
      costRecent: 100,
      costLow: 95,
      costHigh: 105,
      costDistance: -0.1,
      annualVol: 0.4,
      atrPercent: 0.02,
      momentumFast: 0.03,
      momentumSlow: 0.01,
      costSlopeRecent: 0,
    }
    const g = buildDecisionGraph({
      market: buyMarket,
      input: { ...baseInput, capital: 10000, entryPrice: 100, iv: 0.4 },
      account: { cash: 2000, base: 0, costBasis: 0 },
    })
    expect(g.decision.timing.side).toBe('buy')
    expect(g.account.equity).toBe(2000)
    expect(g.position.maxNotional).toBeLessThanOrEqual(2000 * g.profile.exposureMax + 1e-9)
  })

  it('研究层 LP/funding 输入不改变默认挂单价格', () => {
    const buyMarket = {
      rows: 120,
      markPrice: 90,
      costAnchor: 100,
      costRecent: 100,
      costLow: 95,
      costHigh: 105,
      costDistance: -0.1,
      annualVol: 0.4,
      atrPercent: 0.02,
      momentumFast: 0.03,
      momentumSlow: 0.01,
      costSlopeRecent: 0,
    }
    const executableInput = { ...baseInput, entryPrice: 100, iv: 0.4 }
    const researchChangedInput = {
      ...executableInput,
      startPrice: 40,
      rangeWidth: 0.5,
      skew: 3,
      liquidity: 999,
      hedgeSize: 12,
      fees: 42,
      perpTwap: 130,
      spotTwap: 75,
      dividendYield: 0.12,
      fingerprintLambda: 9,
      fingerprintKappa: 0.25,
      numoenR1: 12,
      numoenDy: 0.4,
    }
    const base = buildDecisionGraph({ market: buyMarket, input: executableInput })
    const changed = buildDecisionGraph({ market: buyMarket, input: researchChangedInput })
    expect(changed.research).toBeUndefined()
    expect(changed.portfolio).toBeUndefined()
    expect(changed.portfolioResearch).toBeUndefined()
    expect(changed.plan.primaryOrders.map((o) => o.price)).toEqual(base.plan.primaryOrders.map((o) => o.price))
    expect(changed.plan.primaryOrders.map((o) => o.notional)).toEqual(base.plan.primaryOrders.map((o) => o.notional))
  })

  it('卖出信号在无底仓时不生成挂单', () => {
    const g = buildDecisionGraph({ market, input: baseInput })
    if (g.decision.timing.side === 'sell') {
      expect(g.plan.primaryOrders.length).toBe(0)
    }
  })

  it('保守 vs 激进：账户输入存在时风险预算不同', () => {
    const c = buildDecisionGraph({ market, input: { ...baseInput, strategyProfile: 'conservative' } })
    const a = buildDecisionGraph({ market, input: { ...baseInput, strategyProfile: 'aggressive' } })
    if (c.position.side && a.position.side) {
      expect(a.position.riskBudget).toBeGreaterThanOrEqual(c.position.riskBudget)
    }
  })

  it('自定义策略参数进入领域层并改变风险预算', () => {
    const buyMarket = {
      rows: 120,
      markPrice: 90,
      costAnchor: 100,
      costRecent: 100,
      costLow: 95,
      costHigh: 105,
      costDistance: -0.1,
      annualVol: 0.4,
      atrPercent: 0.02,
      momentumFast: 0.03,
      momentumSlow: 0.01,
      costSlopeRecent: 0,
    }
    const small = buildDecisionGraph({
      market: buyMarket,
      input: {
        ...baseInput,
        entryPrice: 100,
        iv: 0.4,
        strategyProfile: 'custom',
        strategyRiskPct: 0.005,
        strategyExposurePct: 0.1,
      },
    })
    const large = buildDecisionGraph({
      market: buyMarket,
      input: {
        ...baseInput,
        entryPrice: 100,
        iv: 0.4,
        strategyProfile: 'custom',
        strategyRiskPct: 0.04,
        strategyExposurePct: 0.8,
      },
    })
    expect(small.profile.id).toBe('custom')
    expect(large.profile.riskMax).toBeGreaterThan(small.profile.riskMax)
    expect(large.position.maxNotional).toBeGreaterThan(small.position.maxNotional)
  })

  it('无市场态返回空图', () => {
    const empty = buildDecisionGraph({ market: null, input: baseInput })
    expect(empty.plan.primaryOrders).toEqual([])
  })
})
