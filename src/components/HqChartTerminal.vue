<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import 'hqchart/src/jscommon/umychart.resource/css/tools.css'
import 'hqchart/src/jscommon/umychart.resource/css/umychart.drawtool.dailog.css'
import 'hqchart/src/jscommon/umychart.resource/css/umychart.popmenu.css'
import 'hqchart/src/jscommon/umychart.resource/font/iconfont.css'
import 'hqchart/src/jscommon/umychart.resource/font/drawtool/iconfont.css'
import WorkbenchSummary from './WorkbenchSummary.vue'
import HqChartToolbar from './HqChartToolbar.vue'
import MainChartHoverLegend from './MainChartHoverLegend.vue'
import StockChipProfileOverlay from './StockChipProfileOverlay.vue'
import { buildHqChartLegend } from './hqChartLegendModel.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import { useMarketLabChartIndicators } from '../composables/useMarketLabChartIndicators.js'
import { persistedReactive } from '../composables/usePersisted.js'
import { createHqChartAdapter } from '../infrastructure/charting/hqChartAdapter.js'
import {
  HQ_KLINE_STYLES,
  HQ_MAIN_INDICATORS,
  HQ_PERIODS,
  HQ_SUB_INDICATORS,
  normalizeHqPreference,
} from '../infrastructure/charting/hqChartCatalog.js'

const props = defineProps({
  rows: { type: Array, required: true },
  source: { type: Object, default: null },
  costPath: { type: Array, required: true },
  formulaPath: { type: Array, required: true },
  entryPrice: { type: Number, required: true },
  replay: { type: Object, required: true },
  position: { type: Object, default: null },
  overlays: { type: Object, required: true },
  drawingScope: { type: String, default: '' },
  summary: { type: Object, default: null },
  theme: { type: String, default: 'light' },
})

const emit = defineEmits(['cursor-change', 'fatal-error', 'loading-change', 'ready', 'set-overlay'])
const terminal = ref(null)
const stage = ref(null)
const chartElement = ref(null)
const ready = ref(false)
const loading = ref(true)
const error = ref('')
const warning = ref('')
const activeDrawing = ref('')
const { isMobile } = useBreakpoint()
const researchModel = useMarketLabChartIndicators(props)
const cursorIndex = ref(null)
const hoverLegend = computed(() =>
  buildHqChartLegend({ rows: props.rows, model: researchModel.value, index: cursorIndex.value }),
)
const showStockChipProfile = computed(() => props.overlays.stockChipProfile !== false && !isMobile.value)
const stockChipViewport = ref(null)
// v4 intentionally drops the old BOLL/MACD defaults. Drawing storage uses a
// separate key, so this reset only affects HQ display preferences.
const preferences = persistedReactive('lab.chartState.hqchart.v4', {
  period: 0,
  mainIndex: 'EMPTY',
  subIndex1: 'EMPTY',
  subIndex2: 'EMPTY',
  drawType: 0,
})

normalizePreferences(preferences)

let adapter = null
let resizeObserver = null
let initController = null
let generation = 0
let stockChipFrame = 0
let stockChipSignature = ''

onMounted(async () => {
  document.addEventListener('keydown', onTerminalKeydown)
  resizeObserver = new ResizeObserver(() => adapter?.resize())
  if (chartElement.value) resizeObserver.observe(chartElement.value)
  await rebuildChart()
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onTerminalKeydown)
  generation += 1
  initController?.abort()
  initController = null
  resizeObserver?.disconnect()
  resizeObserver = null
  stopStockChipMonitor()
  adapter?.destroy()
  adapter = null
  emit('loading-change', false)
  emit('cursor-change', null)
})

watch(
  () => [props.rows, props.source?.id, props.source?.symbol, props.drawingScope, props.theme, researchModel.value],
  () => rebuildChart(),
)

