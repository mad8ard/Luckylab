import { describe, expect, it } from 'vitest'
import { buildCostPath, buildMarketState, buildMarketStatePath, deriveWindows } from '../market-data/cost.js'

function makeRows(n, basePrice = 100) {
  return Array.from({ length: n }, (_, i) => ({
    date: `2024-${String(Math.floor(i / 30) + 1).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`,
    timestamp: i,
    open: basePrice + i * 0.1,
    high: basePrice + i * 0.1 + 1,
    low: basePrice + i * 0.1 - 1,
    close: basePrice + i * 0.1,
    volume: 1000,
  }))
}

describe('deriveWindows', () => {
  it('小样本下窗口缩小', () => {
    const small = deriveWindows(20)
    const big = deriveWindows(800)
    expect(small.cost).toBeLessThan(big.cost)
  })
  it('外部 override 优先', () => {
    const w = deriveWindows(100, { cost: 30 })
    expect(w.cost).toBe(30)
  })
})

describe('buildMarketStatePath（A1/A2 回归）', () => {
  it('产出长度等于输入', () => {
    const rows = makeRows(60)
    const path = buildMarketStatePath(rows)
    expect(path.length).toBe(60)
  })
  it('跨调用不再污染：先长再短不影响短的窗口', () => {
    const long = makeRows(200)
    const short = makeRows(40)
    const longPath = buildMarketStatePath(long)
    const shortPath1 = buildMarketStatePath(short)
    // 重新调一次长的
    buildMarketStatePath(long)
    const shortPath2 = buildMarketStatePath(short)
    // 第二次短调用结果应与第一次完全一致（消除全局污染）
    expect(shortPath2.at(-1).costAnchor).toBeCloseTo(shortPath1.at(-1).costAnchor, 9)
    expect(longPath.length).toBe(200)
  })
  it('tradingDaysPerYear 影响 annualVol', () => {
    // 用震荡数据制造可观测的波动，否则两个 tdpy 算出的 vol 都接近 0
    const rows = Array.from({ length: 100 }, (_, i) => {
      const close = 100 + Math.sin(i / 4) * 8
      return {
        date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
        timestamp: i,
        open: close, high: close + 1, low: close - 1, close, volume: 1000,
      }
    })
    const a = buildMarketStatePath(rows, 365)
    const b = buildMarketStatePath(rows, 252)
    // sqrt(365/252) ≈ 1.203，差异显著
    const ratio = a.at(-1).annualVol / b.at(-1).annualVol
    expect(ratio).toBeCloseTo(Math.sqrt(365 / 252), 3)
  })
})

describe('buildCostPath', () => {
  it('每行都有 anchor / lower / upper', () => {
    const path = buildCostPath(makeRows(60))
    expect(path.every(r => Number.isFinite(r.anchor) && r.lower < r.anchor && r.anchor < r.upper)).toBe(true)
  })
  it('与 buildMarketStatePath 同口径（A2 回归）', () => {
    const rows = makeRows(80)
    const cost = buildCostPath(rows)
    const states = buildMarketStatePath(rows)
    // 最后一根的 anchor 应一致
    expect(cost.at(-1).anchor).toBeCloseTo(states.at(-1).costAnchor, 9)
  })
})

describe('buildMarketState', () => {
  it('返回路径最后一根', () => {
    const rows = makeRows(50)
    const state = buildMarketState(rows)
    expect(state.markPrice).toBe(rows.at(-1).close)
  })
  it('rows < 2 返回 null', () => {
    expect(buildMarketState([])).toBeNull()
    expect(buildMarketState([makeRows(1)[0]])).toBeNull()
  })
})
