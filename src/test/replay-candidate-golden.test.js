import { describe, expect, it } from 'vitest'
import { buildDailyReplay } from '../domain/replay/dailyReplay.js'
import { buildFormulaPath } from '../domain/market-data/formulaPath.js'
import { loadCsv } from './helpers/loadCsv.js'

describe('dynamic candidate replay golden', () => {
  it('002179 的动态周期修正会阻断旧的逐日重置伪候选', () => {
    const rows = loadCsv('public/data/002179-1d.csv').filter((row) => row.date <= '2026-08-07')
    const replay = buildDailyReplay(rows, {
      deltaSlope: 0.3,
      exitTargetReturn: 0,
      capital: 100_000,
      baseNotional: 0,
      strategyProfile: 'balanced',
      rangeWidth: 0.1,
      skew: 1,
      liquidity: 1,
      replayFeeRate: 0.001,
      optionType: 'put',
      riskFreeRate: 0.04,
      iv: 0.4,
      tradingDaysPerYear: 242,
      accountStartDate: '2026-08-04',
    })

    expect(replay.candidateAudit).toEqual({
      eligiblePrefixes: 3,
      diagnosticBuyPrefixes: 3,
      diagnosticSellPrefixes: 0,
      acceptedCandidates: 0,
      blockedCandidates: 3,
      statusCounts: { 观察: 0, 等待: 3, 剔除: 0, 需刷新数据: 0 },
    })
    expect(replay.tradeCount).toBe(0)

    const formulaPoint = buildFormulaPath(rows, { deltaSlope: 0.3, tradingDaysPerYear: 242 }).find(
      (point) => point.date === '2026-08-04',
    )
    expect(formulaPoint.formulaHorizonSessions).toBe(8)
    expect(formulaPoint.fieldStates.formulaHorizonSessions.context).toMatchObject({
      cycleStartPrice: 31.88,
      cycleStartSource: 'adaptive-cost-window-low-extreme',
      targetSource: 'adaptive-cost-lower',
    })
  })
})
