import { describe, expect, it } from 'vitest'
import { buildVolumePriceProfile } from '../research-visualization/volumePriceProfile.js'

function row(date, open, high, low, close, volume) {
  return { date, open, high, low, close, volume }
}

describe('buildVolumePriceProfile', () => {
  it('按价格区间分摊 OHLCV 成交量，不依赖公式路径', () => {
    const rows = [
      row('2024-01-01', 10, 12, 10, 11, 100),
      row('2024-01-02', 11, 13, 11, 12, 200),
      row('2024-01-03', 12, 13, 12, 12.5, 300),
    ]
    const profile = buildVolumePriceProfile({ rows, binCount: 12 })

    expect(profile.status).toBe('proxy-only')
    expect(profile.method).toBe('volume-by-price')
    expect(profile.rows).toBe(3)
    expect(profile.bins).toHaveLength(12)
    expect(profile.totalVolume).toBeCloseTo(600, 8)
    expect(profile.poc.volume).toBeGreaterThan(0)
    expect(profile.valueArea.share).toBeGreaterThanOrEqual(0.7)
  })

  it('activeIndex 与 visibleWindow 限制筹码窗口，避免使用观察日之后数据', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(
      `2024-01-0${i + 1}`,
      10 + i,
      11 + i,
      9 + i,
      10.5 + i,
      100 + i,
    ))
    const profile = buildVolumePriceProfile({ rows, activeIndex: 4, visibleWindow: 3, binCount: 16 })

    expect(profile.rows).toBe(3)
    expect(profile.firstDate).toBe('2024-01-03')
    expect(profile.lastDate).toBe('2024-01-05')
    expect(profile.currentPrice).toBe(14.5)
    expect(profile.totalVolume).toBeCloseTo(100 + 2 + 100 + 3 + 100 + 4, 8)
  })

  it('标记 POC、当前价所在 bin 和价值区间', () => {
    const rows = [
      row('2024-01-01', 100, 101, 99, 100.5, 50),
      row('2024-01-02', 100.5, 103, 101, 102.5, 500),
      row('2024-01-03', 102.5, 103, 102, 102.8, 450),
    ]
    const profile = buildVolumePriceProfile({ rows, binCount: 20 })

    expect(profile.bins.some((bin) => bin.isPoc)).toBe(true)
    expect(profile.bins.some((bin) => bin.isCurrent)).toBe(true)
    expect(profile.bins.some((bin) => bin.inValueArea)).toBe(true)
    expect(profile.poc.isPoc).toBe(true)
  })

  it('无有效成交量时返回空模型', () => {
    const profile = buildVolumePriceProfile({
      rows: [row('2024-01-01', 10, 11, 9, 10, 0)],
    })

    expect(profile.status).toBe('empty')
    expect(profile.bins).toEqual([])
  })
})
