import { describe, expect, it } from 'vitest'

import {
  buildRegimeMap,
  choosePrimaryVariant,
} from '../strategy-planning/analogVariants.js'

describe('analogVariants', () => {
  it('builds causal regime buckets from index history', () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      close: 100 + index,
    }))
    const map = buildRegimeMap(rows, { lookback: 20, highVolThreshold: 0.2 })
    const regime = map.get(rows.at(-1).date)
    expect(regime.trend).toBe('up')
    expect(['high', 'low']).toContain(regime.volBucket)
    expect(map.has(rows[10].date)).toBe(false)
  })

  it('chooses the design variant with the strongest target rank', () => {
    const primary = choosePrimaryVariant({
      sameStock: { design: { status: 'ok', targetRankCorrelation: 0.2, maeRankCorrelation: 0.1, fwd10RankCorrelation: 0 } },
      sameStockRegime: { design: { status: 'ok', targetRankCorrelation: 0.25, maeRankCorrelation: 0.05, fwd10RankCorrelation: 0 } },
      crossSectional: { design: { status: 'ok', targetRankCorrelation: 0.1, maeRankCorrelation: 0.2, fwd10RankCorrelation: 0.1 } },
    })
    expect(primary).toBe('sameStockRegime')
  })
})
