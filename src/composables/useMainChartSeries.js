// MainChart 的 series + overlay 管理：
// 把 applyOverlays + ensure/toggle/addLine/addPaneLine/refreshSeriesMeta/
// resetOverlaySeries/rebalancePanes 与共享状态（series, seriesMeta, paneLayout,
// overlayPlan, markersApi）整体搬到 composable。
//
// 之所以拆出来：原本全在 MainChart.vue 里，prettier 把每个嵌套的
// chart.addSeries({...}) 折成多行，整体物理行数膨胀到 700+，触发 check:size 红线。

import { CandlestickSeries, HistogramSeries, LineSeries, LineStyle, createSeriesMarkers } from 'lightweight-charts'
import { SERIES_META } from '../components/mainChartLegendMeta.js'
import { resolveChartOverlayPlan } from '../domain/research-visualization/chartPaneLayout.js'

export function useMainChartSeries({ getChart, getProps }) {
  const series = {}
  const seriesMeta = {}
  let paneLayout = { main: 0 }
  let overlayPlan = null
  let paneLayoutSignature = ''
  let markersApi = null

  function applyOverlays() {
    const chart = getChart()
    if (!chart) return
    const props = getProps()
    overlayPlan = resolveChartOverlayPlan({ overlays: props.overlays, formulaPath: props.formulaPath })
    const nextLayout = overlayPlan.panes
    const nextSignature = JSON.stringify(nextLayout)
    if (nextSignature !== paneLayoutSignature) {
      resetOverlaySeries()
      paneLayoutSignature = nextSignature
    }
    paneLayout = nextLayout

    // 蜡烛 + 量始终存在；其它项用 visibility 控制
    ensure('candle', () => chart.addSeries(CandlestickSeries, candleOptions()))
    toggle('cost', overlayPlan.price.costBand, () => addLine('成本锚', '#0e7558', 2))
    toggle('costUpper', overlayPlan.price.costBand, () => addLine('成本上沿', '#8b5a16', 1, LineStyle.Dashed))
    toggle('costLower', overlayPlan.price.costBand, () => addLine('成本下沿', '#274f9f', 1, LineStyle.Dashed))
    toggle('deltaUpper', overlayPlan.price.deltaBand, () => addLine('GetDelta 上沿', '#9a4f00', 1, LineStyle.Dotted))
    toggle('deltaLower', overlayPlan.price.deltaBand, () => addLine('GetDelta 下沿', '#1f5fbf', 1, LineStyle.Dotted))
    toggle('lpLower', overlayPlan.price.lpBand, () => addLine('LP区间下沿', '#7a5cff', 1, LineStyle.Dashed))
    toggle('lpUpper', overlayPlan.price.lpBand, () => addLine('LP区间上沿', '#7a5cff', 1, LineStyle.Dashed))
    toggle('lpRealPrice', overlayPlan.price.lpRealPrice, () => addLine('链上池价', '#8b5a16', 2, LineStyle.Dotted))
    toggle('entry', overlayPlan.price.entryLine, () => addLine('入场', '#b3261e', 1, LineStyle.Dotted))

    toggle('volume', overlayPlan.paneOn.volume, () =>
      chart.addSeries(HistogramSeries, volumeOptions(), paneLayout.volume),
    )
    toggle('regime', overlayPlan.paneOn.volume, () =>
      chart.addSeries(HistogramSeries, regimeOptions(), paneLayout.volume),
    )

    toggle('bsDelta', overlayPlan.paneOn.greeks, () =>
      addPaneLine('期权 Delta', '#a93226', paneLayout.greeks, { priceScaleId: 'greeks-delta' }),
    )
    toggle('bsGamma', overlayPlan.paneOn.greeks, () =>
      addPaneLine('期权 Gamma', '#8b5a16', paneLayout.greeks, { priceScaleId: 'greeks-gamma' }),
    )
    toggle('bsTheta', overlayPlan.paneOn.greeks, () =>
      addPaneLine('期权 Theta/日', '#274f9f', paneLayout.greeks, { priceScaleId: 'greeks-theta' }),
    )
    toggle('greeksZero', overlayPlan.paneOn.greeks, () =>
      addPaneLine('0', '#888', paneLayout.greeks, {
        priceScaleId: 'greeks-delta',
        lineStyle: LineStyle.Dashed,
        lastValueVisible: false,
      }),
    )

    toggle('lpDelta', overlayPlan.paneOn.lp, () =>
      addPaneLine('LP库存暴露', '#0e7558', paneLayout.lp, { priceScaleId: 'lp-ratio' }),
    )
    toggle('lpValue', overlayPlan.paneOn.lp, () =>
      addPaneLine('LP库存价值', '#7a5cff', paneLayout.lp, { priceScaleId: 'lp-quote' }),
    )
    toggle('lpRealDiv', overlayPlan.paneOn.lp, () =>
      addPaneLine('链上池价偏离', '#8b5a16', paneLayout.lp, { priceScaleId: 'lp-ratio' }),
    )
    toggle('lpPoolTurnover', overlayPlan.paneOn.lpPoolCoverage, () =>
      addPaneLine('真实池24h换手', '#b3261e', paneLayout.lp, { priceScaleId: 'lp-ratio', lineStyle: LineStyle.Dotted }),
    )
    toggle('lpPoolConcentration', overlayPlan.paneOn.lpPoolCoverage, () =>
      addPaneLine('主池资金占比', '#274f9f', paneLayout.lp, { priceScaleId: 'lp-ratio', lineStyle: LineStyle.Dotted }),
    )
    toggle('lpCe', overlayPlan.paneOn.lp, () =>
      addPaneLine('资本效率', '#8b5a16', paneLayout.lp, { priceScaleId: 'lp-multiple' }),
    )
    toggle('lpZero', overlayPlan.paneOn.lp, () =>
      addPaneLine('LP暴露零线', '#888', paneLayout.lp, {
        priceScaleId: 'lp-ratio',
        lineStyle: LineStyle.Dashed,
        lastValueVisible: false,
      }),
    )

    toggle('fundingProxy', overlayPlan.paneOn.carry, () =>
      addPaneLine('Funding估算', '#a93226', paneLayout.carry, { priceScaleId: 'carry-return' }),
    )
    toggle('netCarry', overlayPlan.paneOn.carry, () =>
      addPaneLine('净持有收益', '#0e7558', paneLayout.carry, { priceScaleId: 'carry-return' }),
    )
    toggle('carryZero', overlayPlan.paneOn.carry, () =>
      addPaneLine('持有收益零线', '#888', paneLayout.carry, {
        priceScaleId: 'carry-return',
        lineStyle: LineStyle.Dashed,
        lastValueVisible: false,
      }),
    )

    toggle('equity', overlayPlan.paneOn.equity, () => chart.addSeries(LineSeries, equityOptions(), paneLayout.equity))
    toggle('equityZero', overlayPlan.paneOn.equity, () =>
      chart.addSeries(LineSeries, equityZeroOptions(), paneLayout.equity),
    )

    toggle('kdjK', overlayPlan.paneOn.kdj, () => chart.addSeries(LineSeries, kdjKOptions(), paneLayout.kdj))
    toggle('kdjJ', overlayPlan.paneOn.kdj, () => chart.addSeries(LineSeries, kdjJOptions(), paneLayout.kdj))
    if (series.kdjJ && !series.kdjJ.__hlinesInstalled) {
      series.kdjJ.__hlinesInstalled = true
      series.kdjJ.createPriceLine({
        price: 100,
        color: 'rgba(255,0,0,0.3)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
      })
      series.kdjJ.createPriceLine({
        price: 0,
        color: 'rgba(0,167,6,0.3)',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
      })
    }
    toggle('rsi', overlayPlan.paneOn.rsi, () => chart.addSeries(LineSeries, rsiOptions(), paneLayout.rsi))
    if (series.rsi && !series.rsi.__hlinesInstalled) {
      series.rsi.__hlinesInstalled = true
      series.rsi.createPriceLine({
        price: 100,
        color: 'rgba(120,123,134,0.5)',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: false,
      })
      series.rsi.createPriceLine({
        price: 50,
        color: 'rgba(0,0,0,0.7)',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: false,
      })
      series.rsi.createPriceLine({
        price: 0,
        color: 'rgba(120,123,134,0.5)',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: false,
      })
    }

    if (!markersApi) markersApi = createSeriesMarkers(series.candle, [])
    rebalancePanes()
    refreshSeriesMeta()
  }

  function ensure(key, factory) {
    if (!series[key]) series[key] = factory()
  }

  function toggle(key, on, factory) {
    const chart = getChart()
    if (on && !series[key]) {
      series[key] = factory()
    } else if (!on && series[key]) {
      chart?.removeSeries(series[key])
      delete series[key]
      delete seriesMeta[key]
    }
  }

  function addLine(title, color, width, style = LineStyle.Solid) {
    return getChart().addSeries(LineSeries, {
      title,
      color,
      lineWidth: width,
      lineStyle: style,
      priceLineVisible: false,
      lastValueVisible: true,
    })
  }

  function addPaneLine(title, color, paneIndex, options = {}) {
    const line = getChart().addSeries(LineSeries, deltaLine(title, color, options), paneIndex)
    line.priceScale().applyOptions({ scaleMargins: { top: 0.18, bottom: 0.18 }, alignLabels: true })
    return line
  }

  function refreshSeriesMeta() {
    for (const key of Object.keys(series)) {
      if (key === 'candle' || key === 'volume' || key === 'regime') continue
      if (key.endsWith('Zero')) continue
      if (SERIES_META[key]) seriesMeta[key] = SERIES_META[key]
    }
    for (const key of Object.keys(seriesMeta)) {
      if (!series[key]) delete seriesMeta[key]
    }
  }

  function resetOverlaySeries() {
    const chart = getChart()
    if (!chart) return
    for (const key of Object.keys(series)) {
      if (key === 'candle') continue
      chart.removeSeries(series[key])
      delete series[key]
    }
  }

  function rebalancePanes() {
    const panes = getChart().panes()
    if (!panes.length) return
    for (let i = 1; i < panes.length; i += 1) panes[i]?.setStretchFactor(0)
    panes[paneLayout.main]?.setStretchFactor(0.54)
    if (paneLayout.volume !== undefined) panes[paneLayout.volume]?.setStretchFactor(0.12)
    if (paneLayout.greeks !== undefined) panes[paneLayout.greeks]?.setStretchFactor(0.12)
    if (paneLayout.lp !== undefined) panes[paneLayout.lp]?.setStretchFactor(0.12)
    if (paneLayout.carry !== undefined) panes[paneLayout.carry]?.setStretchFactor(0.1)
    if (paneLayout.equity !== undefined) panes[paneLayout.equity]?.setStretchFactor(0.06)
    if (paneLayout.kdj !== undefined) panes[paneLayout.kdj]?.setStretchFactor(0.13)
    if (paneLayout.rsi !== undefined) panes[paneLayout.rsi]?.setStretchFactor(0.13)
  }

  return {
    series,
    seriesMeta,
    applyOverlays,
    getPaneLayout: () => paneLayout,
    getMarkersApi: () => markersApi,
  }
}

