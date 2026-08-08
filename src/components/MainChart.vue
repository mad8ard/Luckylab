<script setup>
import { createChart } from 'lightweight-charts'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ChartStatusBar from './ChartStatusBar.vue'
import MainChartHoverLegend from './MainChartHoverLegend.vue'
import StockChipProfileOverlay from './StockChipProfileOverlay.vue'
import { computeKDJ } from '../domain/indicators/kdj.js'
import { computeRSI } from '../domain/indicators/rsi.js'
import { buildChartMarkers } from '../domain/research-visualization/chartMarkers.js'
import { useStockChipViewport } from '../composables/useStockChipViewport.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { buildChartOptions, finiteOrNull, regimeColor, themeOptions } from '../composables/mainChartTheme.js'
import { useMainChartLegend } from '../composables/useMainChartLegend.js'
import { useMainChartSeries } from '../composables/useMainChartSeries.js'

const { isMobile } = useBreakpoint()

const props = defineProps({
  rows: { type: Array, required: true },
  costPath: { type: Array, required: true },
  formulaPath: { type: Array, required: true },
  entryPrice: { type: Number, required: true },
  replay: { type: Object, required: true },
  market: { type: Object, default: null },
  decision: { type: Object, default: null },
  overlays: { type: Object, required: true },
  input: { type: Object, required: true },
})

const emit = defineEmits(['cursor-change', 'param-change'])

const el = ref(null)
const showStockChipProfile = computed(() => props.overlays.stockChipProfile !== false)
let chart = null
let themeObserver = null
let resizeObserver = null

const chartSeries = useMainChartSeries({
  getChart: () => chart,
  getProps: () => props,
})
const { series, seriesMeta, applyOverlays, getPaneLayout, getMarkersApi } = chartSeries

const stockChipViewport = useStockChipViewport({
  getChart: () => chart,
  getSeries: () => series,
  getRows: () => props.rows,
  getPaneIndex: () => getPaneLayout().main,
  isEnabled: () => showStockChipProfile.value,
})
const {
  hoverIndex,
  hoverLegend,
  handleCrosshair: handleCrosshairBase,
} = useMainChartLegend({
  getRows: () => props.rows,
  getSeries: () => series,
  getSeriesMeta: () => seriesMeta,
  getProps: () => props,
})

onMounted(() => {
  chart = createChart(el.value, chartOptions())
  applyOverlays()
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
  chart?.timeScale().unsubscribeVisibleLogicalRangeChange(stockChipViewport.queue)
  chart?.unsubscribeCrosshairMove(handleCrosshair)
  chart?.remove()
})

