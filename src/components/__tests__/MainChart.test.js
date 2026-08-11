import { mount } from '@vue/test-utils'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import MainChart from '../MainChart.vue'

const mocks = vi.hoisted(() => {
  const mainPriceScaleApply = vi.fn()
  const timeScale = {
    fitContent: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
    width: vi.fn(() => 600),
    coordinateToTime: vi.fn(() => '2026-01-02'),
  }
  const candle = {
    setData: vi.fn(),
    attachPrimitive: vi.fn(),
    detachPrimitive: vi.fn(),
    coordinateToPrice: vi.fn((y) => 200 - y),
    priceToCoordinate: vi.fn((price) => 200 - price),
    priceScale: vi.fn(() => ({ applyOptions: mainPriceScaleApply })),
  }
  const setLineSegments = vi.fn()
  const chart = {
    applyOptions: vi.fn(),
    timeScale: vi.fn(() => timeScale),
    panes: vi.fn(() => [{ getHeight: () => 300 }]),
    subscribeCrosshairMove: vi.fn(),
    unsubscribeCrosshairMove: vi.fn(),
    resize: vi.fn(),
    remove: vi.fn(),
  }
  return {
    timeScale,
    candle,
    chart,
    createChart: vi.fn(() => chart),
    applyOverlays: vi.fn(),
    stockQueue: vi.fn(),
    stockStart: vi.fn(),
    stockStop: vi.fn(),
    stockDispose: vi.fn(),
    crosshairHandler: vi.fn(() => null),
    mainPriceScaleApply,
    setLineSegments,
  }
})

vi.mock('lightweight-charts', () => ({
  ColorType: { Solid: 'solid' },
  PriceScaleMode: { Logarithmic: 1 },
  createChart: mocks.createChart,
}))

vi.mock('../../composables/useMainChartSeries.js', () => ({
  useMainChartSeries: () => ({
    series: {
      candle: mocks.candle,
      deltaUpper: {},
      mark: {},
      equity: {},
      kdjK: {},
      kdjJ: {},
      rsi: {},
    },
    seriesMeta: {},
    applyOverlays: mocks.applyOverlays,
    setLineSegments: mocks.setLineSegments,
    getPaneLayout: () => ({ main: 0 }),
    getMarkersApi: () => null,
  }),
}))

vi.mock('../../composables/useStockChipViewport.js', () => ({
  useStockChipViewport: () => ({
    viewport: { value: null },
    queue: mocks.stockQueue,
    startMonitor: mocks.stockStart,
    stopMonitor: mocks.stockStop,
    dispose: mocks.stockDispose,
  }),
}))

vi.mock('../../composables/useMainChartLegend.js', () => ({
  useMainChartLegend: () => ({
    hoverLegend: { value: null },
    handleCrosshair: mocks.crosshairHandler,
  }),
}))

vi.mock('../../composables/useBreakpoint.js', () => ({
  useBreakpoint: () => ({ isMobile: { value: false } }),
}))

class FakeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
}

const previousResizeObserver = globalThis.ResizeObserver
const previousMutationObserver = globalThis.MutationObserver
globalThis.ResizeObserver = FakeObserver
globalThis.MutationObserver = FakeObserver

afterAll(() => {
  globalThis.ResizeObserver = previousResizeObserver
  globalThis.MutationObserver = previousMutationObserver
})

beforeEach(() => {
  for (const value of Object.values(mocks)) {
    if (typeof value?.mockClear === 'function') value.mockClear()
  }
})

