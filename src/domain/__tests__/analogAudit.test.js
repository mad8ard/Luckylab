import { describe, expect, it } from 'vitest'

import {
  analogDistance,
  computeAnalogOutcomes,
  scoreAnalogAudit,
  scorePathStats,
  spearmanRankCorrelation,
} from '../strategy-planning/analogAudit.js'

function baseFeatures(overrides = {}) {
  return {
    costDistancePct: -5,
    zScore: -2,
    lpPercentile: 10,
    costSlopePct: -1,
    annualVolPct: 30,
    lpZone: 'range',
    ...overrides,
  }
}

function sampleRows({ exitClose = 110, low = 98, high = 104 } = {}) {
  return Array.from({ length: 22 }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    open: 100,
    high: index === 1 ? high : 101,
    low: index === 1 ? low : 99,
    close: index === 5 ? exitClose : 100,
  }))
}

describe('analogAudit', () => {
  it('distance is zero for identical feature vectors and grows with deviation', () => {
    expect(analogDistance(baseFeatures(), baseFeatures())).toBe(0)
    expect(analogDistance(baseFeatures(), baseFeatures({ zScore: 0 }))).toBeGreaterThan(0)
  })

  it('requires at least three usable features', () => {
    expect(analogDistance(
      baseFeatures({ zScore: null, lpPercentile: null, costSlopePct: null }),
      baseFeatures(),
    )).toBeNull()
  })

  it('computes forward returns, MAE and target-first outcome', () => {
    const out = computeAnalogOutcomes(sampleRows({ low: 99 }), 0)
    expect(out.outcomes.fwd5Pct).toBe(10)
    expect(out.outcomes.mae20Pct).toBe(-1)
    expect(out.outcome).toBe('target')
    expect(out.targetFirst).toBe(true)
  })

  it('treats same-bar target and stop as stop-first', () => {
    const out = computeAnalogOutcomes(sampleRows({ high: 104, low: 98 }), 0)
    expect(out.outcome).toBe('stop')
    expect(out.targetFirst).toBe(false)
  })

  it('scores only when enough analogs exist', () => {
    const stats = {
      count: 8,
      effectiveCount: 6,
      fwd10MedianPct: 3,
      fwd20MedianPct: 4,
      winRate20Pct: 60,
      mae20MedianPct: -5,
      targetFirstRate: 50,
      sampleConfidence: 0.8,
    }
    const ok = scoreAnalogAudit({ stats, sampleConfidence: 0.8 })
    expect(ok.status).toBe('ok')
    expect(ok.auditScore).toBeGreaterThan(0)
    expect(ok.auditScore).toBeLessThanOrEqual(100)
    expect(ok.components.path.max).toBe(90)
    expect(ok.components.confidence.max).toBe(10)
    const insufficient = scoreAnalogAudit({ stats: { ...stats, count: 7 } })
    expect(insufficient.status).toBe('insufficient-analogs')
    expect(insufficient.auditScore).toBeNull()
  })

  it('scores a path-only result with target 10 / MAE 40 / 10d 10', () => {
    const score = scorePathStats({
      count: 10,
      targetFirstRate: 60,
      mae20MedianPct: -5,
      fwd10MedianPct: 2,
    })
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(100)
    expect(scorePathStats({ count: 7 })).toBeNull()
  })

  it('computes rank correlation with ties', () => {
    expect(spearmanRankCorrelation([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1)
    expect(spearmanRankCorrelation([1, 2, 3, 4], [40, 30, 20, 10])).toBe(-1)
    expect(spearmanRankCorrelation([1, 1, 2], [5, 5, 9])).toBe(1)
  })
})