watch(loading, (value) => emit('loading-change', value), { immediate: true })
watch(
  () => [ready.value, showStockChipProfile.value],
  ([isReady, show]) => {
    if (isReady && show) startStockChipMonitor()
    else stopStockChipMonitor()
  },
)

async function rebuildChart() {
  const current = ++generation
  initController?.abort()
  const controller = new AbortController()
  initController = controller
  ready.value = false
  loading.value = true
  error.value = ''
  warning.value = ''
  stopStockChipMonitor()
  adapter?.destroy()
  adapter = null
  await nextTick()
  if (current !== generation || !chartElement.value) return
  try {
    const nextAdapter = await createHqChartAdapter({
      element: chartElement.value,
      getRows: () => props.rows,
      getSource: () => props.source ?? {},
      getResearchModel: () => researchModel.value,
      drawingScope: props.drawingScope,
      dark: props.theme === 'dark',
      preferences,
      signal: controller.signal,
      onCursor: (index) => {
        cursorIndex.value = index
        emit('cursor-change', index)
      },
      onDrawingFinished: () => {
        const label = activeDrawing.value || '画线'
        activeDrawing.value = ''
        warning.value = `${label}已完成并保存在当前标的。`
      },
      onUnsupported: ({ reason }) => {
        if (reason === 'minute-data-unavailable') warning.value = '当前数据源只有日 K，未伪造分钟行情。'
        if (reason === 'research-index-unavailable') warning.value = '所选 Lab 指标当前没有可绘制输出。'
      },
      onWarning: (message) => {
        warning.value = String(message || 'HQ 指标执行提示')
      },
      onPreferenceChange: syncNativePreference,
    })
    if (current !== generation || controller.signal.aborted) {
      nextAdapter.destroy()
      return
    }
    adapter = nextAdapter
    ready.value = true
    loading.value = false
    startStockChipMonitor()
    emit('ready')
  } catch (caught) {
    if (current !== generation || controller.signal.aborted) return
    const message = caught instanceof Error ? caught.message : String(caught)
    error.value = message || 'HQChart 初始化失败'
    loading.value = false
    emit('fatal-error', caught)
  } finally {
    if (initController === controller) initController = null
  }
}

function startStockChipMonitor() {
  if (stockChipFrame || !ready.value || !showStockChipProfile.value) return
  const tick = () => {
    stockChipFrame = 0
    if (!ready.value || !showStockChipProfile.value || !adapter) return
    const next = adapter.getStockChipViewport?.() ?? null
    const signature = next?.signature ?? 'null'
    if (signature !== stockChipSignature) {
      stockChipSignature = signature
      stockChipViewport.value = next
    }
    stockChipFrame = requestAnimationFrame(tick)
  }
  stockChipFrame = requestAnimationFrame(tick)
}

function stopStockChipMonitor() {
  if (stockChipFrame) cancelAnimationFrame(stockChipFrame)
  stockChipFrame = 0
  stockChipSignature = ''
  stockChipViewport.value = null
}

function setPeriod(value) {
  preferences.period = normalizeHqPreference(Number(value), HQ_PERIODS, 0)
  invoke(() => adapter?.changePeriod(preferences.period))
}

function resetViewport() {
  invoke(() => adapter?.fitContent())
}

function setMainIndex(value) {
  preferences.mainIndex = normalizeHqPreference(value, HQ_MAIN_INDICATORS, 'EMPTY')
  invoke(() => adapter?.changeIndex(0, preferences.mainIndex))
}

function setSubIndex(key, value) {
  preferences[key] = normalizeHqPreference(value, HQ_SUB_INDICATORS, 'EMPTY')
  // EMPTY windows are not mounted at all. Rebuild so selecting or clearing a
  // native sub-indicator cannot overwrite a Lab research pane.
  rebuildChart()
}

function setKLineStyle(value) {
  preferences.drawType = normalizeHqPreference(Number(value), HQ_KLINE_STYLES, 0)
  invoke(() => adapter?.changeKLineStyle(preferences.drawType))
}

