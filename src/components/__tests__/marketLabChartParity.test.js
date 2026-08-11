import { describe, expect, it, vi } from 'vitest'
import { fallbackValue, latestFinitePathPoint, SERIES_META } from '../mainChartLegendMeta.js'
import { useMainChartSeries } from '../../composables/useMainChartSeries.js'
import {
  MARKET_LAB_CHART_INDICATOR_CATALOG,
  queryMarketLabChartSeries,
} from '../../domain/research-visualization/marketLabChartIndicators.js'
import {
  buildHqResearchChartConfig,
  hqResearchApiId,
  toHqColor,
  toHqResearchIndexResponse,
} from '../../infrastructure/charting/hqChartResearchAdapter.js'

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'candlestick',
  HistogramSeries: 'histogram',
  LineSeries: 'line',
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 },
  createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn() })),
}))

const ALL_ON = {
  priceBands: true,
  costBand: true,
  volBand: true,
  lpBand: true,
  entryLine: true,
  executionMarkers: true,
  replayMarkers: true,
  replayMarkerLabels: true,
  currentDecision: true,
  researchMarkers: true,
  greeksPane: true,
  lpPane: true,
  carryPane: true,
  equityPane: true,
  kdjPane: true,
  rsiPane: true,
  volume: true,
}

const rows = Array.from({ length: 20 }, (_, index) => {
  const close = 10 + index * 0.1
  return {
    date: `2026-08-${String(index + 1).padStart(2, '0')}`,
    open: close - 0.05,
    high: close + 0.2,
    low: close - 0.2,
    close,
    volume: 100 + index,
  }
})

const formulaPath = rows.map((row, index) => ({
  date: row.date,
  costAnchor: 10 + index,
  costUpper: 11 + index,
  costLower: 9 + index,
  deltaUpper: 12 + index,
  deltaLower: 8 + index,
  lpLowerPrice: 7 + index,
  lpUpperPrice: 13 + index,
  lpRealPrice: 10.5 + index,
  optionDelta: 0.4 + index / 100,
  optionGamma: 0.03 + index / 1000,
  optionThetaPerSession: -0.02 - index / 1000,
  lpNormalizedDelta: -0.2 + index / 100,
  lpValue: 1000 + index,
  lpRealDivergence: 0.01 + index / 1000,
  lpPoolTurnover24h: 0.2 + index / 100,
  lpPoolTopReserveShare: 0.3 + index / 100,
  capitalEfficiency: 2 + index / 100,
  cumulativeFundingProxy: 0.001 + index / 10000,
  netCarry: 0.002 + index / 10000,
}))

const fixture = {
  rows,
  formulaPath,
  costPath: [],
  overlays: ALL_ON,
  entryPrice: 10.2,
  position: { targetPrice: 13, stopPrice: 9 },
  replay: { equityCurve: rows.map((row, index) => ({ date: row.date, equity: 100_000 + index * 100 })) },
}

