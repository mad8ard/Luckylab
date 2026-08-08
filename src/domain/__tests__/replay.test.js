import { describe, expect, it } from 'vitest'
import { buildMarketStatePath } from '../market-data/cost.js'
import { buildDailyReplay } from '../replay/dailyReplay.js'
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
  const rows = makeRows(200, i => 100 + Math.sin(i / 8) * 10)
  const baseInput = {
    holdingDays: 30,
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
  }

  it('rows 不够长时返回空回放', () => {
    const empty = buildDailyReplay(makeRows(20, i => 100), baseInput)
    expect(empty.tradeCount).toBe(0)
    expect(empty.equityCurve).toEqual([])
  })

  it('正常输出权益曲线 + 数值有限', () => {
    const r = buildDailyReplay(rows, baseInput)
    expect(Number.isFinite(r.totalPnl)).toBe(true)
    expect(Number.isFinite(r.maxDrawdown)).toBe(true)
    expect(Number.isFinite(r.maxDrawdownPct)).toBe(true)
    expect(r.drawdownCurve).toHaveLength(r.equityCurve.length)
    expect(r.drawdownBasis.source).toContain('成本路径')
    expect(Number.isFinite(r.winRate)).toBe(true)
  })

  it('A4/A5 回归：tdpy 透传 + 接受外部 marketStates 不抛错', () => {
    // 行为契约：buildDailyReplay 必须接受第三个参数 marketStates，
    // 并能在传入与不传入时都返回结构合法的回放
    const tdpy = 252
    const states = buildMarketStatePath(rows, tdpy)
    const r1 = buildDailyReplay(rows, { ...baseInput, tradingDaysPerYear: tdpy }, states)
    const r2 = buildDailyReplay(rows, { ...baseInput, tradingDaysPerYear: tdpy })
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

  it('回放退出使用退出目标和持仓窗口，不再用隐藏短线阈值', () => {
    const planRows = makeRows(80, () => 90).map((row, index) => ({
      ...row,
      high: index === 25 ? 118 : 91,
      low: 89,
      close: index === 25 ? 117 : 90,
    }))
    const marketStates = planRows.map((row) => ({
      markPrice: row.close,
      costAnchor: 110,
      costLow: 95,
      costHigh: 120,
      atrPercent: 0.02,
      annualVol: 0.2,
      costDistance: -0.18,
      costSlope5: 0,
      momentum5: 0.03,
    }))
    const replay = buildDailyReplay(planRows, { ...baseInput, holdingDays: 10, exitTargetReturn: 0.3 }, marketStates)
    const buy = replay.trades.find((trade) => trade.side === 'buy')
    const sell = replay.trades.find((trade) => trade.side === 'sell')

    expect(buy).toBeTruthy()
    expect(sell).toBeTruthy()
    expect(buy.targetPrice).toBeGreaterThanOrEqual(buy.fillPrice * 1.3 - 1e-9)
    expect(buy.formulaStrategy.steps.map((step) => step.id)).toEqual(['cost', 'delta-band', 'deviation-score', 'order-plan'])
    expect(sell.reason).toBe('目标')
    expect(sell.exitIndex - buy.exitIndex).toBeGreaterThan(1)
    expect(sell.exitIndex - buy.exitIndex).toBeLessThanOrEqual(10)
  })
})
