import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMainChartSeries } from '../useMainChartSeries.js'

const light = vi.hoisted(() => ({
  CandlestickSeries: Symbol('CandlestickSeries'),
  HistogramSeries: Symbol('HistogramSeries'),
  LineSeries: Symbol('LineSeries'),
  createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn() })),
}))

vi.mock('lightweight-charts', () => ({
  ...light,
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
}))

describe('useMainChartSeries sparse line lifecycle', () => {
  let chart
  let props

  beforeEach(() => {
    light.createSeriesMarkers.mockClear()
    chart = fakeChart()
    props = {
      formulaPath: [],
      overlays: {
        priceBands: true,
        costBand: true,
        volBand: false,
        lpBand: false,
        entryLine: false,
        executionMarkers: false,
        volume: false,
        greeksPane: false,
        lpPane: false,
        carryPane: false,
        equityPane: false,
        kdjPane: false,
        rsiPane: false,
      },
    }
  })

  it('把最后一段留给语义主 series，并用无图例辅助 series 绘制较早分段', () => {
    const api = createApi(chart, () => props)
    api.applyOverlays()
    const main = api.series.cost
    const segments = [
      [{ time: '2026-08-01', value: 90 }],
      [{ time: '2026-08-03', value: 92 }],
      [{ time: '2026-08-05', value: 94 }],
    ]

    api.setLineSegments('cost', segments)

    expect(main.setData).toHaveBeenLastCalledWith(segments[2])
    const auxiliaries = chart.created.filter((line) => line.options.title === '' && line.options.color === '#0e7558')
    expect(auxiliaries).toHaveLength(2)
    expect(auxiliaries.map((line) => line.setData.mock.calls.at(-1)[0])).toEqual(segments.slice(0, 2))
    expect(auxiliaries[0].options).toMatchObject({
      title: '',
      lastValueVisible: false,
      priceLineVisible: false,
    })
    expect(main.applyOptions).toHaveBeenLastCalledWith({ pointMarkersVisible: true })
    expect(auxiliaries[0].applyOptions).toHaveBeenLastCalledWith({ pointMarkersVisible: true })
    expect(auxiliaries[1].applyOptions).toHaveBeenLastCalledWith({ pointMarkersVisible: true })
    expect(Object.keys(api.series)).not.toContain(expect.stringContaining('aux'))
    expect(api.seriesMeta.cost).toBeDefined()
  })

  it('合法孤立点显示 marker，连续段关闭 marker，复用辅助 series 时同步刷新', () => {
    const api = createApi(chart, () => props)
    api.applyOverlays()
    const main = api.series.cost
    const single = [{ time: '2026-08-01', value: 90 }]
    const pairA = [
      { time: '2026-08-03', value: 92 },
      { time: '2026-08-04', value: 93 },
    ]
    const pairB = [
      { time: '2026-08-06', value: 95 },
      { time: '2026-08-07', value: 96 },
    ]

    api.setLineSegments('cost', [single, pairA, single])
    const auxiliaries = chart.created.filter((line) => line.options.title === '' && line.options.color === '#0e7558')
    expect(main.applyOptions).toHaveBeenLastCalledWith({ pointMarkersVisible: true })
    expect(auxiliaries[0].applyOptions).toHaveBeenLastCalledWith({ pointMarkersVisible: true })
    expect(auxiliaries[1].applyOptions).toHaveBeenLastCalledWith({ pointMarkersVisible: false })

    api.setLineSegments('cost', [pairA, pairB])
    expect(main.applyOptions).toHaveBeenLastCalledWith({ pointMarkersVisible: false })
    expect(auxiliaries[0].applyOptions).toHaveBeenLastCalledWith({ pointMarkersVisible: false })
    expect(chart.removeSeries).toHaveBeenCalledWith(auxiliaries[1])
  })

  it('缩短分段、重建 pane 和关闭 overlay 时回收全部辅助 series', () => {
    const api = createApi(chart, () => props)
    api.applyOverlays()
    const main = api.series.cost
    const segments = [
      [{ time: '2026-08-01', value: 90 }],
      [{ time: '2026-08-03', value: 92 }],
      [{ time: '2026-08-05', value: 94 }],
    ]
    api.setLineSegments('cost', segments)
    const auxiliaries = chart.created.filter((line) => line.options.title === '' && line.options.color === '#0e7558')

    api.setLineSegments('cost', [segments[2]])
    expect(chart.removeSeries).toHaveBeenCalledWith(auxiliaries[0])
    expect(chart.removeSeries).toHaveBeenCalledWith(auxiliaries[1])

    api.setLineSegments('cost', segments.slice(0, 2))
    const recreated = chart.created.at(-1)
    props = { ...props, overlays: { ...props.overlays, volume: true } }
    api.applyOverlays()
    expect(chart.removeSeries).toHaveBeenCalledWith(recreated)
    expect(chart.removeSeries).toHaveBeenCalledWith(main)

    const resetMain = api.series.cost
    api.setLineSegments('cost', segments.slice(0, 2))
    const resetAuxiliary = chart.created.at(-1)
    props = { ...props, overlays: { ...props.overlays, costBand: false } }
    api.applyOverlays()
    expect(chart.removeSeries).toHaveBeenCalledWith(resetAuxiliary)
    expect(chart.removeSeries).toHaveBeenCalledWith(resetMain)
    expect(api.series.cost).toBeUndefined()
  })

  it('辅助 pane line 继承 pane、priceScaleId 与刻度配置', () => {
    props = {
      formulaPath: [{ optionDelta: 0.5 }],
      overlays: { ...props.overlays, costBand: false, greeksPane: true },
    }
    const api = createApi(chart, () => props)
    api.applyOverlays()
    api.setLineSegments('bsDelta', [[{ time: '2026-08-01', value: 0.4 }], [{ time: '2026-08-03', value: 0.5 }]])
    const auxiliary = chart.created.at(-1)

    expect(auxiliary.paneIndex).toBe(1)
    expect(auxiliary.options).toMatchObject({ title: '', priceScaleId: 'greeks-delta', lastValueVisible: false })
    expect(auxiliary.priceScaleApply).toHaveBeenCalledWith({
      scaleMargins: { top: 0.18, bottom: 0.18 },
      alignLabels: true,
    })
  })
})

function createApi(chart, getProps) {
  return useMainChartSeries({ getChart: () => chart, getProps })
}

function fakeChart() {
  const created = []
  return {
    created,
    addSeries: vi.fn((type, options, paneIndex) => {
      const priceScaleApply = vi.fn()
      const line = {
        type,
        options,
        paneIndex,
        priceScaleApply,
        applyOptions: vi.fn(),
        setData: vi.fn(),
        createPriceLine: vi.fn(),
        priceScale: vi.fn(() => ({ applyOptions: priceScaleApply })),
      }
      created.push(line)
      return line
    }),
    removeSeries: vi.fn(),
    panes: vi.fn(() => [{ setStretchFactor: vi.fn() }, { setStretchFactor: vi.fn() }]),
  }
}
