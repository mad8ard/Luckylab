import { describe, expect, it } from 'vitest'

import {
  HK_RECOMMENDATION_WEIGHTS,
  rankHongKongCandidates,
} from '../strategy-planning/hongKongRecommendation.js'

describe('港股独立推荐', () => {
  it('权重总和为100，并且只返回指定数量的港股前三名', () => {
    expect(Object.values(HK_RECOMMENDATION_WEIGHTS).reduce((sum, value) => sum + value, 0)).toBe(100)
    const records = Array.from({ length: 5 }, (_, index) => ({
      entry: {
        symbol: `000${index + 1}.HK`,
        label: `港股${index + 1}`,
        market: '港股',
      },
      rows: makeRows(320, 0.0005 + index * 0.0002),
    }))
    records.push({
      entry: { symbol: '600000', label: '非港股', market: 'A股' },
      rows: makeRows(320, 0.001),
    })

    const result = rankHongKongCandidates(records, {
      asOfDate: '2024-12-01',
      limit: 3,
    })

    expect(result.items).toHaveLength(3)
    expect(result.items.map((item) => item.rank)).toEqual([1, 2, 3])
    expect(result.items.every((item) => item.market === '港股')).toBe(true)
    expect(result.items.every((item) => item.score <= 100)).toBe(true)
    expect(result.items[0].score).toBeGreaterThanOrEqual(result.items[1].score)
    expect(result.items[1].score).toBeGreaterThanOrEqual(result.items[2].score)
    expect(result.evaluated.find((item) => item.symbol === '600000')?.gateReasons).toContain(
      'not-hong-kong',
    )
  })

  it('陈旧行情和明显下行趋势不会进入前三名', () => {
    const eligible = {
      entry: { symbol: '0001.HK', label: '上升样本', market: '港股' },
      rows: makeRows(320, 0.0008, '2024-12-01'),
    }
    const stale = {
      entry: { symbol: '0002.HK', label: '陈旧样本', market: '港股' },
      rows: makeRows(320, 0.002, '2024-01-01'),
    }
    const falling = {
      entry: { symbol: '0003.HK', label: '下行样本', market: '港股' },
      rows: makeRows(320, -0.004, '2024-12-01'),
    }

    const result = rankHongKongCandidates([stale, falling, eligible], {
      asOfDate: '2024-12-01',
      limit: 3,
    })

    expect(result.items.map((item) => item.symbol)).toEqual(['0001.HK'])
    expect(result.evaluated.find((item) => item.symbol === '0002.HK')?.gateReasons).toContain(
      'stale-data',
    )
    expect(result.evaluated.find((item) => item.symbol === '0003.HK')?.gateReasons.length).toBeGreaterThan(0)
  })
})

function makeRows(count, drift, lastDate = '2024-12-01') {
  const end = new Date(`${lastDate}T00:00:00Z`)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(end)
    date.setUTCDate(date.getUTCDate() - (count - 1 - index))
    const close = 100 * Math.exp(drift * index + 0.018 * Math.sin(index / 9))
    return {
      date: date.toISOString().slice(0, 10),
      open: close * 0.998,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1_000_000 + (index % 20) * 20_000,
    }
  })
}