// ── series option factories（独立小函数，每个对象字面量很小 prettier 不展开） ─

function candleOptions() {
  return {
    upColor: '#0e7558',
    downColor: '#a93226',
    borderVisible: false,
    wickUpColor: '#0e7558',
    wickDownColor: '#a93226',
    priceLineVisible: false,
  }
}

function volumeOptions() {
  return {
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    color: '#b7c1d8',
    priceLineVisible: false,
    lastValueVisible: true,
  }
}

function regimeOptions() {
  return {
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    priceLineVisible: false,
    lastValueVisible: false,
  }
}

function equityOptions() {
  return {
    title: '回放权益',
    color: '#1f5fbf',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
    priceFormat: { type: 'price', precision: 0, minMove: 1 },
  }
}

function equityZeroOptions() {
  return {
    title: '盈亏=0',
    color: '#888',
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    priceLineVisible: false,
    lastValueVisible: false,
  }
}

function kdjKOptions() {
  return {
    title: 'K/D均线',
    color: 'rgba(255, 165, 0, 0.5)',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
  }
}

function kdjJOptions() {
  return {
    title: 'J线',
    color: '#4e4e4e',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
  }
}

function rsiOptions() {
  return {
    title: 'RSI相对强弱',
    color: '#2e2e2e',
    lineWidth: 3,
    priceLineVisible: false,
    lastValueVisible: false,
  }
}

function deltaLine(title, color, options = {}) {
  return {
    title,
    color,
    lineWidth: options.lineWidth ?? 1,
    lineStyle: options.lineStyle ?? LineStyle.Solid,
    priceScaleId: options.priceScaleId,
    priceLineVisible: false,
    lastValueVisible: options.lastValueVisible ?? true,
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  }
}
