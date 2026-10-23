import { describe, expect, it } from 'vitest'

import {
  FUND_FLOW_WEIGHTS,
  computeFundFlowScore,
  fundFlowBand,
  percentileRank,
} from '../strategy-planning/fundFlowScore.js'

describe('fundFlowScore', () => {
  it('weights sum to one', () => {
    expect(FUND_FLOW_WEIGHTS.today + FUND_FLOW_WEIGHTS.d3 + FUND_FLOW_WEIGHTS.d5).toBeCloseTo(1, 10)
  })

  it('percentile rank counts <= value', () => {
    expect(percentileRank([-3, -1, 0, 1, 3], 1)).toBe(80)
    expect(percentileRank([], 1)).toBeNull()
    expect(percentileRank([1, 2], null)).toBeNull()
  })

  it('combines today / 3d / 5d percentiles with declared weights', () => {
    const result = computeFundFlowScore({ todayPct: 50, d3Pct: 60, d5Pct: 70 })
    expect(result.score).toBe(61.5)
    expect(result.usedWindows).toEqual(['today', 'd3', 'd5'])
    expect(result.missingWindows).toEqual([])
    expect(result.components.d5).toEqual({ percentile: 70, weight: 0.4, contribution: 28 })
  })

  it('renormalizes when a window is missing instead of treating it as zero', () => {
    const result = computeFundFlowScore({ todayPct: null, d3Pct: 60, d5Pct: 70 })
    expect(result.score).toBe(65.33)
    expect(result.usedWindows).toEqual(['d3', 'd5'])
    expect(result.missingWindows).toEqual(['today'])
    expect(result.weightSum).toBe(0.75)
  })

  it('returns null when every window is missing', () => {
    const result = computeFundFlowScore({ todayPct: null, d3Pct: undefined, d5Pct: null })
    expect(result.score).toBeNull()
    expect(result.usedWindows).toEqual([])
    expect(result.missingWindows).toEqual(['today', 'd3', 'd5'])
  })

  it('maps scores to readable bands', () => {
    expect(fundFlowBand(80).key).toBe('strong')
    expect(fundFlowBand(60).key).toBe('positive')
    expect(fundFlowBand(40).key).toBe('neutral')
    expect(fundFlowBand(20).key).toBe('weak')
    expect(fundFlowBand(null).key).toBe('missing')
  })
})