describe('MainChart', () => {
  it('只在数据集合或 scope 改变时 fitContent，并在卸载时解绑图表资源', async () => {
    const rows = makeRows()
    const wrapper = mount(MainChart, {
      props: makeProps(rows),
      global: {
        stubs: {
          ChartDrawingToolbar: true,
          ChartDisplayTools: true,
          ChartStatusBar: true,
          MainChartHoverLegend: true,
          StockChipProfileOverlay: true,
          WorkbenchSummary: true,
        },
      },
    })

    expect(mocks.timeScale.fitContent).toHaveBeenCalledTimes(1)
    expect(mocks.candle.attachPrimitive).toHaveBeenCalledTimes(1)
    expect(mocks.chart.subscribeCrosshairMove).toHaveBeenCalledTimes(1)
    expect(mocks.mainPriceScaleApply).toHaveBeenCalledWith({ mode: 1 })

    await wrapper.setProps({ entryPrice: 101, decision: { state: 'watch' } })
    expect(mocks.timeScale.fitContent).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ overlays: { stockChipProfile: false, volume: false } })
    expect(mocks.timeScale.fitContent).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ drawingScope: 'scope-b' })
    expect(mocks.timeScale.fitContent).toHaveBeenCalledTimes(2)

    await wrapper.setProps({ rows: rows.map((row) => ({ ...row })) })
    expect(mocks.timeScale.fitContent).toHaveBeenCalledTimes(3)

    wrapper.unmount()
    expect(mocks.candle.detachPrimitive).toHaveBeenCalledTimes(1)
    expect(mocks.timeScale.unsubscribeVisibleLogicalRangeChange).toHaveBeenCalledTimes(1)
    expect(mocks.chart.unsubscribeCrosshairMove).toHaveBeenCalledTimes(1)
    expect(mocks.chart.remove).toHaveBeenCalledTimes(1)
  })

  it('把稀疏公式、权益和指标数据按连续有限区间交给 series 管理器', () => {
    const rows = makeManyRows(20)
    const wrapper = mount(MainChart, {
      props: {
        ...makeProps(rows),
        replay: {
          equityCurve: [
            { date: rows[0].date, equity: 100_000 },
            { date: rows[2].date, equity: 100_200 },
          ],
        },
        formulaPath: [
          { date: rows[0].date, deltaUpper: 110 },
          { date: rows[2].date, deltaUpper: 112 },
        ],
      },
      global: {
        stubs: {
          ChartDrawingToolbar: true,
          ChartDisplayTools: true,
          ChartStatusBar: true,
          MainChartHoverLegend: true,
          StockChipProfileOverlay: true,
          WorkbenchSummary: true,
        },
      },
    })

    expect(lastSegments('deltaUpper')).toEqual([
      [{ time: rows[0].date, value: 110 }],
      [{ time: rows[2].date, value: 112 }],
    ])
    expect(lastSegments('equity')).toEqual([
      [{ time: rows[0].date, value: 100_000 }],
      [{ time: rows[2].date, value: 100_200 }],
    ])
    expect(lastSegments('mark')).toEqual([rows.map((row) => ({ time: row.date, value: rows.at(-1).close }))])
    for (const segments of [lastSegments('kdjK'), lastSegments('kdjJ'), lastSegments('rsi')]) {
      expect(segments.length).toBeGreaterThan(0)
      expect(segments.flat().every((point) => point.time && Number.isFinite(point.value))).toBe(true)
    }

    wrapper.unmount()
  })
})

function makeProps(rows) {
  return {
    rows,
    costPath: [],
    formulaPath: [],
    entryPrice: 100,
    replay: { equityCurve: [] },
    drawingScope: 'scope-a',
    overlays: { stockChipProfile: false },
    input: {},
  }
}

function makeRows() {
  return [
    { date: '2026-01-01', open: 99, high: 102, low: 98, close: 101, volume: 1000 },
    { date: '2026-01-02', open: 101, high: 104, low: 100, close: 103, volume: 1200 },
  ]
}

function makeManyRows(count) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index
    return {
      date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      open: close - 1,
      high: close + 1,
      low: close - 2,
      close,
      volume: 1000 + index,
    }
  })
}

function lastSegments(key) {
  return mocks.setLineSegments.mock.calls.filter(([seriesKey]) => seriesKey === key).at(-1)?.[1]
}
