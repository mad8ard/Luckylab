<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { HQ_MAIN_INDICATORS, HQ_SUB_INDICATORS } from '../infrastructure/charting/hqChartCatalog.js'
import { formatFormulaInputList, formatFormulaReasonList } from '../domain/formula-research/formulaInputLabels.js'

const props = defineProps({
  preferences: { type: Object, required: true },
  overlays: { type: Object, required: true },
  researchModel: { type: Object, default: null },
  ready: { type: Boolean, default: false },
})

const emit = defineEmits(['main-index', 'sub-index-1', 'sub-index-2', 'set-overlay', 'panel-change'])
const root = ref(null)
const panel = ref(null)
const openLayer = ref('')
let returnFocusTarget = null

const INTERNAL_REASONS = new Set([
  'finite-output-available',
  'no-finite-output',
  'overlay-disabled',
  'research-estimate',
  'current-formula-output-unavailable',
])

const MISSING_HINTS = Object.freeze({
  lpBand: '需要动态周期、波动率与成本锚；仅为公式研究区间，不代表真实 LP 仓位',
  executionMarkers: '需要持仓目标价或失效价',
  greeksPane: '需要期权 Delta、Gamma 或 Theta 情景输入',
  lpPane: '需要完整 LP 情景，或可估值的链上真实仓位；池聚合报价本身不能估值',
  carryPane: '需要 Funding 或持仓归因输入',
  equityPane: '需要先完成回放并生成权益曲线',
})

const labToggles = Object.freeze([
  { key: 'priceBands', label: '研究价格层', group: 'price', parent: true },
  { key: 'costBand', label: '成本锚带', group: 'price', child: true },
  { key: 'volBand', label: '动态周期 GetDelta 路径', group: 'price', child: true },
  { key: 'lpBand', label: 'LP 动态公式研究区间', group: 'price', child: true },
  { key: 'entryLine', label: '入场价线', group: 'price' },
  { key: 'executionMarkers', label: '目标 / 失效价格线', group: 'price' },
  { key: 'volume', label: '成交量', group: 'volume' },
  { key: 'greeksPane', label: '期权 Greeks', group: 'greeks' },
  { key: 'lpPane', label: 'LP 情景与池状态', group: 'lp' },
  { key: 'carryPane', label: 'Funding / 持仓归因', group: 'carry' },
  { key: 'equityPane', label: '回放权益', group: 'equity' },
  { key: 'kdjPane', label: 'Lab KDJ', group: 'kdj' },
  { key: 'rsiPane', label: 'Lab RSI（自定义缩放）', group: 'rsi' },
])

const activeLabCount = computed(() => props.researchModel?.activeSeriesCount ?? 0)
const availableLabCount = computed(() => props.researchModel?.availableSeriesCount ?? 0)
const hqSummary = computed(() => {
  const items = [props.preferences.mainIndex, props.preferences.subIndex1, props.preferences.subIndex2]
  return items.filter((item) => item && item !== 'EMPTY').join(' · ') || '空'
})

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('pointerdown', onPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('pointerdown', onPointerDown)
  setAppInert(false)
})

async function toggleLayer(layer) {
  if (openLayer.value === layer) return closeLayer()
  returnFocusTarget = document.activeElement
  openLayer.value = layer
  setAppInert(true)
  emit('panel-change', { open: true, layer })
  await nextTick()
  panel.value?.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled)')?.focus()
}

function closeLayer(restoreFocus = true) {
  const target = returnFocusTarget
  openLayer.value = ''
  returnFocusTarget = null
  setAppInert(false)
  emit('panel-change', { open: false, layer: '' })
  if (restoreFocus) nextTick(() => target?.isConnected && target.focus?.())
}

function onKeydown(event) {
  if (!openLayer.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeLayer()
    return
  }
  if (event.key !== 'Tab') return
  trapPanelFocus(event)
}

function onPointerDown(event) {
  if (!openLayer.value) return
  if (root.value?.contains(event.target) || panel.value?.contains(event.target)) return
  closeLayer()
}

function availability(option) {
  const direct = props.researchModel?.controls?.[option.key]
  if (direct) return direct
  const group = props.researchModel?.groups?.find((item) => item.id === option.group)
  if (group) return group
  return { state: 'missing-input', reason: '当前没有可绘制输出' }
}

function statusLabel(option) {
  const item = availability(option)
  if (suppressedByParent(option)) return '待开启主层'
  if (item.current && item.state === 'not-applicable') return '当前结构不适用'
  if (item.current && item.state === 'model-gate-failed') return '当前门禁未通过'
  if (item.current && item.state === 'missing-input') return '缺少当前输入'
  if (item.state === 'missing-input') return '缺少输入'
  if (!props.overlays[option.key]) return '已关闭'
  const count = item.outputCount ?? item.series?.length ?? 0
  if (item.state === 'estimated') return count ? `研究估算 · ${count} 条曲线` : '研究估算'
  if (item.state === 'ready') return `${count} 条曲线`
  return '暂未绘制'
}

function canToggle(option) {
  const state = availability(option).state
  return state === 'ready' || state === 'estimated' || Boolean(props.overlays[option.key])
}

function suppressedByParent(option) {
  return option.child && props.overlays.priceBands === false
}