watch(
  () => [props.rows, props.costPath, props.formulaPath, props.entryPrice, props.replay, props.decision],
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

function syncChart() {
  if (!chart || !series.candle) return
  const dark = document.documentElement.classList.contains('dark')
  // 主题相关的 layout/grid/rightPriceScale/timeScale 配置统一从 themeOptions 取
  chart.applyOptions(themeOptions(dark))
  series.candle.setData(
    props.rows.map((row) => ({ time: row.date, open: row.open, high: row.high, low: row.low, close: row.close })),
  )
  if (series.cost)
    setLine(
      series.cost,
      pathValues(
        'costAnchor',
        props.costPath.map((r) => r.anchor),
      ),
    )
  if (series.costUpper)
    setLine(
      series.costUpper,
      pathValues(
        'costUpper',
        props.costPath.map((r) => r.upper),
      ),
    )
  if (series.costLower)
    setLine(
      series.costLower,
      pathValues(
        'costLower',
        props.costPath.map((r) => r.lower),
      ),
    )
  if (series.deltaUpper)
    setLine(
      series.deltaUpper,
      props.formulaPath.map((r) => r.deltaUpper),
    )
  if (series.deltaLower)
    setLine(
      series.deltaLower,
      props.formulaPath.map((r) => r.deltaLower),
    )
  if (series.lpLower)
    setLine(
      series.lpLower,
      props.formulaPath.map((r) => r.lpLowerPrice),
    )
  if (series.lpUpper)
    setLine(
      series.lpUpper,
      props.formulaPath.map((r) => r.lpUpperPrice),
    )
  if (series.lpRealPrice)
    setLine(
      series.lpRealPrice,
      props.formulaPath.map((r) => r.lpRealPrice),
    )
  if (series.entry)
    setLine(
      series.entry,
      props.rows.map(() => props.entryPrice),
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
    series.regime.setData(
      props.rows.map((row, i) => {
        const cost = props.costPath[i]
        const zone = cost ? regimeColor(row.close, cost) : null
        return zone ? { time: row.date, value: 1, color: zone } : { time: row.date, value: 0 }
      }),
    )
  }
  if (series.bsDelta)
    setLine(
      series.bsDelta,
      props.formulaPath.map((r) => r.optionDelta),
    )
  if (series.bsGamma)
    setLine(
      series.bsGamma,
      props.formulaPath.map((r) => r.optionGamma),
    )
  if (series.bsTheta)
    setLine(
      series.bsTheta,
      props.formulaPath.map((r) => r.optionThetaDaily),
    )
  if (series.greeksZero)
    setLine(
      series.greeksZero,
      props.rows.map(() => 0),
    )
  if (series.lpDelta)
    setLine(
      series.lpDelta,
      props.formulaPath.map((r) => r.lpNormalizedDelta),
    )
  if (series.lpValue)
    setLine(
      series.lpValue,
      props.formulaPath.map((r) => r.lpValue),
    )
  if (series.lpRealDiv)
    setLine(
      series.lpRealDiv,
      props.formulaPath.map((r) => r.lpRealDivergence),
    )
  if (series.lpPoolTurnover) setLatestPoint(series.lpPoolTurnover, props.formulaPath.at(-1)?.lpPoolTurnover24h)
  if (series.lpPoolConcentration)
    setLatestPoint(series.lpPoolConcentration, props.formulaPath.at(-1)?.lpPoolTopReserveShare)
  if (series.lpCe)
    setLine(
      series.lpCe,
      props.formulaPath.map((r) => r.capitalEfficiency),
    )
  if (series.lpZero)
    setLine(
      series.lpZero,
      props.rows.map(() => 0),
    )
  if (series.fundingProxy)
    setLine(
      series.fundingProxy,
      props.formulaPath.map((r) => r.fundingProxy),
    )
  if (series.netCarry)
    setLine(
      series.netCarry,
      props.formulaPath.map((r) => r.netCarry),
    )
  if (series.carryZero)
    setLine(
      series.carryZero,
      props.rows.map(() => 0),
    )
  if (series.equity) {
    const equityByDate = new Map((props.replay?.equityCurve ?? []).map((p) => [p.date, p.equity]))
    series.equity.setData(
      props.rows
        .map((row) => ({ time: row.date, value: equityByDate.has(row.date) ? equityByDate.get(row.date) : null }))
        .filter((p) => p.value !== null),
    )
  }
  if (series.equityZero) {
    series.equityZero.setData(props.rows.map((row) => ({ time: row.date, value: 0 })))
  }
  if (series.kdjK || series.kdjJ) {
    const kdj = computeKDJ(props.rows)
    if (series.kdjK) {
      series.kdjK.setData(
        kdj
          .map((r) => ({ time: r.date, value: r.k !== null && r.d !== null ? (r.k + r.d) / 2 : null }))
          .filter((p) => p.value !== null),
      )
    }
    if (series.kdjJ) {
      series.kdjJ.setData(kdj.map((r) => ({ time: r.date, value: finiteOrNull(r.j) })).filter((p) => p.value !== null))
    }
  }
  if (series.rsi) {
    const rsi = computeRSI(props.rows)
    series.rsi.setData(
      rsi.map((r) => ({ time: r.date, value: finiteOrNull(r.custom) })).filter((p) => p.value !== null),
    )
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
  chart.timeScale().fitContent()
  stockChipViewport.queue()
}

function setLine(lineSeries, values) {
  lineSeries.setData(
    props.rows.map((row, i) => ({ time: row.date, value: finiteOrNull(values[i]) })).filter((p) => p.value !== null),
  )
}

function setLatestPoint(lineSeries, value) {
  const last = props.rows.at(-1)
  const next = finiteOrNull(value)
  lineSeries.setData(last && next !== null ? [{ time: last.date, value: next }] : [])
}

function pathValues(field, fallback = []) {
  const values = props.formulaPath.map((row) => row?.[field])
  return values.some(Number.isFinite) ? values : fallback
}

function handleCrosshair(param) {
  const idx = handleCrosshairBase(param)
  emit('cursor-change', idx)
}

function resize() {
  if (!chart || !el.value) return
  chart.resize(el.value.clientWidth, el.value.clientHeight)
  stockChipViewport.queue()
}

function chartOptions() {
  const dark = document.documentElement.classList.contains('dark')
  return buildChartOptions({
    dark,
    width: el.value?.clientWidth ?? 800,
    height: el.value?.clientHeight ?? 620,
  })
}

// 移动端点按图表时合成 mousemove，复用桌面端 crosshair 流。
function onMobileTap(e) {
  if (!isMobile.value) return
  const touch = e.touches?.[0]
  if (!touch) return
  const evt = new MouseEvent('mousemove', {
    clientX: touch.clientX,
    clientY: touch.clientY,
    bubbles: true,
  })
  e.target.dispatchEvent(evt)
}
</script>

<template>
  <div class="main-chart-shell">
    <div ref="el" class="main-chart-canvas" @touchstart.passive="onMobileTap" />

    <!-- Hover 图例：拆到子组件，本文件只构造 hoverLegend 对象 -->
    <MainChartHoverLegend :legend="hoverLegend" />
    <StockChipProfileOverlay v-if="showStockChipProfile" :rows="rows" :viewport="stockChipViewport.viewport.value" />

    <ChartStatusBar :input="input" @change="(field, v) => emit('param-change', field, v)" />
  </div>
</template>

<style>
.main-chart-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.main-chart-canvas {
  width: 100%;
  height: 100%;
}

/* 移动端：在父容器够高时主图铺满（继承桌面 height: 100%），父容器若意外塌缩，60vh 兜底。 */
@media (max-width: 768px) {
  .main-chart-shell {
    min-height: 60vh;
  }
  .main-chart-canvas {
    min-height: 60vh;
  }
}
</style>
