<script setup>
import { createChart } from 'lightweight-charts'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ChartStatusBar from './ChartStatusBar.vue'
import ChartDisplayTools from './ChartDisplayTools.vue'
import ChartDrawingToolbar from './ChartDrawingToolbar.vue'
import MainChartHoverLegend from './MainChartHoverLegend.vue'
import StockChipProfileOverlay from './StockChipProfileOverlay.vue'
import WorkbenchSummary from './WorkbenchSummary.vue'
import { latestFinitePathPoint, resolvePreferredPath } from './mainChartLegendMeta.js'
import { computeKDJ } from '../domain/indicators/kdj.js'
import { computeRSI } from '../domain/indicators/rsi.js'
import { buildChartMarkers } from '../domain/research-visualization/chartMarkers.js'
import { useStockChipViewport } from '../composables/useStockChipViewport.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import {
  buildChartOptions,
  chartInteractionOptions,
  mainPriceScaleOptions,
  regimeColor,
  themeOptions,
} from '../composables/mainChartTheme.js'
import { ChartDrawingsPrimitive } from '../composables/ChartDrawingsPrimitive.js'
import { useChartDrawings } from '../composables/useChartDrawings.js'
import { useMainChartLegend } from '../composables/useMainChartLegend.js'
import { useMainChartSeries } from '../composables/useMainChartSeries.js'
import {
  toLightweightLineSegments,
  toLightweightPathLineSegments,
} from '../infrastructure/charting/lightweightResearchAdapter.js'

const { isMobile } = useBreakpoint()

const props = defineProps({
  rows: { type: Array, required: true },
  costPath: { type: Array, required: true },
  formulaPath: { type: Array, required: true },
  entryPrice: { type: Number, required: true },
  replay: { type: Object, required: true },
  market: { type: Object, default: null },
  decision: { type: Object, default: null },
  position: { type: Object, default: null },
  summary: { type: Object, default: null },
  drawingScope: { type: String, default: '' },
  overlays: { type: Object, required: true },
  input: { type: Object, required: true },
})

const emit = defineEmits(['cursor-change', 'param-change', 'set-overlay'])

const el = ref(null)
const drawingLayer = ref(null)
const showStockChipProfile = computed(() => props.overlays.stockChipProfile !== false && !isMobile.value)
let chart = null
let drawingsPrimitive = null
let themeObserver = null
let resizeObserver = null
let fittedDataSignature = ''
let fittedRows = null
let fittedScope = ''

const chartSeries = useMainChartSeries({
  getChart: () => chart,
  getProps: () => props,
})
const { series, seriesMeta, applyOverlays, setLineSegments, getPaneLayout, getMarkersApi } = chartSeries
const drawing = useChartDrawings({
  getChart: () => chart,
  getSeries: () => series,
  getPrimitive: () => drawingsPrimitive,
  getScope: () => props.drawingScope,
  getLayer: () => drawingLayer.value,
})
const {
  tool: drawingTool,
  drawings: chartDrawingItems,
  canUndo: canUndoDrawing,
  canRedo: canRedoDrawing,
  canDelete: canDeleteDrawing,
  inputActive: drawingInputActive,
  helpText: drawingHelpText,
} = drawing

const stockChipViewport = useStockChipViewport({
  getChart: () => chart,
  getSeries: () => series,
  getRows: () => props.rows,
  getPaneIndex: () => getPaneLayout().main,
  isEnabled: () => showStockChipProfile.value,
})
const { hoverLegend, handleCrosshair: handleCrosshairBase } = useMainChartLegend({
  getRows: () => props.rows,
  getSeries: () => series,
  getSeriesMeta: () => seriesMeta,
  getProps: () => props,
})

onMounted(() => {
  chart = createChart(el.value, chartOptions())
  applyOverlays()
  drawingsPrimitive = new ChartDrawingsPrimitive()
  series.candle.attachPrimitive(drawingsPrimitive)
  drawing.attach()
  syncChart()
  chart.subscribeCrosshairMove(handleCrosshair)
  chart.timeScale().subscribeVisibleLogicalRangeChange(stockChipViewport.queue)
  stockChipViewport.startMonitor()
  resizeObserver = new ResizeObserver(() => resize())
  resizeObserver.observe(el.value)
  themeObserver = new MutationObserver(() => syncChart())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  stockChipViewport.dispose()
  drawing.dispose()
  if (drawingsPrimitive && series.candle) series.candle.detachPrimitive(drawingsPrimitive)
  chart?.timeScale().unsubscribeVisibleLogicalRangeChange(stockChipViewport.queue)
  chart?.unsubscribeCrosshairMove(handleCrosshair)
  chart?.remove()
})

