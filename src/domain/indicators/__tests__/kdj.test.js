import { describe, expect, it } from 'vitest'
import { computeKDJ } from '../kdj.js'

describe('computeKDJ', () => {
  function rowsFromCloses(closes) {
    return closes.map((c, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1000,
    }))
  }

  it('前 n-1 根返回 null（n=9 时前 8 根）', () => {
    const result = computeKDJ(rowsFromCloses([1, 2, 3, 4, 5, 6, 7, 8]))
    expect(result.length).toBe(8)
    for (const r of result) {
      expect(r.k).toBeNull()
      expect(r.d).toBeNull()
      expect(r.j).toBeNull()
    }
  })

  it('单调上涨：J 收敛于 100 以上', () => {
    const result = computeKDJ(rowsFromCloses(Array.from({ length: 30 }, (_, i) => 100 + i * 2)))
    const last = result.at(-1)
    expect(last.k).toBeGreaterThan(50)
    expect(last.j).toBeGreaterThanOrEqual(last.k)
  })

  it('单调下跌：J 跌到 0 以下', () => {
    const result = computeKDJ(rowsFromCloses(Array.from({ length: 30 }, (_, i) => 200 - i * 2)))
    const last = result.at(-1)
    expect(last.k).toBeLessThan(50)
    expect(last.j).toBeLessThanOrEqual(last.k)
  })

  it('横盘 div=0 时 rsv 走 50 兜底', () => {
    const flat = Array.from({ length: 20 }, () => 100)
    const rows = flat.map((c, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      open: c, high: c, low: c, close: c, volume: 1000,
    }))
    const result = computeKDJ(rows)
    const last = result.at(-1)
    expect(last.k).toBeCloseTo(50, 1)
    expect(last.d).toBeCloseTo(50, 1)
    expect(last.j).toBeCloseTo(50, 1)
  })

  it('自定义 n / sig 参数生效', () => {
    const rows = rowsFromCloses(Array.from({ length: 20 }, (_, i) => 100 + i))
    const r1 = computeKDJ(rows, { n: 5, sig: 3 })
    const r2 = computeKDJ(rows, { n: 9, sig: 3 })
    // n=5 时第 4 根开始有值；n=9 时第 8 根才有
    expect(r1[5].k).not.toBeNull()
    expect(r2[5].k).toBeNull()
  })
})