function syncNativePreference(key, value) {
  if (key === 'period') preferences.period = normalizeHqPreference(value, HQ_PERIODS, 0)
  if (key === 'drawType') preferences.drawType = normalizeHqPreference(value, HQ_KLINE_STYLES, 0)
}

function startDrawing(name) {
  invoke(() => {
    adapter?.startDrawing(name)
    activeDrawing.value = name
    warning.value = `已选择${name}：请在图上点选位置，按 Esc 可取消。`
  })
}

function showDrawTools() {
  invoke(() => adapter?.showDrawTools())
}

function onTerminalKeydown(event) {
  if (event.key !== 'Escape' || !activeDrawing.value) return
  const label = activeDrawing.value
  activeDrawing.value = ''
  warning.value = `已取消${label}。`
}

async function requestFullscreen() {
  try {
    await terminal.value?.requestFullscreen?.()
  } catch (caught) {
    warning.value = caught instanceof Error ? caught.message : '浏览器未允许全屏'
  }
}

function invoke(command) {
  try {
    command()
  } catch (caught) {
    warning.value = caught instanceof Error ? caught.message : String(caught)
  }
}

function normalizePreferences(state) {
  state.period = normalizeHqPreference(Number(state.period), HQ_PERIODS, 0)
  state.mainIndex = normalizeHqPreference(state.mainIndex, HQ_MAIN_INDICATORS, 'EMPTY')
  state.subIndex1 = normalizeHqPreference(state.subIndex1, HQ_SUB_INDICATORS, 'EMPTY')
  state.subIndex2 = normalizeHqPreference(state.subIndex2, HQ_SUB_INDICATORS, 'EMPTY')
  state.drawType = normalizeHqPreference(Number(state.drawType), HQ_KLINE_STYLES, 0)
}
</script>

<template>
  <section ref="terminal" class="hq-terminal" :aria-busy="loading">
    <div class="hq-terminal-chrome">
      <div class="chart-context-rail">
        <WorkbenchSummary :model="summary" compact />
        <slot name="engine-switch" />
      </div>
      <HqChartToolbar
        :preferences="preferences"
        :ready="ready"
        :active-drawing="activeDrawing"
        :row-count="rows.length"
        :overlays="overlays"
        :research-model="researchModel"
        :chip-available="!isMobile"
        @period="setPeriod"
        @main-index="setMainIndex"
        @sub-index-1="(value) => setSubIndex('subIndex1', value)"
        @sub-index-2="(value) => setSubIndex('subIndex2', value)"
        @kline-style="setKLineStyle"
        @draw="startDrawing"
        @draw-tools="showDrawTools"
        @reset="resetViewport"
        @fullscreen="requestFullscreen"
        @set-overlay="(key, value) => emit('set-overlay', key, value)"
      />
      <p v-if="warning" class="hq-terminal-warning" role="status">{{ warning }}</p>
    </div>
    <div ref="stage" class="hq-terminal-stage">
      <div ref="chartElement" class="hq-chart-canvas" />
      <MainChartHoverLegend :legend="hoverLegend" />
      <StockChipProfileOverlay
        v-if="showStockChipProfile && stockChipViewport"
        :rows="rows"
        :viewport="stockChipViewport"
      />
      <div v-if="loading" class="hq-terminal-state" role="status">
        <span class="hq-loader" aria-hidden="true" />
        <strong>正在准备 HQ 专业终端</strong>
        <small>加载 Lab 自研指标、HQ 通用指标、画线工具与本地行情桥</small>
      </div>
      <div v-else-if="error" class="hq-terminal-state error" role="alert">
        <strong>HQ 专业终端启动失败</strong>
        <small>{{ error }}</small>
        <button type="button" @click="rebuildChart">重试</button>
      </div>
    </div>
  </section>
</template>