watch(
  () => [
    props.rows,
    props.drawingScope,
    props.costPath,
    props.formulaPath,
    props.entryPrice,
    props.replay,
    props.decision,
    props.position,
  ],
  () => {
    applyOverlays()
    syncChart()
  },
  { deep: true },
)
watch(
  () => ({ ...props.overlays }),
  () => {
    applyOverlays()
    syncChart()
  },
  { deep: true },
)
watch(showStockChipProfile, (on) => {
  if (on) {
    stockChipViewport.queue()
    stockChipViewport.startMonitor()
  } else {
    stockChipViewport.stopMonitor()
  }
})
watch(drawingInputActive, () => applyDrawingInteractionMode())

function syncChart() {
  if (!chart || !series.candle) return
  const nextDataSignature = chartDataSignature(props.rows)
  const nextScope = props.drawingScope.trim()
  const shouldFit = props.rows !== fittedRows || nextDataSignature !== fittedDataSignature || nextScope !== fittedScope
  const dark = document.documentElement.classList.contains('dark')
  // 主题相关的 layout/grid/rightPriceScale/timeScale 配置统一从 themeOptions 取
  chart.applyOptions(themeOptions(dark))
  series.candle.priceScale().applyOptions(mainPriceScaleOptions())
  series.candle.setData(
    props.rows.map((row) => ({ time: row.date, open: row.open, high: row.high, low: row.low, close: row.close })),
  )
  if (series.cost) setPreferredPathLine('cost', 'costAnchor', 'anchor')
  if (series.costUpper) setPreferredPathLine('costUpper', 'costUpper', 'upper')
  if (series.costLower) setPreferredPathLine('costLower', 'costLower', 'lower')
  if (series.deltaUpper) setPathLine('deltaUpper', props.formulaPath, 'deltaUpper')
  if (series.deltaLower) setPathLine('deltaLower', props.formulaPath, 'deltaLower')
  if (series.lpLower) setPathLine('lpLower', props.formulaPath, 'lpLowerPrice')
  if (series.lpUpper) setPathLine('lpUpper', props.formulaPath, 'lpUpperPrice')
  if (series.lpRealPrice) setPathLine('lpRealPrice', props.formulaPath, 'lpRealPrice')
  if (series.entry)
    setLine(
      'entry',
      props.rows.map(() => props.entryPrice),
    )
  if (series.mark)
    setLine(
      'mark',
      props.rows.map(() => props.rows.at(-1)?.close),
    )
  if (series.target)
    setLine(
      'target',
      props.rows.map(() => props.position?.targetPrice),
    )
  if (series.stop)
    setLine(
      'stop',
      props.rows.map(() => props.position?.stopPrice),
    )
  if (series.volume) {
    series.volume.setData(
      props.rows.map((row) => ({
        time: row.date,
        value: row.volume,
        color: row.close >= row.open ? 'rgba(14,117,88,0.38)' : 'rgba(169,50,38,0.38)',
      })),
    )
  }
  if (series.regime) {
    const costByDate = new Map((props.costPath ?? []).map((point) => [point?.date, point]))
    series.regime.setData(
      props.rows.map((row) => {
        const cost = costByDate.get(row.date)
        const zone = cost ? regimeColor(row.close, cost) : null
        return zone ? { time: row.date, value: 1, color: zone } : { time: row.date, value: 0 }
      }),
    )
  }
  if (series.bsDelta) setPathLine('bsDelta', props.formulaPath, 'optionDelta')
  if (series.bsGamma) setPathLine('bsGamma', props.formulaPath, 'optionGamma')
  if (series.bsTheta) setPathLine('bsTheta', props.formulaPath, 'optionThetaPerSession')
  if (series.greeksZero)
    setLine(
      'greeksZero',
      props.rows.map(() => 0),
    )
  if (series.lpDelta) setPathLine('lpDelta', props.formulaPath, 'lpNormalizedDelta')
  if (series.lpValue) setPathLine('lpValue', props.formulaPath, 'lpValue')
  if (series.lpRealDiv) setPathLine('lpRealDiv', props.formulaPath, 'lpRealDivergence')
  if (series.lpPoolTurnover) setLatestPoint('lpPoolTurnover', props.formulaPath, 'lpPoolTurnover24h')
  if (series.lpPoolConcentration) setLatestPoint('lpPoolConcentration', props.formulaPath, 'lpPoolTopReserveShare')
  if (series.lpCe) setPathLine('lpCe', props.formulaPath, 'capitalEfficiency')
  if (series.lpZero)
    setLine(
      'lpZero',
      props.rows.map(() => 0),
    )
  if (series.cumulativeFundingProxy) setPathLine('cumulativeFundingProxy', props.formulaPath, 'cumulativeFundingProxy')
  if (series.netCarry) setPathLine('netCarry', props.formulaPath, 'netCarry')
  if (series.carryZero)
    setLine(
      'carryZero',
      props.rows.map(() => 0),
    )
  if (series.equity) setPathLine('equity', props.replay?.equityCurve, 'equity')
  if (series.equityZero)
    setLine(
      'equityZero',
      props.rows.map(() => 0),
    )
  if (series.kdjK || series.kdjJ) {
    const kdj = computeKDJ(props.rows)
    if (series.kdjK) {
      setPathLine(
        'kdjK',
        kdj.map((row) => ({
          ...row,
          mean: Number.isFinite(row.k) && Number.isFinite(row.d) ? (row.k + row.d) / 2 : null,
        })),
        'mean',
      )
    }
    if (series.kdjJ) setPathLine('kdjJ', kdj, 'j')
  }
  if (series.rsi) {
    const rsi = computeRSI(props.rows)
    setPathLine('rsi', rsi, 'custom')
  }
  // markers：replay trades + 当前决策点 + 研究层状态
  const markersApi = getMarkersApi()
  if (markersApi) {
    markersApi.setMarkers(
      buildChartMarkers({
        rows: props.rows,
        replay: props.replay,
        decision: props.decision,
        overlays: props.overlays,
        formulaPath: props.formulaPath,
      }),
    )
  }
  if (shouldFit) {
    chart.timeScale().fitContent()
    fittedRows = props.rows
    fittedDataSignature = nextDataSignature
    fittedScope = nextScope
  }
  drawing.refresh()
  stockChipViewport.queue()
}

