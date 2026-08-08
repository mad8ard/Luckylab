import { describe, expect, it } from 'vitest'
import { buildMarketStatePath } from '../market-data/cost.js'
import { buildDecisionGraph, strategyProfileList } from '../strategy-planning/orderPlan.js'

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

describe('strategyProfileList', () => {
  it('档位顺序固定：保守 / 均衡 / 激进 / 自定义', () => {
    expect(strategyProfileList.map(p => p.id)).toEqual(['conservative', 'balanced', 'aggressive', 'custom'])
  })
})

describe('buildDecisionGraph', () => {
  const rows = makeRows(120, i => 100 + Math.sin(i / 10) * 5)
  const market = buildMarketStatePath(rows).at(-1)
  const baseInput = {
    entryPrice: market.markPrice,
    holdingDays: 30,
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
    expect(g.formulaStrategy.steps.map((step) => step.id)).toEqual(['cost', 'delta-band', 'deviation-score', 'order-plan'])
    expect(g.formulaStrategy.formulaBasis.sourceId).toBe('943334771f')
    expect(g.formulaStrategy.formulaBasis.terms.map((row) => row[0])).toContain('r_T')
    expect(g.plan.primaryOrders.every(o => Number.isFinite(o.price))).toBe(true)
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
      momentum5: 0.03,
      momentum20: 0.01,
      costSlope5: 0,
    }
    const input = { ...baseInput, entryPrice: 100, iv: 0.4, deltaSlope: 0.12, exitTargetReturn: 0.25 }
    const g = buildDecisionGraph({ market: buyMarket, input })
    expect(g.inputs.deltaSlope).toBe(0.12)
    expect(g.inputs.exitTargetReturn).toBe(0.25)
    expect(g.deltaBands.variables.d).toBe(0.12)
    expect(g.position.exitTargetReturn).toBe(0.25)
    expect(g.plan.primaryOrders[0]?.targetReturn).toBe(0.25)
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
      momentum5: 0.03,
      momentum20: 0.01,
      costSlope5: 0,
    }
    const g = buildDecisionGraph({ market: buyMarket, input: { ...baseInput, entryPrice: 100, iv: 0.4 } })
    expect(g.profile.minEdge).toBeGreaterThan(0)
    expect(g.profile.riskMin).toBeGreaterThan(0)
    expect(g.decision.timing.side).toBe('buy')
    expect(g.plan.primaryOrders.length).toBeGreaterThan(0)
    expect(g.plan.primaryOrders.every(o => o.side === 'buy')).toBe(true)
  })

  it('偏离强度使用自有公式里的持仓窗口口径', () => {
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
      momentum5: 0.03,
      momentum20: 0.01,
      costSlope5: 0,
    }
    const short = buildDecisionGraph({ market: buyMarket, input: { ...baseInput, holdingDays: 1, entryPrice: 100, iv: 0.4 } })
    const long = buildDecisionGraph({ market: buyMarket, input: { ...baseInput, holdingDays: 30, entryPrice: 100, iv: 0.4 } })
    expect(Math.abs(long.decision.timing.zScore)).toBeLessThan(Math.abs(short.decision.timing.zScore))
    expect(long.formulaStrategy.steps.find((step) => step.id === 'deviation-score').formula).toBe('costDistance / periodVol')
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
      momentum5: 0.03,
      momentum20: 0.01,
      costSlope5: 0,
    }
    const g = buildDecisionGraph({ market: buyMarket, input: { ...noAccountInput, entryPrice: 100, iv: 0.4 } })
    expect(g.decision.timing.side).toBe('buy')
    expect(g.position.maxNotional).toBeNull()
    expect(g.position.riskBudget).toBeNull()
    expect(g.decision.missingInputs).toContain('account.capital')
    expect(g.plan.primaryOrders).toEqual([])
  })

  it('未触发默认条件时仍暴露账户资金缺口', () => {
    const g = buildDecisionGraph({ market, input: noAccountInput })
    expect(g.plan.primaryOrders).toEqual([])
    expect(g.position.maxNotional).toBeNull()
    expect(g.decision.missingInputs).toContain('account.capital')
  })

  it('有底仓溢价时使用市场缩放 profile 生成减仓挂单', () => {
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
      momentum5: 0,
      momentum20: 0,
      costSlope5: 0,
    }
    const g = buildDecisionGraph({ market: sellMarket, input: { ...baseInput, entryPrice: 110, iv: 0.4, baseNotional: 10000 } })
    expect(g.profile.exposureMax).toBeGreaterThan(0)
    expect(g.decision.timing.side).toBe('sell')
    expect(g.plan.primaryOrders.length).toBeGreaterThan(0)
    expect(g.plan.primaryOrders.every(o => o.side === 'sell')).toBe(true)
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
      momentum5: 0,
      momentum20: 0,
      costSlope5: 0,
    }
    const g = buildDecisionGraph({
      market: sellMarket,
      input: { ...baseInput, capital: 0, baseNotional: 10000, entryPrice: 110, iv: 0.4 },
    })
    expect(g.decision.timing.side).toBe('sell')
    expect(g.decision.missingInputs).not.toContain('account.capital')
    expect(g.plan.primaryOrders.length).toBeGreaterThan(0)
    expect(g.plan.primaryOrders.every(o => o.side === 'sell')).toBe(true)
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
      momentum5: 0.03,
      momentum20: 0.01,
      costSlope5: 0,
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
      momentum5: 0.03,
      momentum20: 0.01,
      costSlope5: 0,
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
    expect(changed.plan.primaryOrders.map(o => o.price)).toEqual(base.plan.primaryOrders.map(o => o.price))
    expect(changed.plan.primaryOrders.map(o => o.notional)).toEqual(base.plan.primaryOrders.map(o => o.notional))
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
      momentum5: 0.03,
      momentum20: 0.01,
      costSlope5: 0,
    }
    const small = buildDecisionGraph({
      market: buyMarket,
      input: { ...baseInput, entryPrice: 100, iv: 0.4, strategyProfile: 'custom', strategyRiskPct: 0.005, strategyExposurePct: 0.1 },
    })
    const large = buildDecisionGraph({
      market: buyMarket,
      input: { ...baseInput, entryPrice: 100, iv: 0.4, strategyProfile: 'custom', strategyRiskPct: 0.04, strategyExposurePct: 0.8 },
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
