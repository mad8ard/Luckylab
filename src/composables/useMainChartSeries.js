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
import { getMarketLabSeriesStyle } from '../domain/research-visualization/marketLabSeriesStyles.js'

export function useMainChartSeries({ getChart, getProps }) {
  const series = {}
  const seriesMeta = {}
  let paneLayout = { main: 0 }
  let overlayPlan = null
  let paneLayoutSignature = ''
  let markersApi = null
  const lineDescriptors = {}
  const auxiliarySeries = {}

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
    toggle('cost', overlayPlan.price.costBand, () => addLine('cost'))
    toggle('costUpper', overlayPlan.price.costBand, () => addLine('costUpper'))
    toggle('costLower', overlayPlan.price.costBand, () => addLine('costLower'))
    toggle('deltaUpper', overlayPlan.price.deltaBand, () => addLine('deltaUpper'))
    toggle('deltaLower', overlayPlan.price.deltaBand, () => addLine('deltaLower'))
    toggle('lpLower', overlayPlan.price.lpBand, () => addLine('lpLower'))
    toggle('lpUpper', overlayPlan.price.lpBand, () => addLine('lpUpper'))
    toggle('lpRealPrice', overlayPlan.price.lpRealPrice, () => addLine('lpRealPrice'))
    toggle('entry', overlayPlan.price.entryLine, () => addLine('entry'))
    toggle('mark', overlayPlan.price.currentLine, () => addLine('mark'))
    toggle('target', overlayPlan.markers.execution && Number.isFinite(props.position?.targetPrice), () =>
      addLine('target'),
    )
    toggle('stop', overlayPlan.markers.execution && Number.isFinite(props.position?.stopPrice), () => addLine('stop'))

    toggle('volume', overlayPlan.paneOn.volume, () =>
      chart.addSeries(HistogramSeries, volumeOptions(), paneLayout.volume),
    )
    toggle('regime', overlayPlan.paneOn.volume, () =>
      chart.addSeries(HistogramSeries, regimeOptions(), paneLayout.volume),
    )

    toggle('bsDelta', overlayPlan.paneOn.greeks, () =>
      addPaneLine('bsDelta', paneLayout.greeks, { priceScaleId: 'greeks-delta' }),
    )
    toggle('bsGamma', overlayPlan.paneOn.greeks, () =>
      addPaneLine('bsGamma', paneLayout.greeks, { priceScaleId: 'greeks-gamma' }),
    )
    toggle('bsTheta', overlayPlan.paneOn.greeks, () =>
      addPaneLine('bsTheta', paneLayout.greeks, { priceScaleId: 'greeks-theta' }),
    )
    toggle('greeksZero', overlayPlan.paneOn.greeks, () =>
      addGuideLine('greeksZero', '0', '#888', paneLayout.greeks, {
        priceScaleId: 'greeks-delta',
        lineStyle: LineStyle.Dashed,
        lastValueVisible: false,
      }),
    )

    toggle('lpDelta', overlayPlan.paneOn.lp, () => addPaneLine('lpDelta', paneLayout.lp, { priceScaleId: 'lp-ratio' }))
    toggle('lpValue', overlayPlan.paneOn.lp, () => addPaneLine('lpValue', paneLayout.lp, { priceScaleId: 'lp-quote' }))
    toggle('lpRealDiv', overlayPlan.paneOn.lp, () =>
      addPaneLine('lpRealDiv', paneLayout.lp, { priceScaleId: 'lp-ratio' }),
    )
    toggle('lpPoolTurnover', overlayPlan.paneOn.lpPoolCoverage, () =>
      addPaneLine('lpPoolTurnover', paneLayout.lp, { priceScaleId: 'lp-ratio' }),
    )
    toggle('lpPoolConcentration', overlayPlan.paneOn.lpPoolCoverage, () =>
      addPaneLine('lpPoolConcentration', paneLayout.lp, { priceScaleId: 'lp-ratio' }),
    )
    toggle('lpCe', overlayPlan.paneOn.lp, () => addPaneLine('lpCe', paneLayout.lp, { priceScaleId: 'lp-multiple' }))
    toggle('lpZero', overlayPlan.paneOn.lp, () =>
      addGuideLine('lpZero', 'LP暴露零线', '#888', paneLayout.lp, {
        priceScaleId: 'lp-ratio',
        lineStyle: LineStyle.Dashed,
        lastValueVisible: false,
      }),
    )

    toggle('cumulativeFundingProxy', overlayPlan.paneOn.carry, () =>
      addPaneLine('cumulativeFundingProxy', paneLayout.carry, { priceScaleId: 'carry-return' }),
    )
    toggle('netCarry', overlayPlan.paneOn.carry, () =>
      addPaneLine('netCarry', paneLayout.carry, { priceScaleId: 'carry-return' }),
    )
    toggle('carryZero', overlayPlan.paneOn.carry, () =>
      addGuideLine('carryZero', '归因零线', '#888', paneLayout.carry, {
        priceScaleId: 'carry-return',
        lineStyle: LineStyle.Dashed,
        lastValueVisible: false,
      }),
    )

    toggle('equity', overlayPlan.paneOn.equity, () => createLineSeries('equity', equityOptions(), paneLayout.equity))
    toggle('equityZero', overlayPlan.paneOn.equity, () =>
      createLineSeries('equityZero', equityZeroOptions(), paneLayout.equity),
    )

    toggle('kdjK', overlayPlan.paneOn.kdj, () => createLineSeries('kdjK', kdjKOptions(), paneLayout.kdj))
    toggle('kdjJ', overlayPlan.paneOn.kdj, () => createLineSeries('kdjJ', kdjJOptions(), paneLayout.kdj))
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
    toggle('rsi', overlayPlan.paneOn.rsi, () => createLineSeries('rsi', rsiOptions(), paneLayout.rsi))
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
    } else if (!on) {
      clearAuxiliarySeries(key)
      if (series[key]) {
        chart?.removeSeries(series[key])
        delete series[key]
        delete seriesMeta[key]
      }
      delete lineDescriptors[key]
    }
  }

  function addLine(key) {
    const style = requiredSeriesStyle(key)
    return createLineSeries(key, {
      title: style.label,
      color: style.color,
      lineWidth: style.lineWidth,
      lineStyle: toLightLineStyle(style.lineStyle),
      priceLineVisible: false,
      lastValueVisible: true,
    })
  }

  function addPaneLine(key, paneIndex, options = {}) {
    return createLineSeries(key, deltaLine(key, options), paneIndex, configurePaneLine)
  }

  function addGuideLine(key, title, color, paneIndex, options = {}) {
    return createLineSeries(
      key,
      {
        title,
        color,
        lineWidth: options.lineWidth ?? 1,
        lineStyle: options.lineStyle ?? LineStyle.Solid,
        priceScaleId: options.priceScaleId,
        priceLineVisible: false,
        lastValueVisible: options.lastValueVisible ?? false,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      },
      paneIndex,
      configurePaneLine,
    )
  }

  function createLineSeries(key, options, paneIndex, configure) {
    const descriptor = { options, paneIndex, configure }
    lineDescriptors[key] = descriptor
    return addConfiguredLine(descriptor, options)
  }

  function addConfiguredLine(descriptor, options) {
    const chart = getChart()
    const line =
      descriptor.paneIndex === undefined
        ? chart.addSeries(LineSeries, options)
        : chart.addSeries(LineSeries, options, descriptor.paneIndex)
    descriptor.configure?.(line)
    return line
  }

  function setLineSegments(key, segments) {
    const main = series[key]
    if (!main) return
    const validSegments = (Array.isArray(segments) ? segments : []).filter(
      (segment) => Array.isArray(segment) && segment.length,
    )
    const descriptor = lineDescriptors[key]
    const mainSegment = validSegments.at(-1) ?? []
    main.setData(mainSegment)
    applySegmentPointMarker(main, mainSegment)
    if (!descriptor) return

    const auxiliaries = auxiliarySeries[key] ?? (auxiliarySeries[key] = [])
    const requiredCount = Math.max(0, validSegments.length - 1)
    while (auxiliaries.length < requiredCount) {
      auxiliaries.push(
        addConfiguredLine(descriptor, {
          ...descriptor.options,
          title: '',
          lastValueVisible: false,
          priceLineVisible: false,
        }),
      )
    }
    while (auxiliaries.length > requiredCount) getChart()?.removeSeries(auxiliaries.pop())
    auxiliaries.forEach((line, index) => {
      const segment = validSegments[index]
      line.setData(segment)
      applySegmentPointMarker(line, segment)
    })
  }

  function applySegmentPointMarker(line, segment) {
    line.applyOptions({ pointMarkersVisible: segment.length === 1 })
  }

  function clearAuxiliarySeries(key) {
    const chart = getChart()
    for (const line of auxiliarySeries[key] ?? []) chart?.removeSeries(line)
    delete auxiliarySeries[key]
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
    for (const key of Object.keys(auxiliarySeries)) clearAuxiliarySeries(key)
    for (const key of Object.keys(series)) {
      if (key === 'candle') continue
      chart.removeSeries(series[key])
      delete series[key]
    }
    for (const key of Object.keys(lineDescriptors)) delete lineDescriptors[key]
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
    setLineSegments,
    getPaneLayout: () => paneLayout,
    getMarkersApi: () => markersApi,
  }
}

