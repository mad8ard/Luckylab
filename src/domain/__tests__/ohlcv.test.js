import { describe, expect, it } from 'vitest'
import { assessOhlcvQuality, parseCsvText } from '../market-data/ohlcv.js'

function candle(index, { flatBody = false, ranged = true } = {}) {
  const open = 100 + index
  const close = flatBody ? open : open + (index % 2 ? -1 : 1)
  return {
    date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    timestamp: Date.UTC(2026, 0, index + 1),
    open,
    high: ranged ? Math.max(open, close) + 2 : open,
    low: ranged ? Math.min(open, close) - 2 : open,
    close,
    volume: 1_000,
  }
}

describe('assessOhlcvQuality', () => {
  it('flags a ranged series whose opening prices were replaced by closes', () => {
    const result = assessOhlcvQuality(Array.from({ length: 30 }, (_, index) => candle(index, { flatBody: true })))

    expect(result.flatBodyRatio).toBe(1)
    expect(result.suspectedSyntheticOpen).toBe(true)
  })

  it('accepts normal red and green candle bodies', () => {
    const result = assessOhlcvQuality(Array.from({ length: 30 }, (_, index) => candle(index)))

    expect(result.flatBodyRatio).toBe(0)
    expect(result.suspectedSyntheticOpen).toBe(false)
  })

  it('does not mistake a short or zero-range series for synthetic opens', () => {
    const result = assessOhlcvQuality(
      Array.from({ length: 10 }, (_, index) => candle(index, { flatBody: true, ranged: false })),
    )

    expect(result.rangedRows).toBe(0)
    expect(result.suspectedSyntheticOpen).toBe(false)
  })

  it('detects a common split ratio left in an unadjusted series', () => {
    const rows = [candle(0), candle(1)]
    rows[0].close = 1_208.88
    rows[0].high = 1_210
    rows[1].open = 120.37
    rows[1].high = 122
    rows[1].low = 119
    rows[1].close = 121.79

    const result = assessOhlcvQuality(rows)

    expect(result.corporateActionBreaks).toHaveLength(1)
    expect(result.corporateActionBreaks[0].splitRatio).toBe(0.1)
  })

  it('rejects a CSV row with missing volume instead of coercing it to zero', () => {
    const rows = parseCsvText('Date,Open,High,Low,Close,Volume\n2026-01-02,10,12,9,11,')

    expect(rows).toEqual([])
  })
})
