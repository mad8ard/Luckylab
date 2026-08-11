import { describe, expect, it } from 'vitest'
import { deriveRecoveryHorizon } from '../formulas/core.js'
import { resolveFormulaPathHorizon } from '../market-data/formulaPathHorizon.js'

const distances = [-0.4, -0.32, -0.256, -0.2048, -0.16384, -0.131072, -0.104858, -0.083886]

describe('resolveFormulaPathHorizon', () => {
  it('long 使用当前自适应成本窗口 low 极值推导 q/H', () => {
    const rows = makeRows({ closes: [94, 93, 92, 91, 90, 89, 91, 92], lows: [93, 92, 91, 90, 89, 88, 86, 85] })
    const costPath = makeCostPath(rows, { anchor: 100, lower: 90, upper: 110, window: 3 })
    const horizon = resolveFormulaPathHorizon({ rows, index: 7, costPath, costDistancePath: distances, tdpy: 242 })

    expect(horizon).toMatchObject({
      status: 'eligible',
      eligible: true,
      side: 'long',
      cycleStartPrice: 85,
      cycleStartSource: 'adaptive-cost-window-low-extreme',
      cycleStartDate: 'd7',
      cycleStartIndex: 7,
      cycleStartLookbackSessions: 0,
      anchorPrice: 100,
      targetPrice: 90,
      targetSource: 'adaptive-cost-lower',
      identityClaimClass: 'exact-identity',
      resultClaimClass: 'scenario-proxy',
      claimClass: 'scenario-proxy',
      executionAuthority: 'none',
    })
    expect(horizon.recoveryFraction).toBeCloseTo(1 / 3, 12)
    expect(horizon.modelHorizonSessions).toBe(Math.ceil(horizon.modelHorizonRaw))
  })

  it('short 使用当前自适应成本窗口 high 极值推导 q/H', () => {
    const rows = makeRows({
      closes: [106, 107, 108, 109, 110, 111, 109, 108],
      lows: [105, 106, 107, 108, 109, 110, 108, 107],
      highs: [107, 108, 109, 110, 111, 112, 114, 115],
    })
    const costPath = makeCostPath(rows, { anchor: 100, lower: 90, upper: 110, window: 3 })
    const horizon = resolveFormulaPathHorizon({ rows, index: 7, costPath, costDistancePath: distances, tdpy: 242 })

    expect(horizon).toMatchObject({
      status: 'eligible',
      side: 'short',
      cycleStartPrice: 115,
      cycleStartSource: 'adaptive-cost-window-high-extreme',
      targetPrice: 110,
      targetSource: 'adaptive-cost-upper',
    })
    expect(horizon.recoveryFraction).toBeCloseTo(1 / 3, 12)
  })

  it('窗口极值无效时向前缀回扫最近一次动态边界穿越', () => {
    const rows = makeRows({
      closes: [94, 93, 92, 91, 92, 91, 92, 92],
      lows: [93, 92, 91, 90, 89, 88, 91, 91.5],
    })
    const costPath = makeCostPath(rows, { anchor: 100, lower: 90, upper: 110, window: 2 })
    costPath[5] = { ...costPath[5], lower: 89 }
    const horizon = resolveFormulaPathHorizon({ rows, index: 7, costPath, costDistancePath: distances, tdpy: 242 })

    expect(horizon).toMatchObject({
      status: 'eligible',
      cycleStartPrice: 88,
      cycleStartSource: 'recent-dynamic-lower-crossing',
      cycleStartDate: 'd5',
      cycleStartIndex: 5,
      cycleStartLookbackSessions: 2,
    })
  })

  it('追加未来数据不改变既有前缀，且忽略手填 30 日/会话覆盖', () => {
    const rows = makeRows({ closes: [94, 93, 92, 91, 90, 89, 91, 92], lows: [93, 92, 91, 90, 89, 88, 86, 85] })
    const costPath = makeCostPath(rows, { anchor: 100, lower: 90, upper: 110, window: 3 })
    const base = resolveFormulaPathHorizon({ rows, index: 7, costPath, costDistancePath: distances, tdpy: 242 })
    const futureRows = [...rows, { date: 'future', open: 300, high: 400, low: 1, close: 350, volume: 1 }]
    const futureCostPath = [...costPath, costPoint('future', 350, { anchor: 200, lower: 100, upper: 300, window: 8 })]
    const withFuture = resolveFormulaPathHorizon({
      rows: futureRows,
      index: 7,
      costPath: futureCostPath,
      costDistancePath: [...distances, 99],
      tdpy: 242,
      input: { formulaHorizonSessions: 30, formulaHorizonDays: 30, holdingDays: 30 },
    })
    const withManualThirty = resolveFormulaPathHorizon({
      rows,
      index: 7,
      costPath,
      costDistancePath: distances,
      tdpy: 242,
      input: { formulaHorizonSessions: 30, formulaHorizonDays: 30, holdingDays: 30 },
    })

    expect(withFuture).toEqual(base)
    expect(withManualThirty).toEqual(base)
    expect(base.modelHorizonSessions).not.toBe(30)
  })

  it('AR 前缀不满足正向单调衰减时保持模型门禁失败', () => {
    const rows = makeRows({ closes: [94, 93, 92, 91, 90, 89], lows: [93, 92, 91, 89, 87, 85] })
    const costPath = makeCostPath(rows, { anchor: 100, lower: 90, upper: 110, window: 3 })
    const horizon = resolveFormulaPathHorizon({
      rows,
      index: 5,
      costPath,
      costDistancePath: [-1, 1, -1, 1, -1, 1],
      tdpy: 242,
    })

    expect(horizon).toMatchObject({
      status: 'model-gate-failed',
      eligible: false,
      reason: 'non-monotonic-or-insufficient-ar-prefix',
      executionAuthority: 'none',
    })
  })
})

describe('deriveRecoveryHorizon audit payload', () => {
  it('目标已跨越时仍保留输入、gap 与可计算 raw q', () => {
    const horizon = deriveRecoveryHorizon({
      cycleStartPrice: 27.42,
      anchorPrice: 28.705688008913967,
      targetPrice: 26.036268881681373,
      halfLifeSessions: 10.236335039603425,
      side: 'long',
      availableAt: '2026-08-07:close',
    })

    expect(horizon).toMatchObject({
      status: 'not-applicable',
      reason: 'target-already-crossed-at-cycle-start',
      cycleStartPrice: 27.42,
      anchorPrice: 28.705688008913967,
      targetPrice: 26.036268881681373,
      halfLifeSessions: 10.236335039603425,
      side: 'long',
      availableAt: '2026-08-07:close',
    })
    expect(horizon.anchorGap).toBeCloseTo(1.285688008913965, 12)
    expect(horizon.targetGap).toBeCloseTo(-1.3837311183186287, 12)
    expect(horizon.rawRecoveryFraction).toBeCloseTo(-1.0762573102688278, 12)
    expect(horizon.recoveryFraction).toBe(horizon.rawRecoveryFraction)
  })
})

function makeRows({ closes, lows, highs = null }) {
  return closes.map((close, index) => ({
    date: `d${index}`,
    open: close,
    high: highs?.[index] ?? close + 1,
    low: lows[index],
    close,
    volume: 1,
  }))
}

function makeCostPath(rows, spec) {
  return rows.map((row) => costPoint(row.date, row.close, spec))
}

function costPoint(date, close, { anchor, lower, upper, window }) {
  return {
    date,
    close,
    anchor,
    lower,
    upper,
    windowSpec: { cost: window, mode: 'adaptive-prefix', futureRowsUsed: false },
  }
}
