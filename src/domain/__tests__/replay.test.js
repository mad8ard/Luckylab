import { describe, expect, it } from 'vitest'
import { buildMarketStatePath } from '../market-data/cost.js'
import {
  accountExit,
  buildDailyReplay,
  mergeExitPlan,
  rebindFormulaHorizonAtFill,
  resolveNextSessionLimitFill,
  summarizeReplay,
} from '../replay/dailyReplay.js'
import { initialExitPlan, orderExitPlan } from '../replay/dailyReplayExecution.js'
import { strategyProfileList } from '../planning/orderPlan.js'

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

describe('buildDailyReplay', () => {
  const rows = makeRows(200, (i) => 100 + Math.sin(i / 8) * 10)
  const baseInput = {
    deltaSlope: 0.3,
    exitTargetReturn: 0,
    capital: 10000,
    strategyProfile: 'balanced',
    rangeWidth: 0.1,
    skew: 1,
    liquidity: 1,
    replayFeeRate: 0.001,
    optionType: 'put',
    riskFreeRate: 0.04,
    iv: 0.4,
    tradingDaysPerYear: 252,
  }

  it('rows 不够长时返回空回放', () => {
    const empty = buildDailyReplay(
      makeRows(2, (i) => 100),
      baseInput,
    )
    expect(empty.tradeCount).toBe(0)
    expect(empty.equityCurve).toEqual([])
  })

  it('缺少显式回放费率时保持 blocked，不注入隐藏费率', () => {
    const { replayFeeRate, ...withoutFee } = baseInput
    const result = buildDailyReplay(rows, withoutFee)
    expect(replayFeeRate).toBe(0.001)
    expect(result.status).toBe('missing-replay-fee-input')
    expect(result.trades).toEqual([])
  })

  it('缺少 tradingDaysPerYear 时保持 blocked，不回退 365', () => {
    const { tradingDaysPerYear, ...withoutTdpy } = baseInput
    const result = buildDailyReplay(rows, withoutTdpy)
    expect(tradingDaysPerYear).toBe(252)
    expect(result.status).toBe('missing-trading-days-per-year')
    expect(result.trades).toEqual([])
  })

  it('正常输出权益曲线 + 数值有限', () => {
    const r = buildDailyReplay(rows, baseInput)
    expect(Number.isFinite(r.totalPnl)).toBe(true)
    expect(Number.isFinite(r.maxDrawdown)).toBe(true)
    expect(Number.isFinite(r.maxDrawdownPct)).toBe(true)
    expect(r.drawdownCurve).toHaveLength(r.equityCurve.length)
    expect(r.drawdownBasis.source).toContain('成本路径')
    expect(Number.isFinite(r.winRate)).toBe(true)
    expect(r.candidateAudit.eligiblePrefixes).toBeGreaterThan(0)
    expect(r.candidateAudit.acceptedCandidates + r.candidateAudit.blockedCandidates).toBe(
      r.candidateAudit.diagnosticBuyPrefixes + r.candidateAudit.diagnosticSellPrefixes,
    )
  })

  it('A4/A5 回归：tdpy 透传 + 接受外部 marketStates 不抛错', () => {
    // 行为契约：buildDailyReplay 必须接受第三个参数 marketStates，
    // 并能在传入与不传入时都返回结构合法的回放
    const tdpy = 252
    const states = buildMarketStatePath(rows, tdpy)
    const r1 = buildDailyReplay(rows, { ...baseInput, tradingDaysPerYear: tdpy }, states)
    const r2 = buildDailyReplay(rows, { ...baseInput, tradingDaysPerYear: tdpy })
    expect(r1.equityCurve[0].queryEligibility.marketStateSource).toBe('external-prefix-verified')
    expect(r2.equityCurve[0].queryEligibility.marketStateSource).toBe('internal-prefix-computed')
    // 字段齐全
    for (const r of [r1, r2]) {
      expect(Number.isFinite(r.totalPnl)).toBe(true)
      expect(Number.isFinite(r.maxDrawdown)).toBe(true)
      expect(Number.isFinite(r.maxDrawdownPct)).toBe(true)
      expect(Number.isFinite(r.winRate)).toBe(true)
      expect(Array.isArray(r.equityCurve)).toBe(true)
      expect(Array.isArray(r.drawdownCurve)).toBe(true)
      expect(Array.isArray(r.trades)).toBe(true)
    }
    // 长度等于错位 marketStates 时应回退到内部计算（A5 规约）
    const wrongLen = states.slice(0, 5)
    const r3 = buildDailyReplay(rows, baseInput, wrongLen)
    expect(Number.isFinite(r3.totalPnl)).toBe(true)
    expect(r3.equityCurve[0].queryEligibility.marketStateSource).toBe(
      'internal-prefix-recomputed-from-unverified-external',
    )

    const unverifiedSameLength = states.map((state) => ({
      ...state,
      costAnchor: 1,
      windowSpec: { ...state.windowSpec, futureRowsUsed: true },
    }))
    const r4 = buildDailyReplay(rows, baseInput, unverifiedSameLength)
    expect(r4.equityCurve[0].queryEligibility.marketStateSource).toBe(
      'internal-prefix-recomputed-from-unverified-external',
    )
    expect(r4.totalPnl).toBe(r2.totalPnl)
  })

  it('三档 profile 都能跑通且 ledger 平账', () => {
    for (const profile of strategyProfileList) {
      const r = buildDailyReplay(rows, { ...baseInput, strategyProfile: profile.id })
      expect(r.profileId).toBe(profile.id)
      expect(Number.isFinite(r.returnOnUsedNotional)).toBe(true)
      // ledger 平账：每笔卖出不应卖超持仓
      let base = 0
      for (const t of r.trades) {
        if (t.side === 'buy') base += t.baseAmount
        else expect(t.baseAmount).toBeLessThanOrEqual(base + 1e-9)
        if (t.side === 'sell') base -= t.baseAmount
      }
    }
  })

  it('回放成交不会早于信号日，也不会用未来窗口搜成交', () => {
    const r = buildDailyReplay(rows, baseInput)
    for (const trade of r.trades) {
      if (!trade.signalDate) continue
      expect(trade.fillDate >= trade.signalDate).toBe(true)
      expect(trade.exitIndex - trade.signalIndex).toBeLessThanOrEqual(1)
    }
  })

  it('追加未来数据不会改变历史回放起点与已有权益前缀', () => {
    const prefix = rows.slice(0, 140)
    const future = makeRows(40, (i) => 500 + i * 20).map((row, index) => ({
      ...row,
      date: `future-${String(index).padStart(3, '0')}`,
      timestamp: 1000 + index,
    }))
    const before = buildDailyReplay(prefix, baseInput)
    const after = buildDailyReplay([...prefix, ...future], baseInput)

    expect(after.startDate).toBe(before.startDate)
    expect(after.equityCurve.slice(0, before.equityCurve.length)).toEqual(before.equityCurve)
    expect(after.trades.filter((trade) => trade.fillDate <= prefix.at(-1).date)).toEqual(before.trades)
  })

  it('实际下一根开盘成交后用成交价重算 q/H', () => {
    const order = {
      side: 'buy',
      targetPrice: 95,
      formulaHorizonSessions: 10,
      horizonBinding: {
        eligible: true,
        mode: 'formula-derived',
        side: 'long',
        cycleStartPrice: 90,
        anchorPrice: 100,
        targetPrice: 95,
        halfLifeSessions: 10,
        modelHorizonSessions: 10,
        targetSource: 'adaptive-cost-lower',
      },
    }
    const rebound = rebindFormulaHorizonAtFill(order, {
      date: '2024-02-01',
      index: 10,
      price: 85,
      priceSource: 'next-open',
    })

    expect(rebound.horizonBinding.rederivedAtFill).toBe(true)
    expect(rebound.horizonBinding.cycleStartPrice).toBe(85)
    expect(rebound.horizonBinding.recoveryFraction).toBeCloseTo(2 / 3, 12)
    expect(rebound.formulaHorizonSessions).toBe(16)
    expect(rebound.formulaHorizonSessions).not.toBe(order.formulaHorizonSessions)
  })

  it('下一根跳空穿过限价时使用实际开盘价，不伪造成信号价成交', () => {
    const fill = resolveNextSessionLimitFill({
      row: { date: '2024-02-01', open: 85, high: 92, low: 84 },
      index: 11,
      signalIndex: 10,
      order: { side: 'buy', price: 90 },
    })
    expect(fill.price).toBe(85)
    expect(fill.priceSource).toBe('next-open')
  })

  it('新买入批次保留独立 target / expiry / horizonBinding，不做加权合并', () => {
    const firstBinding = { bindingId: 'first', side: 'long' }
    const secondBinding = { bindingId: 'second', side: 'long' }
    const plans = mergeExitPlan({
      currentPlans: [
        {
          lotId: 'lot-first',
          baseAmount: 1,
          investedCost: 90,
          targetPrice: 100,
          stopPrice: 80,
          expiresAt: 20,
          formulaHorizonSessions: 10,
          horizonBinding: firstBinding,
        },
      ],
      addedBase: 2,
      addedCost: 180,
      nextPlan: {
        entryIndex: 12,
        targetPrice: 120,
        stopPrice: 85,
        expiresAt: 42,
        formulaHorizonSessions: 30,
        horizonBinding: secondBinding,
      },
    })

    expect(plans).toHaveLength(2)
    expect(plans.map((plan) => plan.targetPrice)).toEqual([100, 120])
    expect(plans.map((plan) => plan.expiresAt)).toEqual([20, 42])
    expect(plans.map((plan) => plan.horizonBinding)).toEqual([firstBinding, secondBinding])

    const exited = accountExit({
      row: { date: '2024-02-02', open: 96, high: 105, low: 95, close: 100 },
      index: 13,
      market: { atrPercent: 0.02, costLow: 50, momentumFast: 0 },
      cash: 0,
      fee: 0,
      profile: { cutMomentumAtr: 1, cutMomentumMin: 0.01 },
      exitPlans: plans,
      input: { exitTargetReturn: 0.1 },
    })
    expect(exited.events).toHaveLength(1)
    expect(exited.events[0].lotId).toBe('lot-first')
    expect(exited.exitPlans).toHaveLength(1)
    expect(exited.exitPlans[0].horizonBinding).toBe(secondBinding)
  })

  it('盘中 low 触发止损；同柱目标与止损都命中时保守按 stop-first', () => {
    const plan = {
      lotId: 'lot-risk',
      baseAmount: 1,
      investedCost: 100,
      targetPrice: 110,
      stopPrice: 90,
      expiresAt: 99,
      horizonBinding: { bindingId: 'risk-binding', side: 'long' },
    }
    const shared = {
      index: 15,
      market: { atrPercent: 0.02, costLow: 50, momentumFast: 0 },
      cash: 0,
      fee: 0,
      profile: { cutMomentumAtr: 1, cutMomentumMin: 0.01 },
      exitPlans: [plan],
      input: { exitTargetReturn: 0.1 },
    }
    const stopOnly = accountExit({
      ...shared,
      row: { date: '2024-02-03', open: 100, high: 105, low: 89, close: 104 },
    })
    expect(stopOnly.events[0]).toMatchObject({
      reason: '失效',
      fillPrice: 90,
      exitPriceSource: 'stop-touch',
      intrabarBothHit: false,
    })

    const bothHit = accountExit({
      ...shared,
      row: { date: '2024-02-04', open: 100, high: 115, low: 85, close: 108 },
    })
    expect(bothHit.events[0]).toMatchObject({
      reason: '失效',
      fillPrice: 90,
      intrabarBothHit: true,
      intrabarPolicy: 'open-gap-first-then-stop-first-when-intrabar-order-unknown',
    })

    const gapAboveTarget = accountExit({
      ...shared,
      row: { date: '2024-02-05', open: 115, high: 120, low: 85, close: 100 },
    })
    expect(gapAboveTarget.events[0]).toMatchObject({
      reason: '目标',
      fillPrice: 115,
      intrabarBothHit: true,
      exitPriceSource: 'open-gap-through-target',
    })

    const gapBelowStop = accountExit({
      ...shared,
      row: { date: '2024-02-06', open: 85, high: 115, low: 80, close: 100 },
    })
    expect(gapBelowStop.events[0]).toMatchObject({
      reason: '失效',
      fillPrice: 85,
      intrabarBothHit: true,
      exitPriceSource: 'open-gap-through-stop',
    })
  })

  it('新成交 lot 明示延后到下一根完整日线评估退出', () => {
    const exit = accountExit({
      row: { date: '2024-02-07', open: 100, high: 120, low: 80, close: 105 },
      index: 15,
      market: { atrPercent: 0.02, costLow: 50, momentumFast: 0 },
      cash: 0,
      fee: 0,
      profile: { cutMomentumAtr: 1, cutMomentumMin: 0.01 },
      exitPlans: [
        {
          lotId: 'new-fill',
          baseAmount: 1,
          investedCost: 100,
          targetPrice: 110,
          stopPrice: 90,
          eligibleExitIndex: 16,
          sameBarExitPolicy: 'defer-to-next-complete-bar-after-fill',
        },
      ],
      input: { exitTargetReturn: 0.1 },
    })
    expect(exit).toBeNull()
  })

  it('显式小数会话期限统一向上取整，避免提前到期', () => {
    const plans = initialExitPlan({
      initialBaseNotional: 1000,
      initialPrice: 100,
      startIndex: 4,
      states: [{}, {}, {}, {}, { costLow: 90 }],
      input: {
        pathUsesScenarioInputs: true,
        formulaHorizonSessions: 2.2,
        exitTargetReturn: 0.1,
      },
    })
    expect(plans[0].formulaHorizonSessions).toBe(3)
    expect(plans[0].expiresAt).toBe(7)
  })

  it('returnOnUsedNotional 使用峰值已投入名义成本，不再除以初始账户资产', () => {
    const summary = summarizeReplay({
      rows: [{ date: '2024-02-05', close: 100 }],
      events: [],
      equityCurve: [{ date: '2024-02-05', equity: 100, usedNotional: 1000 }],
      cash: 9100,
      base: 10,
      costBasis: 1000,
      capital: 10000,
      profile: { id: 'test', label: '测试' },
    })
    expect(summary.usedNotional).toBe(1000)
    expect(summary.returnOnUsedNotional).toBeCloseTo(0.1, 12)
    expect(summary.returnOnUsedNotional).not.toBeCloseTo(0.01, 12)
  })

  it('账户入场日限制回测起点和成交日期', () => {
    const startDate = rows[100].date
    const r = buildDailyReplay(rows, { ...baseInput, accountStartDate: startDate })
    expect(r.startDate).toBe(startDate)
    expect(r.range.startsWith(startDate)).toBe(true)
    expect(r.equityCurve).toHaveLength(rows.length - 100)
    for (const trade of r.trades) {
      expect(trade.fillDate >= startDate).toBe(true)
      if (trade.signalDate) expect(trade.signalDate >= startDate).toBe(true)
    }
  })

  it('显式压力测试期限与退出目标保持独立且在 fill 后绑定', () => {
    const order = {
      side: 'buy',
      targetPrice: 110,
      formulaHorizonSessions: 10,
      horizonBinding: {
        eligible: true,
        mode: 'explicit-scenario',
        side: 'long',
        targetPrice: 110,
        modelHorizonSessions: 10,
      },
    }
    const fill = { date: '2024-02-08', index: 20, price: 80, priceSource: 'next-open' }
    const rebound = rebindFormulaHorizonAtFill(order, fill)
    const plan = orderExitPlan({
      order: rebound,
      formulaStrategy: null,
      fill,
      input: { exitTargetReturn: 0.3 },
    })

    expect(rebound.formulaHorizonSessions).toBe(10)
    expect(rebound.horizonBinding.cycleStartPrice).toBe(80)
    expect(rebound.horizonBinding.availableAt).toBe('2024-02-08:fill')
    expect(plan.targetPrice).toBe(110)
    expect(plan.expiresAt - fill.index).toBe(10)
    expect(plan.eligibleExitIndex).toBe(fill.index + 1)
    expect(plan.sameBarExitPolicy).toBe('defer-to-next-complete-bar-after-fill')
  })
})
