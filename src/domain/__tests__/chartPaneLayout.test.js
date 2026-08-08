import { describe, expect, it } from 'vitest'
import { resolveChartOverlayPlan } from '../research-visualization/chartPaneLayout.js'

const baseOverlays = {
  priceBands: true,
  greeksPane: true,
  lpPane: true,
  carryPane: true,
  executionMarkers: true,
  researchMarkers: true,
  costBand: true,
  entryLine: true,
  volBand: true,
  volume: true,
  replayMarkers: true,
  replayMarkerLabels: true,
  currentDecision: true,
  equityPane: true,
  kdjPane: true,
  rsiPane: true,
}

describe('resolveChartOverlayPlan', () => {
  it('缺 funding 数据时隐藏 carry pane，但保留后续 KDJ/RSI', () => {
    const plan = resolveChartOverlayPlan({
      overlays: baseOverlays,
      formulaPath: [{ optionDelta: 0.1, lpValue: 1, capitalEfficiency: 2, lpNormalizedDelta: 0.2, lpPoolTurnover24h: 0.3 }],
    })
    expect(plan.paneOn.carry).toBe(false)
    expect(plan.paneOn.lpPoolCoverage).toBe(true)
    expect(plan.panes.volume).toBe(1)
    expect(plan.panes.greeks).toBe(2)
    expect(plan.panes.lp).toBe(3)
    expect(plan.panes.equity).toBe(4)
    expect(plan.panes.kdj).toBe(5)
    expect(plan.panes.rsi).toBe(6)
  })

  it('有 funding 数据时插入 carry pane，不覆盖后续指标', () => {
    const plan = resolveChartOverlayPlan({
      overlays: baseOverlays,
      formulaPath: [{ optionGamma: 0.1, lpValue: 1, lpNormalizedDelta: 0.2, fundingProxy: 0.001, netCarry: -0.001 }],
    })
    expect(plan.paneOn.carry).toBe(true)
    expect(plan.panes.carry).toBe(4)
    expect(plan.panes.equity).toBe(5)
    expect(plan.panes.kdj).toBe(6)
    expect(plan.panes.rsi).toBe(7)
  })

  it('没有聚合池真实快照时不打开 LP 真实覆盖线', () => {
    const plan = resolveChartOverlayPlan({
      overlays: baseOverlays,
      formulaPath: [{ lpValue: 1, lpNormalizedDelta: 0.2 }],
    })

    expect(plan.paneOn.lp).toBe(true)
    expect(plan.paneOn.lpPoolCoverage).toBe(false)
  })

  it('价格带组关闭时不会继续画成本和波动价带', () => {
    const plan = resolveChartOverlayPlan({
      overlays: { ...baseOverlays, priceBands: false },
      formulaPath: [],
    })
    expect(plan.price.costBand).toBe(false)
    expect(plan.price.deltaBand).toBe(false)
    expect(plan.price.lpBand).toBe(false)
    expect(plan.price.entryLine).toBe(true)
  })
})
