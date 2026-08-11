import { describe, expect, it } from 'vitest'
import { FORMULA_PATH_CURVES } from '../market-data/formulaPath.js'
import {
  MARKET_LAB_CHART_INDICATOR_CATALOG,
  MARKET_LAB_CHART_INDICATOR_GROUPS,
  queryMarketLabChartSeries,
} from '../research-visualization/marketLabChartIndicators.js'

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

const ALL_ON = {
  priceBands: true,
  costBand: true,
  volBand: true,
  lpBand: true,
  entryLine: true,
  executionMarkers: true,
  greeksPane: true,
  lpPane: true,
  carryPane: true,
  equityPane: true,
  kdjPane: true,
  rsiPane: true,
  volume: true,
}

const ALL_OFF = Object.fromEntries(Object.keys(ALL_ON).map((key) => [key, false]))

function fullFormulaPath() {
  return rows.map((row, index) => ({
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
}

function fullQuery(overlays = ALL_ON) {
  return queryMarketLabChartSeries({
    rows,
    formulaPath: fullFormulaPath(),
    costPath: rows.map((row, index) => ({ date: row.date, anchor: 20 + index, upper: 21 + index, lower: 19 + index })),
    overlays,
    entryPrice: 10.2,
    position: { targetPrice: 13, stopPrice: 9 },
    replay: { equityCurve: rows.map((row, index) => ({ date: row.date, equity: 100_000 + index * 100 })) },
  })
}

describe('Market Lab chart indicator catalog', () => {
  it('覆盖 19 条 formula 曲线及执行、权益和 Lab 技术曲线', () => {
    expect(MARKET_LAB_CHART_INDICATOR_GROUPS.map((group) => group.id)).toEqual([
      'price',
      'greeks',
      'lp',
      'carry',
      'equity',
      'kdj',
      'rsi',
    ])
    expect(MARKET_LAB_CHART_INDICATOR_CATALOG).toHaveLength(27)
    expect(new Set(MARKET_LAB_CHART_INDICATOR_CATALOG.map((item) => item.id)).size).toBe(27)
    expect(
      MARKET_LAB_CHART_INDICATOR_CATALOG.filter((item) => item.source === 'formulaPath')
        .map((item) => item.field)
        .sort(),
    ).toEqual(Object.keys(FORMULA_PATH_CURVES).sort())
    expect(MARKET_LAB_CHART_INDICATOR_CATALOG).toContainEqual({
      id: 'rsi',
      label: 'RSI',
      color: '#2e2e2e',
      unit: 'num',
      lineWidth: 3,
      lineStyle: 'solid',
      render: 'line',
      group: 'rsi',
      pane: 'rsi',
      source: 'computedRSI',
      field: 'custom',
      sourceField: 'computedRSI.custom',
    })
  })
})

describe('queryMarketLabChartSeries', () => {
  it('输出 HQ 接线需要的稳定 envelope、分组、series metadata 和计数', () => {
    const model = fullQuery()

    expect(model.dates).toEqual(rows.map((row) => row.date))
    expect(model.groups.map((group) => group.id)).toEqual(['price', 'greeks', 'lp', 'carry', 'equity', 'kdj', 'rsi'])
    expect(model.activeSeriesCount).toBe(27)
    expect(model.availableSeriesCount).toBe(27)
    expect(model.availability).toBe(model.controls)

    const price = model.groups[0]
    expect(price).toMatchObject({
      id: 'price',
      label: '价格层',
      pane: 'main',
      overlayKey: 'priceBands',
      active: true,
      state: 'estimated',
      reason: 'research-estimate',
      activeSeriesCount: 12,
      availableSeriesCount: 12,
    })
    expect(price.series.map((series) => series.id)).toEqual([
      'cost',
      'costUpper',
      'costLower',
      'deltaUpper',
      'deltaLower',
      'lpLower',
      'lpUpper',
      'lpRealPrice',
      'entry',
      'mark',
      'target',
      'stop',
    ])
    expect(price.series.find((series) => series.id === 'cost')).toMatchObject({
      label: '成本锚',
      unit: 'price',
      color: '#0e7558',
      pane: 'main',
      sourceField: 'formulaPath.costAnchor',
      render: 'line',
    })
    expect(price.series.find((series) => series.id === 'mark')).toMatchObject({
      label: '现价',
      pane: 'main',
      sourceField: 'rows.close',
      points: rows.map((row) => ({ time: row.date, value: rows.at(-1).close })),
    })
    expect(model.groups.find((group) => group.id === 'equity')).toMatchObject({
      state: 'ready',
      activeSeriesCount: 1,
    })
    expect(model.groups.find((group) => group.id === 'kdj').series.map((series) => series.id)).toEqual(['kdjK', 'kdjJ'])
    expect(model.groups.find((group) => group.id === 'rsi').series[0].points.length).toBeGreaterThan(0)
  })

  it('关闭可选 overlay 时仍保留独立现价线，其余组保持关闭', () => {
    const model = fullQuery(ALL_OFF)

    expect(model.groups).toHaveLength(7)
    expect(model.availableSeriesCount).toBe(27)
    expect(model.activeSeriesCount).toBe(1)
    expect(model.groups[0]).toMatchObject({ active: true, activeSeriesCount: 1 })
    expect(model.groups[0].series.map((series) => series.id)).toEqual(['mark'])
    for (const group of model.groups.slice(1)) {
      expect(group.active).toBe(false)
      expect(group.reason).toBe('overlay-disabled')
      expect(group.series).toEqual([])
    }
    expect(model.controls.greeksPane).toEqual({
      state: 'estimated',
      reason: 'overlay-disabled',
      missing: [],
      outputCount: 3,
      active: false,
    })
    expect(model.controls.volume).toEqual({
      state: 'ready',
      reason: 'overlay-disabled',
      missing: [],
      outputCount: 1,
      active: false,
    })
  })

  it('controls 区分 ready、estimated、missing-input 和父子开关', () => {
    const model = queryMarketLabChartSeries({
      rows,
      formulaPath: rows.map((row) => ({ date: row.date, costAnchor: 10 })),
      entryPrice: 10.5,
      overlays: {
        priceBands: false,
        costBand: true,
        volBand: true,
        lpBand: true,
        entryLine: true,
        greeksPane: true,
        lpPane: false,
        carryPane: true,
        equityPane: false,
        kdjPane: true,
        rsiPane: true,
        volume: true,
      },
    })

    expect(model.controls.costBand).toMatchObject({
      state: 'estimated',
      reason: 'overlay-disabled',
      active: false,
      outputCount: 1,
    })
    expect(model.controls.lpBand.active).toBe(false)
    expect(model.controls.entryLine).toMatchObject({
      state: 'ready',
      reason: 'finite-output-available',
      active: true,
      outputCount: 1,
    })
    expect(model.controls.executionMarkers).toMatchObject({
      state: 'missing-input',
      reason: 'no-finite-output',
      active: true,
      outputCount: 0,
    })
    expect(model.controls.greeksPane).toMatchObject({
      state: 'missing-input',
      reason: 'no-finite-output',
      active: true,
      outputCount: 0,
    })
    expect(model.controls.greeksPane.missing).toEqual([
      'formulaPath.optionDelta',
      'formulaPath.optionGamma',
      'formulaPath.optionThetaPerSession',
    ])
    expect(model.controls.volume).toMatchObject({ state: 'ready', outputCount: 1, active: true })
  })

  it('跳过 NaN/Infinity/字符串，并保持整条 cost 来源回退语义', () => {
    const formulaPath = rows.map((row, index) => ({
      date: row.date,
      costAnchor: index === 1 ? 20 : index === 2 ? Number.NaN : null,
      deltaUpper: index === 0 ? 11 : index === 1 ? Number.POSITIVE_INFINITY : '12',
      lpNormalizedDelta: index === 0 ? 0 : null,
    }))
    const costPath = rows.map((row, index) => ({ date: row.date, anchor: 10 + index }))
    const model = queryMarketLabChartSeries({ rows, formulaPath, costPath, overlays: ALL_ON })
    const price = model.groups.find((group) => group.id === 'price')

    expect(price.series.find((series) => series.id === 'cost')).toMatchObject({
      sourceField: 'formulaPath.costAnchor',
      points: [{ time: rows[1].date, value: 20 }],
    })
    expect(price.series.find((series) => series.id === 'deltaUpper')).toBeUndefined()
    expect(model.groups.find((group) => group.id === 'lp').series[0].points).toEqual([{ time: rows[0].date, value: 0 }])
  })

  it('当前 GetDelta 合法时保留历史有限点，空白日期交给适配器断线', () => {
    const sampleRows = rows.slice(0, 3)
    const formulaPath = sampleRows.map((row, index) => ({
      date: row.date,
      deltaUpper: index === 1 ? null : 11 + index,
      deltaLower: index === 1 ? null : 9 + index,
    }))
    const model = queryMarketLabChartSeries({ rows: sampleRows, formulaPath, overlays: ALL_ON })
    const price = model.groups.find((group) => group.id === 'price')

    expect(price.series.find((series) => series.id === 'deltaUpper').points).toEqual([
      { time: rows[0].date, value: 11 },
      { time: rows[2].date, value: 13 },
    ])
  })

  it('路径点使用自身观察日，不把错序 path 值套到同索引 K 线日期', () => {
    const sampleRows = rows.slice(0, 3)
    const formulaPath = [
      { date: sampleRows[2].date, costAnchor: 30 },
      { date: sampleRows[0].date, costAnchor: 10 },
    ]
    const model = queryMarketLabChartSeries({ rows: sampleRows, formulaPath, overlays: ALL_ON })
    const cost = model.groups.find((group) => group.id === 'price').series.find((series) => series.id === 'cost')

    expect(cost.points).toEqual([
      { time: sampleRows[2].date, value: 30 },
      { time: sampleRows[0].date, value: 10 },
    ])
  })

  it('路径点没有自身日期时 fail closed，不借用同索引 K 线日期', () => {
    const model = queryMarketLabChartSeries({
      rows: rows.slice(0, 1),
      formulaPath: [{ costAnchor: 99 }],
      overlays: ALL_ON,
    })
    const price = model.groups.find((group) => group.id === 'price')

    expect(price.series.find((series) => series.id === 'cost')).toBeUndefined()
  })

  it('最新 GetDelta 不适用时仍显示历史稀疏段，并把当前状态和历史计数分开', () => {
    const formulaPath = rows.map((row, index) => ({
      date: row.date,
      deltaUpper: index < 2 ? 11 + index : null,
      deltaLower: index < 2 ? 9 + index : null,
      fieldStates: {
        deltaUpper: {
          status: index === rows.length - 1 ? 'not-applicable' : 'implemented',
          missingInputs: [],
          blockedReasons: index === rows.length - 1 ? ['cycle-start-at-or-beyond-anchor'] : [],
        },
      },
    }))
    const model = queryMarketLabChartSeries({ rows, formulaPath, overlays: ALL_ON })
    const price = model.groups.find((group) => group.id === 'price')

    expect(price.series.find((series) => series.id === 'deltaUpper').points).toEqual([
      { time: rows[0].date, value: 11 },
      { time: rows[1].date, value: 12 },
    ])
    expect(model.controls.volBand).toEqual({
      state: 'not-applicable',
      reason: 'current-formula-output-unavailable',
      missing: [],
      blockedReasons: ['cycle-start-at-or-beyond-anchor'],
      outputCount: 2,
      historicalOutputCount: 2,
      active: true,
      current: true,
    })
  })

  it('真实池覆盖只输出最新快照点，公式 cost 全空时回退 costPath', () => {
    const formulaPath = rows.map((row, index) => ({
      date: row.date,
      costAnchor: null,
      lpNormalizedDelta: 0.1,
      lpPoolTurnover24h: 0.2 + index,
      lpPoolTopReserveShare: 0.3 + index,
    }))
    const costPath = rows.map((row, index) => ({ date: row.date, anchor: 10 + index }))
    const model = queryMarketLabChartSeries({ rows, formulaPath, costPath, overlays: ALL_ON })
    const price = model.groups.find((group) => group.id === 'price')
    const lp = model.groups.find((group) => group.id === 'lp')

    expect(price.series.find((series) => series.id === 'cost').sourceField).toBe('costPath.anchor')
    expect(lp.series.find((series) => series.id === 'lpPoolTurnover').points).toEqual([
      { time: rows.at(-1).date, value: 19.2 },
    ])
    expect(lp.series.find((series) => series.id === 'lpPoolConcentration').points).toEqual([
      { time: rows.at(-1).date, value: 19.3 },
    ])
  })

  it('空输入仍返回稳定结构并明确所有缺失项', () => {
    const model = queryMarketLabChartSeries({ rows: null, formulaPath: {}, costPath: 'bad' })

    expect(model).toMatchObject({ dates: [], activeSeriesCount: 0, availableSeriesCount: 0 })
    expect(model.groups).toHaveLength(7)
    for (const group of model.groups) {
      expect(group.state).toBe('missing-input')
      expect(group.reason).toBe('no-finite-output')
      expect(group.series).toEqual([])
    }
    expect(Object.keys(model.controls)).toEqual([
      'priceBands',
      'costBand',
      'volBand',
      'lpBand',
      'entryLine',
      'executionMarkers',
      'greeksPane',
      'lpPane',
      'carryPane',
      'equityPane',
      'kdjPane',
      'rsiPane',
      'volume',
    ])
    expect(model.controls.volume).toEqual({
      state: 'missing-input',
      reason: 'no-finite-output',
      missing: ['rows.volume'],
      outputCount: 0,
      active: true,
    })
  })
})