function setLine(key, values) {
  setLineSegments(key, toLightweightLineSegments(props.rows, values))
}

function setPathLine(key, path, field) {
  setLineSegments(key, toLightweightPathLineSegments(props.rows, path, field))
}

function setPreferredPathLine(key, primaryField, fallbackField) {
  const selected = resolvePreferredPath(props.formulaPath, primaryField, props.costPath, fallbackField)
  setPathLine(key, selected.path, selected.field)
}

function setLatestPoint(key, path, field) {
  const point = latestFinitePathPoint(props.rows, path, field)
  setLineSegments(key, point ? [[point]] : [])
}

function handleCrosshair(param) {
  const idx = handleCrosshairBase(param)
  emit('cursor-change', idx)
}

function resize() {
  if (!chart || !el.value) return
  chart.resize(el.value.clientWidth, el.value.clientHeight)
  drawing.refresh()
  stockChipViewport.queue()
}

function resetViewport() {
  chart?.timeScale().fitContent()
  drawing.refresh()
}

function applyDrawingInteractionMode() {
  chart?.applyOptions(chartInteractionOptions(drawingInputActive.value))
  if (drawingInputActive.value) stockChipViewport.stopMonitor()
  else if (showStockChipProfile.value) stockChipViewport.startMonitor()
}

function confirmClearDrawings() {
  if (!chartDrawingItems.value.length) return
  if (window.confirm('清空当前标的的全部手绘标注？清空后仍可撤销。')) drawing.clearDrawings()
}

function chartOptions() {
  const dark = document.documentElement.classList.contains('dark')
  return buildChartOptions({
    dark,
    width: el.value?.clientWidth ?? 800,
    height: el.value?.clientHeight ?? 620,
  })
}

function chartDataSignature(rows) {
  if (!rows.length) return ''
  return `${rows[0]?.date ?? ''}|${rows.at(-1)?.date ?? ''}|${rows.length}`
}
</script>

<template>
  <div class="main-chart-shell">
    <div class="main-chart-chrome">
      <div class="chart-context-rail">
        <WorkbenchSummary :model="summary" compact />
        <slot name="engine-switch" />
      </div>
      <div class="chart-control-deck">
        <ChartDrawingToolbar
          :tool="drawingTool"
          :count="chartDrawingItems.length"
          :can-undo="canUndoDrawing"
          :can-redo="canRedoDrawing"
          :can-delete="canDeleteDrawing"
          :help-text="drawingHelpText"
          @set-tool="drawing.setTool"
          @undo="drawing.undo"
          @redo="drawing.redo"
          @delete="drawing.deleteSelected"
          @clear="confirmClearDrawings"
          @fit="resetViewport"
        />
        <ChartDisplayTools
          :overlays="overlays"
          :chip-available="!isMobile"
          @set-overlay="(key, value) => emit('set-overlay', key, value)"
        />
        <ChartStatusBar :input="input" @change="(field, v) => emit('param-change', field, v)" />
      </div>
    </div>
    <div class="main-chart-stage">
      <div ref="el" class="main-chart-canvas" />
      <div
        ref="drawingLayer"
        class="chart-drawing-input"
        :class="{ active: drawingInputActive }"
        :data-tool="drawingTool"
        @pointerdown="drawing.onPointerDown"
        @pointermove="drawing.onPointerMove"
        @pointerup="drawing.onPointerUp"
        @pointercancel="drawing.onPointerCancel"
        @lostpointercapture="drawing.onLostPointerCapture"
      />
      <MainChartHoverLegend :legend="hoverLegend" />
      <StockChipProfileOverlay v-if="showStockChipProfile" :rows="rows" :viewport="stockChipViewport.viewport.value" />
    </div>
  </div>
</template>
