import { describe, expect, it, beforeEach } from 'vitest'
import { CHART_OVERLAY_KEYS } from '../../components/chartOverlayToggles.js'
import { CHART_OVERLAY_DEFAULTS, useChartOverlays } from '../useChartOverlays.js'

describe('useChartOverlays', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('lab.chartOverlays.v1')
      window.localStorage.removeItem('lab.chartOverlays.v2')
      window.localStorage.removeItem('lab.chartOverlays.v3')
      window.localStorage.removeItem('lab.chartOverlays.v4')
      window.localStorage.removeItem('lab.chartOverlays.v5')
      window.localStorage.removeItem('lab.chartOverlays.v6')
      window.localStorage.removeItem('lab.chartOverlays.v7')
      window.localStorage.removeItem('lab.chartOverlays.v8')
      window.localStorage.removeItem('lab.chartOverlays.v9')
    }
  })

  it('返回布局开关字段，默认值优先保护主图阅读面积', () => {
    const o = useChartOverlays()
    for (const key of CHART_OVERLAY_KEYS) {
      expect(Object.keys(CHART_OVERLAY_DEFAULTS)).toContain(key)
    }
    expect(o.priceBands).toBe(true)
    expect(o.greeksPane).toBe(false)
    expect(o.lpPane).toBe(false)
    expect(o.carryPane).toBe(false)
    expect(o.executionMarkers).toBe(true)
    expect(o.researchMarkers).toBe(true)
    expect(o.costBand).toBe(true)
    expect(o.entryLine).toBe(true)
    expect(o.volBand).toBe(true)
    expect(o.volume).toBe(true)
    expect(o.stockChipProfile).toBe(true)
    expect(o.replayMarkers).toBe(true)
    expect(o.replayMarkerLabels).toBe(false)
    expect(o.currentDecision).toBe(true)
    expect(o.deltaPane).toBe(false)
    expect(o.equityPane).toBe(false)
    expect(o.kdjPane).toBe(true)
    expect(o.rsiPane).toBe(true)
  })

  it('单字段修改是 reactive，下次取重新返回', () => {
    const o = useChartOverlays()
    o.greeksPane = true
    expect(o.greeksPane).toBe(true)
  })

  it('字段级合并：旧 storage 缺新字段时回退到默认值', () => {
    if (typeof window === 'undefined') return
    // 写入只含部分字段的旧数据
    window.localStorage.setItem(
      'lab.chartOverlays.v9',
      JSON.stringify({ costBand: false, greeksPane: true })
    )
    const o = useChartOverlays()
    expect(o.costBand).toBe(false)        // 旧值保留
    expect(o.greeksPane).toBe(true)        // 旧值保留
    expect(o.entryLine).toBe(true)         // 缺字段回退默认
    expect(o.volume).toBe(true)            // 缺字段回退默认
    expect(o.stockChipProfile).toBe(true)  // 新字段回退默认
  })

  it('从旧 overlay key 迁移，保留用户已打开的数据层', () => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      'lab.chartOverlays.v6',
      JSON.stringify({ greeksPane: true, lpPane: true, kdjPane: true, rsiPane: true })
    )
    const o = useChartOverlays()
    expect(o.greeksPane).toBe(true)
    expect(o.lpPane).toBe(true)
    expect(o.kdjPane).toBe(true)
    expect(o.rsiPane).toBe(true)
    expect(o.stockChipProfile).toBe(true)
  })

  it('从 v8 迁移到 v9 时补齐个股筹码图开关', () => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      'lab.chartOverlays.v8',
      JSON.stringify({ volume: false, lpPane: true })
    )
    const o = useChartOverlays()
    expect(o.volume).toBe(false)
    expect(o.lpPane).toBe(true)
    expect(o.stockChipProfile).toBe(true)
  })
})
