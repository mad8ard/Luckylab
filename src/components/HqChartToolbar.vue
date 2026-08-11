<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import HqIndicatorLayers from './HqIndicatorLayers.vue'
import ChartDisplayTools from './ChartDisplayTools.vue'
import { HQ_KLINE_STYLES, HQ_PERIODS, HQ_QUICK_DRAWINGS } from '../infrastructure/charting/hqChartCatalog.js'

const props = defineProps({
  preferences: { type: Object, required: true },
  ready: { type: Boolean, default: false },
  rowCount: { type: Number, default: 0 },
  overlays: { type: Object, required: true },
  researchModel: { type: Object, default: null },
  activeDrawing: { type: String, default: '' },
  chipAvailable: { type: Boolean, default: true },
})

const emit = defineEmits([
  'period',
  'main-index',
  'sub-index-1',
  'sub-index-2',
  'kline-style',
  'draw',
  'draw-tools',
  'reset',
  'fullscreen',
  'set-overlay',
])

const indicatorLayers = ref(null)
const drawPanel = ref(null)
const drawPanelOpen = ref(false)
let returnFocusTarget = null

const drawingGroups = Object.freeze([
  {
    id: 'line',
    label: '趋势与价位',
    tools: [
      tool('趋势线', '趋势线', '连接两个关键点'),
      tool('水平线', '水平线', '标记固定价格'),
      tool('垂直线', '垂直线', '标记日期位置'),
      tool('射线', '射线', '从起点向右延伸'),
      tool('平行通道', '平行通道', '画趋势通道'),
      tool('价格通道线', '价格通道', '画上下轨通道'),
    ],
  },
  {
    id: 'position',
    label: '仓位与测量',
    tools: [
      tool('TVLongPosition', '多仓尺', '测算多头盈亏区间'),
      tool('TVShortPosition', '空仓尺', '测算空头盈亏区间'),
      tool('PriceRange', '价格区间', '测量价格变化'),
      tool('DateRange', '日期区间', '测量时间跨度'),
      tool('DatePriceRange', '日期与价格', '同时测量时间和价格'),
    ],
  },
  {
    id: 'shape',
    label: '形状与标注',
    tools: [
      tool('矩形', '矩形', '圈出价格区域'),
      tool('圆', '圆形', '圈出局部走势'),
      tool('三角形', '三角形', '标记收敛区间'),
      tool('文本', '文字', '在图上添加备注'),
    ],
  },
  {
    id: 'fibonacci',
    label: '比例工具',
    tools: [
      tool('FibRetracement', '斐波那契回撤', '标记常见回撤比例'),
      tool('黄金分割', '黄金分割线', '按高低点划分比例'),
      tool('百分比线', '百分比线', '按区间显示百分比'),
    ],
  },
])

onMounted(() => document.addEventListener('keydown', onKeydown))

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  setAppInert(false)
})

function tool(id, label, hint) {
  return Object.freeze({ id, label, hint })
}

async function openDrawPanel(event) {
  if (!props.ready) return
  indicatorLayers.value?.closePanel(false)
  closeNativeDrawTools()
  returnFocusTarget = event?.currentTarget ?? document.activeElement
  drawPanelOpen.value = true
  setAppInert(true)
  await nextTick()
  drawPanel.value?.querySelector('button:not(:disabled), select:not(:disabled)')?.focus()
}

function closeDrawPanel(restoreFocus = true) {
  const target = returnFocusTarget
  drawPanelOpen.value = false
  returnFocusTarget = null
  setAppInert(false)
  if (restoreFocus) nextTick(() => target?.isConnected && target.focus?.())
}

function activateDrawing(item) {
  emit('draw', item.id)
  closeDrawPanel()
}

function openNativeDrawTools() {
  closeDrawPanel(false)
  indicatorLayers.value?.closePanel(false)
  emit('draw-tools')
}

function onIndicatorPanelChange(state) {
  if (!state?.open) return
  if (drawPanelOpen.value) closeDrawPanel(false)
  setAppInert(true)
  closeNativeDrawTools()
}

function onKeydown(event) {
  if (!drawPanelOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeDrawPanel()
    return
  }
  if (event.key !== 'Tab') return
  trapPanelFocus(event)
}