function reasonLabel(option) {
  if (suppressedByParent(option)) return '此项已选；开启“研究价格层”后才会绘制。'
  const item = availability(option)
  if (item.current) {
    const boundary = item.historicalOutputCount
      ? '历史稀疏分段仍显示；当前观察日不生成右侧带值。'
      : '当前观察日没有合法 GetDelta 上下沿。'
    if (item.blockedReasons?.length) return `${formatFormulaReasonList(item.blockedReasons)}；${boundary}`
    if (item.missing?.length) return `缺少：${formatFormulaInputList(item.missing)}；${boundary}`
    return boundary
  }
  if (item.state !== 'missing-input') return ''
  const reason = String(item.reason || '')
  if (reason && !INTERNAL_REASONS.has(reason) && !/^[a-z\d_-]+$/i.test(reason)) return reason
  return MISSING_HINTS[option.key] ?? '当前数据没有提供此研究层所需的输入。'
}

function reasonId(option) {
  return `hq-layer-reason-${option.key}`
}

function trapPanelFocus(event) {
  const focusable = [
    ...(panel.value?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? []),
  ]
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && (document.activeElement === first || !panel.value?.contains(document.activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function setAppInert(value) {
  const app = document.getElementById('app')
  if (!app) return
  if (value) app.setAttribute('inert', '')
  else app.removeAttribute('inert')
}

defineExpose({
  closePanel: (restoreFocus = false) => closeLayer(restoreFocus),
})
</script>

<template>
  <div ref="root" class="hq-indicator-layers">
    <button
      type="button"
      class="hq-layer-trigger lab"
      :class="{ active: openLayer === 'lab' }"
      :aria-expanded="openLayer === 'lab'"
      aria-haspopup="dialog"
      aria-controls="hq-lab-indicator-panel"
      :disabled="!ready"
      @click="toggleLayer('lab')"
    >
      <span class="hq-layer-label hq-layer-label-desktop">Lab 研究层</span>
      <span class="hq-layer-label hq-layer-label-mobile">Lab 层</span>
      <strong>{{ activeLabCount }}/{{ availableLabCount }} 条曲线</strong>
    </button>
    <button
      type="button"
      class="hq-layer-trigger"
      :class="{ active: openLayer === 'hq' }"
      :aria-expanded="openLayer === 'hq'"
      aria-haspopup="dialog"
      aria-controls="hq-native-indicator-panel"
      :disabled="!ready"
      @click="toggleLayer('hq')"
    >
      <span class="hq-layer-label hq-layer-label-desktop">HQ 通用指标</span>
      <span class="hq-layer-label hq-layer-label-mobile">HQ 指标</span>
      <strong>{{ hqSummary }}</strong>
    </button>

    <Teleport to="body">
      <div v-if="openLayer" class="hq-tool-backdrop" aria-hidden="true" @pointerdown.stop="closeLayer" />
      <section
        v-if="openLayer === 'lab'"
        id="hq-lab-indicator-panel"
        ref="panel"
        class="hq-layer-panel lab"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hq-lab-indicator-title"
      >
        <header>
          <div>
            <strong id="hq-lab-indicator-title">Market Lab 研究层</strong>
            <small>Lab 统一建模公式、本地行情与用户输入；HQChart 只负责绘制</small>
          </div>
          <button type="button" aria-label="关闭 Lab 研究层面板" @click="closeLayer">×</button>
        </header>
        <div class="hq-lab-toggle-grid">
          <label
            v-for="option in labToggles"
            :key="option.key"
            class="hq-lab-toggle"
            :class="{
              child: option.child,
              parent: option.parent,
              suppressed: suppressedByParent(option),
              unavailable: !canToggle(option),
            }"
            :title="reasonLabel(option)"
          >
            <input
              type="checkbox"
              :checked="Boolean(overlays[option.key])"
              :disabled="!ready || !canToggle(option)"
              :aria-describedby="reasonLabel(option) ? reasonId(option) : undefined"
              @change="emit('set-overlay', option.key, $event.target.checked)"
            />
            <span class="hq-layer-name">{{ option.label }}</span>
            <small :data-state="availability(option).state">{{ statusLabel(option) }}</small>
            <small v-if="reasonLabel(option)" :id="reasonId(option)" class="hq-layer-reason">
              {{ reasonLabel(option) }}
            </small>
          </label>
        </div>
      </section>

      <section
        v-if="openLayer === 'hq'"
        id="hq-native-indicator-panel"
        ref="panel"
        class="hq-layer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hq-native-indicator-title"
      >
        <header>
          <div>
            <strong id="hq-native-indicator-title">HQChart 通用指标</strong>
            <small>辅助技术指标，不替代 Lab 公式口径</small>
          </div>
          <button type="button" aria-label="关闭 HQ 指标面板" @click="closeLayer">×</button>
        </header>
        <div class="hq-native-slots">
          <label>
            <span>HQ 主图</span>
            <select :value="preferences.mainIndex" :disabled="!ready" @change="emit('main-index', $event.target.value)">
              <option v-for="item in HQ_MAIN_INDICATORS" :key="item.id" :value="item.id">{{ item.label }}</option>
            </select>
          </label>
          <label>
            <span>HQ 副图 1</span>
            <select
              :value="preferences.subIndex1"
              :disabled="!ready"
              @change="emit('sub-index-1', $event.target.value)"
            >
              <option v-for="item in HQ_SUB_INDICATORS" :key="item.id" :value="item.id">{{ item.label }}</option>
            </select>
          </label>
          <label>
            <span>HQ 副图 2</span>
            <select
              :value="preferences.subIndex2"
              :disabled="!ready"
              @change="emit('sub-index-2', $event.target.value)"
            >
              <option v-for="item in HQ_SUB_INDICATORS" :key="item.id" :value="item.id">{{ item.label }}</option>
            </select>
          </label>
        </div>
      </section>
    </Teleport>
  </div>
</template>