function configurePaneLine(line) {
  line.priceScale().applyOptions({ scaleMargins: { top: 0.18, bottom: 0.18 }, alignLabels: true })
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
  const style = requiredSeriesStyle('equity')
  return {
    title: style.label,
    color: style.color,
    lineWidth: style.lineWidth,
    lineStyle: toLightLineStyle(style.lineStyle),
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
  const style = requiredSeriesStyle('kdjK')
  return {
    title: style.label,
    color: style.color,
    lineWidth: style.lineWidth,
    lineStyle: toLightLineStyle(style.lineStyle),
    priceLineVisible: false,
    lastValueVisible: false,
  }
}

function kdjJOptions() {
  const style = requiredSeriesStyle('kdjJ')
  return {
    title: style.label,
    color: style.color,
    lineWidth: style.lineWidth,
    lineStyle: toLightLineStyle(style.lineStyle),
    priceLineVisible: false,
    lastValueVisible: false,
  }
}

function rsiOptions() {
  const style = requiredSeriesStyle('rsi')
  return {
    title: style.label,
    color: style.color,
    lineWidth: style.lineWidth,
    lineStyle: toLightLineStyle(style.lineStyle),
    priceLineVisible: false,
    lastValueVisible: false,
  }
}

function deltaLine(key, options = {}) {
  const style = requiredSeriesStyle(key)
  const latestOnlyPoint = key === 'lpPoolTurnover' || key === 'lpPoolConcentration'
  return {
    title: style.label,
    color: style.color,
    lineWidth: style.lineWidth,
    lineStyle: toLightLineStyle(style.lineStyle),
    priceScaleId: options.priceScaleId,
    priceLineVisible: false,
    lastValueVisible: options.lastValueVisible ?? true,
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    ...(latestOnlyPoint ? { pointMarkersVisible: true, pointMarkersRadius: 3 } : {}),
  }
}

function requiredSeriesStyle(key) {
  const style = getMarketLabSeriesStyle(key)
  if (!style) throw new Error(`未知 Market Lab 图表序列: ${key}`)
  return style
}

function toLightLineStyle(value) {
  if (value === 'dashed') return LineStyle.Dashed
  if (value === 'dotted') return LineStyle.Dotted
  return LineStyle.Solid
}
