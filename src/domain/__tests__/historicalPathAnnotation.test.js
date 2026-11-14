import { describe, expect, it } from 'vitest'

import {
  deriveHistoricalPathAnnotation,
  HISTORICAL_PATH_THRESHOLDS,
} from '../market-data/historicalPathAnnotation.js'

describe('历史路径旁注', () => {
  it('同时产出锚下比例、年化对数斜率和历史最大回撤', () => {
    const rows = makeRows([100, 95, 90, 92, 88, 85, 87])
    const result = deriveHistoricalPathAnnotation(rows, { tradingDaysPerYear: 252 })

    expect(result.status).toBe('ok')
    expect(result.rows).toBe(7)
    expect(result.belowAnchorRatio).toBeGreaterThan(0)
    expect(result.belowAnchorRatio).toBeLessThanOrEqual(1)
    expect(result.annualizedLogSlope).toBeLessThan(0)
    expect(result.maxCloseDrawdown).toBeLessThan(0)
    expect(result.marks.belowAnchorRatio).toBe('high')
    expect(result.marks.annualizedLogSlope).toBe('high')
    expect(result.marks.maxCloseDrawdown).toBe('normal')
  })

  it('标记阈值不会改变原始数据，只用于旁注着色', () => {
    const rows = makeRows([100, 101, 102, 103, 104])
    const result = deriveHistoricalPathAnnotation(rows)

    expect(result.status).toBe('ok')
    expect(result.maxCloseDrawdown).toBe(0)
    expect(result.marks.maxCloseDrawdown).toBe('normal')
    expect(HISTORICAL_PATH_THRESHOLDS.belowAnchorHigh).toBe(0.65)
  })

  it('历史不足时明确返回状态', () => {
    expect(deriveHistoricalPathAnnotation([]).status).toBe('insufficient-history')
  })
})

function makeRows(closes) {
  return closes.map((close, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1000 + index,
  }))
}