describe('Market Lab Light / HQ chart parity', () => {
  it('Light series inventory and legend metadata share the domain catalog contract', () => {
    const chart = fakeChart()
    const light = useMainChartSeries({ getChart: () => chart, getProps: () => fixture })
    light.applyOverlays()

    const catalogIds = MARKET_LAB_CHART_INDICATOR_CATALOG.map((item) => item.id).sort()
    expect(Object.keys(light.seriesMeta).sort()).toEqual(catalogIds)

    for (const definition of MARKET_LAB_CHART_INDICATOR_CATALOG) {
      const meta = SERIES_META[definition.id]
      expect(meta).toMatchObject({
        title: definition.label,
        color: definition.color,
        unit: definition.unit,
        group: definition.group,
      })
      expect(light.series[definition.id].options).toMatchObject({
        title: definition.label,
        color: definition.color,
        lineWidth: definition.lineWidth,
        lineStyle: lightLineStyle(definition.lineStyle),
      })
    }
  })

  it('Light hover fallback and the domain envelope read identical formula/constant values', () => {
    const model = queryMarketLabChartSeries(fixture)
    const comparableIds = MARKET_LAB_CHART_INDICATOR_CATALOG.map((item) => item.id).filter(
      (id) => !['equity', 'kdjK', 'kdjJ', 'rsi'].includes(id),
    )

    for (const id of comparableIds) {
      const series = findSeries(model, id)
      const byTime = new Map(series.points.map((point) => [point.time, point.value]))
      rows.forEach((row, index) => {
        const lightValue = fallbackValue(id, index, fixture)
        expect(Number.isFinite(lightValue) ? lightValue : null, `${id}@${row.date}`).toBe(byTime.get(row.date) ?? null)
      })
    }
  })

  it('现价、入场、成本、GetDelta 与 LP 区间始终共用主 K 线价格轴', () => {
    const model = queryMarketLabChartSeries(fixture)
    const chart = fakeChart()
    const light = useMainChartSeries({ getChart: () => chart, getProps: () => fixture })
    light.applyOverlays()
    const required = [
      'mark',
      'entry',
      'cost',
      'costUpper',
      'costLower',
      'deltaUpper',
      'deltaLower',
      'lpUpper',
      'lpLower',
    ]

    expect(model.groups.find((group) => group.id === 'price').series.map((series) => series.id)).toEqual(
      expect.arrayContaining(required),
    )
    for (const id of required) {
      expect(light.series[id].pane).toBe(0)
      expect(light.series[id].options.priceScaleId).toBeUndefined()
    }
    expect(buildHqResearchChartConfig(model).overlayIndex[0]).toMatchObject({ Windows: 0, IsShareY: true })
  })

  it('latest-only pool snapshots stay anchored to the active formula observation date', () => {
    const activeLength = 10
    const activeFixture = { ...fixture, formulaPath: formulaPath.slice(0, activeLength) }
    const model = queryMarketLabChartSeries(activeFixture)
    const turnover = findSeries(model, 'lpPoolTurnover')
    const concentration = findSeries(model, 'lpPoolConcentration')

    expect(turnover.points).toEqual([
      { time: rows[activeLength - 1].date, value: formulaPath[activeLength - 1].lpPoolTurnover24h },
    ])
    expect(concentration.points).toEqual([
      { time: rows[activeLength - 1].date, value: formulaPath[activeLength - 1].lpPoolTopReserveShare },
    ])
    expect(latestFinitePathPoint(rows, activeFixture.formulaPath, 'lpPoolTurnover24h')).toEqual(turnover.points[0])
    expect(fallbackValue('lpPoolTurnover', activeLength - 1, activeFixture)).toBe(
      formulaPath[activeLength - 1].lpPoolTurnover24h,
    )
    expect(fallbackValue('lpPoolTurnover', rows.length - 1, activeFixture)).toBeNull()
  })

  it('HQ responses preserve every active domain series name, color, render mode and aligned values', () => {
    const model = queryMarketLabChartSeries(fixture)
    const config = buildHqResearchChartConfig(model)
    const price = model.groups.find((group) => group.id === 'price')
    const hqGroups = [price, ...config.paneGroups.flat()]

    for (const group of hqGroups) {
      const response = toHqResearchIndexResponse(model, hqResearchApiId(group.id), {})
      expect(response.code, group.id).toBe(0)
      expect(response.outdata.name).toBe(`Lab · ${group.label}`)
      expect(response.outdata.date).toEqual(model.dates.map(compactDate))
      expect(response.outdata.outvar).toEqual(group.series.map((series) => expectedHqOutVar(series, model.dates)))
    }
  })
})

function fakeChart() {
  const panes = Array.from({ length: 8 }, () => ({ setStretchFactor: vi.fn() }))
  return {
    addSeries: vi.fn((type, options, pane = 0) => ({
      type,
      options,
      pane,
      createPriceLine: vi.fn(),
      priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    })),
    removeSeries: vi.fn(),
    panes: vi.fn(() => panes),
  }
}

function findSeries(model, id) {
  return model.groups.flatMap((group) => group.series).find((series) => series.id === id)
}

function compactDate(value) {
  return Number(String(value).replaceAll('-', ''))
}

function lightLineStyle(value) {
  if (value === 'dashed') return 2
  if (value === 'dotted') return 1
  return 0
}

function expectedHqOutVar(series, dates) {
  return {
    name: series.label,
    type: series.render === 'point' ? 3 : 0,
    data: alignedValues(series, dates),
    color: toHqColor(series.color),
    linewidth: `LINETHICK${series.lineWidth ?? (series.render === 'point' ? 2 : 1)}`,
    isDotLine: series.lineStyle === 'dotted',
    IsShowTitle: false,
    ...(series.lineStyle === 'dashed' ? { lineDash: [5, 4] } : {}),
  }
}

function alignedValues(series, dates) {
  const byTime = new Map(series.points.map((point) => [point.time, point.value]))
  return dates.map((date) => byTime.get(date) ?? null)
}
