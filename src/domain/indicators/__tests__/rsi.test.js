import { describe, expect, it } from 'vitest'
import { computeRSI } from '../rsi.js'

describe('computeRSI', () => {
  function rowsFromCloses(closes) {
    return closes.map((c, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1000,
    }))
  }

  it('前 n 根返回 null（n=14 时前 14 根）', () => {
    const result = computeRSI(rowsFromCloses(Array.from({ length: 14 }, (_, i) => 100 + i)))
    expect(result.length).toBe(14)
    for (const r of result) {
      expect(r.raw).toBeNull()
      expect(r.custom).toBeNull()
    }
  })

  it('单调上涨：raw 收敛 100', () => {
    const result = computeRSI(rowsFromCloses(Array.from({ length: 40 }, (_, i) => 100 + i)))
    const last = result.at(-1)
    expect(last.raw).toBeCloseTo(100, 0)
    expect(last.custom).toBeCloseTo((100 - 35) * 2, 0)
  })

  it('单调下跌：raw 收敛 0', () => {
    const result = computeRSI(rowsFromCloses(Array.from({ length: 40 }, (_, i) => 200 - i)))
    const last = result.at(-1)
    expect(last.raw).toBeCloseTo(0, 0)
    expect(last.custom).toBeCloseTo((0 - 35) * 2, 0)
  })

  it('横盘：raw=50（除零兜底） + custom=30', () => {
    const result = computeRSI(rowsFromCloses(Array.from({ length: 30 }, () => 100)))
    const last = result.at(-1)
    expect(last.raw).toBeCloseTo(50, 1)
    expect(last.custom).toBeCloseTo(30, 1)
  })

  it('自定义 n 参数生效', () => {
    const rows = rowsFromCloses(Array.from({ length: 30 }, (_, i) => 100 + i))
    const r1 = computeRSI(rows, { n: 5 })
    const r2 = computeRSI(rows, { n: 14 })
    expect(r1[5].raw).not.toBeNull()
    expect(r2[5].raw).toBeNull()
  })
})