function trapPanelFocus(event) {
  const focusable = [...(drawPanel.value?.querySelectorAll('button:not(:disabled), select:not(:disabled)') ?? [])]
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && (document.activeElement === first || !drawPanel.value?.contains(document.activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function closeNativeDrawTools() {
  const close = document.querySelector('.UMyChart_DrawTool_Close_Div')
  close?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
}

function setAppInert(value) {
  const app = document.getElementById('app')
  if (!app) return
  if (value) app.setAttribute('inert', '')
  else app.removeAttribute('inert')
}
</script>

<template>
  <div class="hq-terminal-toolbar" aria-label="HQChart 专业工具">
    <div class="hq-periods" role="toolbar" aria-label="K线周期">
      <button
        v-for="item in HQ_PERIODS"
        :key="item.id"
        type="button"
        :class="{ active: preferences.period === item.id }"
        :aria-pressed="preferences.period === item.id"
        :disabled="!ready"
        @click="emit('period', item.id)"
      >
        {{ item.label }}
      </button>
    </div>

    <label class="hq-mobile-period">
      <span>周期</span>
      <select
        aria-label="K线周期"
        :value="preferences.period"
        :disabled="!ready"
        @change="emit('period', Number($event.target.value))"
      >
        <option v-for="item in HQ_PERIODS" :key="item.id" :value="item.id">{{ item.label }}</option>
      </select>
    </label>

    <HqIndicatorLayers
      ref="indicatorLayers"
      :preferences="preferences"
      :ready="ready"
      :overlays="overlays"
      :research-model="researchModel"
      @main-index="(value) => emit('main-index', value)"
      @sub-index-1="(value) => emit('sub-index-1', value)"
      @sub-index-2="(value) => emit('sub-index-2', value)"
      @set-overlay="(key, value) => emit('set-overlay', key, value)"
      @panel-change="onIndicatorPanelChange"
    />

    <ChartDisplayTools
      :overlays="overlays"
      :ready="ready"
      :chip-available="chipAvailable"
      @set-overlay="(key, value) => emit('set-overlay', key, value)"
    />

    <button
      type="button"
      class="hq-mobile-draw-trigger"
      :class="{ active: drawPanelOpen || activeDrawing }"
      :aria-expanded="drawPanelOpen"
      :aria-pressed="Boolean(activeDrawing)"
      aria-haspopup="dialog"
      aria-controls="hq-accessible-draw-panel"
      :disabled="!ready"
      @click="openDrawPanel"
    >
      <span>画图</span>
      <strong>{{ activeDrawing || '选择工具' }}</strong>
    </button>

    <label class="hq-style-control">
      <span>样式</span>
      <select
        :value="preferences.drawType"
        :disabled="!ready"
        @change="emit('kline-style', Number($event.target.value))"
      >
        <option v-for="item in HQ_KLINE_STYLES" :key="item.id" :value="item.id">{{ item.label }}</option>
      </select>
    </label>

    <div class="hq-quick-draw" role="toolbar" aria-label="快捷画线">
      <button
        v-for="item in HQ_QUICK_DRAWINGS"
        :key="item.id"
        type="button"
        :class="{ active: activeDrawing === item.id }"
        :aria-pressed="activeDrawing === item.id"
        :disabled="!ready"
        @click="emit('draw', item.id)"
      >
        {{ item.label }}
      </button>
      <button
        type="button"
        class="primary"
        :aria-expanded="drawPanelOpen"
        aria-haspopup="dialog"
        aria-controls="hq-accessible-draw-panel"
        :disabled="!ready"
        @click="openDrawPanel"
      >
        更多画图
      </button>
    </div>

    <div class="hq-view-actions">
      <button type="button" :disabled="!ready" @click="emit('reset')">全览</button>
      <button type="button" :disabled="!ready" @click="emit('fullscreen')">全屏</button>
    </div>
    <small class="hq-data-note">
      本地日 K {{ rowCount }} 根 · Lab 日序列随周期末值采样 · HQ 原生指标默认关闭 · 仅白名单可选
    </small>

    <Teleport to="body">
      <div v-if="drawPanelOpen" class="hq-tool-backdrop" aria-hidden="true" @pointerdown="closeDrawPanel" />
      <section
        v-if="drawPanelOpen"
        id="hq-accessible-draw-panel"
        ref="drawPanel"
        class="hq-draw-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hq-draw-panel-title"
      >
        <header>
          <div>
            <strong id="hq-draw-panel-title">画图工具</strong>
            <small>选择后直接在 K 线图上点按或拖动</small>
          </div>
          <button type="button" aria-label="关闭画图工具面板" @click="closeDrawPanel">×</button>
        </header>

        <label class="hq-draw-style-control">
          <span>K 线样式</span>
          <select
            :value="preferences.drawType"
            :disabled="!ready"
            @change="emit('kline-style', Number($event.target.value))"
          >
            <option v-for="item in HQ_KLINE_STYLES" :key="item.id" :value="item.id">{{ item.label }}</option>
          </select>
        </label>

        <div class="hq-draw-groups">
          <fieldset v-for="group in drawingGroups" :key="group.id">
            <legend>{{ group.label }}</legend>
            <div>
              <button
                v-for="item in group.tools"
                :key="item.id"
                type="button"
                :class="{ active: activeDrawing === item.id }"
                :aria-pressed="activeDrawing === item.id"
                :disabled="!ready"
                @click="activateDrawing(item)"
              >
                <strong>{{ item.label }}</strong>
                <small>{{ item.hint }}</small>
              </button>
            </div>
          </fieldset>
        </div>

        <footer>
          <button type="button" :disabled="!ready" @click="emit('reset')">全览</button>
          <button type="button" :disabled="!ready" @click="emit('fullscreen')">全屏</button>
          <button type="button" class="hq-native-draw-launch" :disabled="!ready" @click="openNativeDrawTools">
            HQ 原生工具（桌面）
          </button>
        </footer>
      </section>
    </Teleport>
  </div>
</template>
