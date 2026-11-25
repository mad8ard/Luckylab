<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Activity } from 'lucide-vue-next'
import TopBar from './components/TopBar.vue'
import ChartWorkspace from './components/ChartWorkspace.vue'
import LeftPanel from './components/LeftPanel.vue'
import RightPanel from './components/RightPanel.vue'
import RecommendedPoolPage from './components/RecommendedPoolPage.vue'
import { useLabStore } from './stores/labStore.js'
import { clearPersistedLab, persistedRef } from './composables/usePersisted.js'
import { useBreakpoint } from './composables/useBreakpoint.js'
import stockIndex from './data/stock-index.json'

const lab = useLabStore()
const { isCompact } = useBreakpoint()
const mobileLeftOpen = ref(false)
const mobileRightOpen = ref(false)
const lastSampleId = persistedRef('lab.lastSampleId.v1', '')
const recommendedPoolMode = ref(isRecommendedPoolPath())

// 主题持久化
const theme = persistedRef('lab.theme.v1', 'light')
function applyTheme(t) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', t === 'dark')
}
applyTheme(theme.value)
watch(theme, applyTheme)
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

function resetWorkbench() {
  if (!confirm('清空所有持久化参数（输入、UI 状态、主题）并刷新？')) return
  clearPersistedLab()
  window.location.reload()
}

// 隐藏入口：连按 g p / Alt+P / 访问 #pool / 访问 ?pool=1 → 跳到推荐池静态页
const HIDDEN_POOL_PATH = '/recommended-pool/'
let chordTimer = null
let chordPrev = ''
function openRecommendedPool() {
  if (typeof window === 'undefined') return
  window.location.assign(HIDDEN_POOL_PATH)
}
function onHiddenKey(e) {
  if (e.key === 'Escape' && isCompact.value && (mobileLeftOpen.value || mobileRightOpen.value)) {
    closeMobileDrawers()
    return
  }
  // 在 input/textarea/contenteditable 中不响应
  const t = e.target
  const tag = t?.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return
  // Alt + P
  if (e.altKey && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault()
    openRecommendedPool()
    return
  }
  // 连按 g 然后 p
  const k = e.key?.toLowerCase()
  if (k === 'g') {
    chordPrev = 'g'
    clearTimeout(chordTimer)
    chordTimer = setTimeout(() => {
      chordPrev = ''
    }, 800)
    return
  }
  if (k === 'p' && chordPrev === 'g') {
    chordPrev = ''
    clearTimeout(chordTimer)
    openRecommendedPool()
    return
  }
  chordPrev = ''
}
function checkHiddenUrlEntry() {
  if (typeof window === 'undefined') return
  const hash = (window.location.hash || '').toLowerCase()
  const search = new URLSearchParams(window.location.search || '')
  if (hash === '#pool' || hash === '#recommended-pool' || search.get('pool') === '1') {
    openRecommendedPool()
  }
}

function isRecommendedPoolPath() {
  if (typeof window === 'undefined') return false
  return window.location.pathname.replace(/\/+$/, '').startsWith('/recommended-pool')
}

onMounted(() => {
  if (lastSampleId.value && !lab.rows.length) {
    const sample = allSamples.value.find((item) => item.id === lastSampleId.value)
    if (sample) lab.loadSample(sample)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onHiddenKey)
    checkHiddenUrlEntry()
  }
})
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onHiddenKey)
  }
  if (chordTimer) clearTimeout(chordTimer)
})

const effectiveLeftOpen = computed(() => (isCompact.value ? mobileLeftOpen.value : lab.leftPanelOpen))
const effectiveRightOpen = computed(() => (isCompact.value ? mobileRightOpen.value : lab.rightPanelOpen))

// 合并 marketSamples + stockIndex 给搜索
const allSamples = computed(() => {
  const curated = new Map(lab.marketSamples.map((s) => [s.symbol, s]))
  for (const s of stockIndex) {
    if (!curated.has(s.symbol)) curated.set(s.symbol, s)
  }
  return [...curated.values()]
})

// 决策摘要派生
const briefExtremeness = computed(() => lab.graph?.decision?.signalStrength ?? 0)

function onParamChange(field, value) {
  if (lab.input && field in lab.input) {
    lab.input[field] = value
  }
}

function onSetProfile(id) {
  lab.featureFlags.replayAutoProfile = false
  lab.input.strategyProfile = id
}
function onSetAutoProfile(v) {
  lab.featureFlags.replayAutoProfile = v
  if (v) lab.featureFlags.replayAccount = true
}

function selectSample(sample) {
  lastSampleId.value = sample.id
  lab.loadSample(sample)
  if (isCompact.value) closeMobileDrawers()
}

function toggleLeftPanel() {
  if (isCompact.value) {
    mobileLeftOpen.value = !mobileLeftOpen.value
    if (mobileLeftOpen.value) mobileRightOpen.value = false
    return
  }
  lab.toggleLeftPanel()
}

function toggleRightPanel() {
  if (isCompact.value) {
    mobileRightOpen.value = !mobileRightOpen.value
    if (mobileRightOpen.value) mobileLeftOpen.value = false
    return
  }
  lab.toggleRightPanel()
}

function openMobileLeft() {
  mobileLeftOpen.value = true
  mobileRightOpen.value = false
}

function openMobileRight() {
  mobileRightOpen.value = true
  mobileLeftOpen.value = false
}

function closeMobileDrawers() {
  mobileLeftOpen.value = false
  mobileRightOpen.value = false
}

// 拖宽逻辑（v3.2）
let dragging = null
let pendingW = 0
let rafId = null

function onResizerMouseDown(side, e) {
  dragging = side
  e.preventDefault()
  document.addEventListener('mousemove', onResizerMouseMove)
  document.addEventListener('mouseup', onResizerMouseUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onResizerMouseMove(e) {
  if (!dragging) return
  pendingW = dragging === 'left' ? e.clientX : window.innerWidth - e.clientX
  if (rafId) return
  rafId = requestAnimationFrame(flushW)
}

function flushW() {
  if (dragging === 'left') lab.setLeftPanelW(pendingW)
  if (dragging === 'right') lab.setRightPanelW(pendingW)
  rafId = null
}

function onResizerMouseUp() {
  dragging = null
  document.removeEventListener('mousemove', onResizerMouseMove)
  document.removeEventListener('mouseup', onResizerMouseUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

function onResizerDblclick(side) {
  side === 'left' ? lab.resetLeftPanelW() : lab.resetRightPanelW()
}

const rootStyle = computed(() => ({
  // 公式研究包含图形、输入输出与研究边界；桌面端至少保留可读宽度。
  '--left-w': `${lab.activeLeftTab === 'compute' ? Math.max(lab.leftPanelW, 360) : lab.leftPanelW}px`,
  '--right-w': `${lab.rightPanelW}px`,
}))
</script>

<template>
  <RecommendedPoolPage v-if="recommendedPoolMode" />
  <div
    v-else
    class="app-root"
    :class="{
      'left-collapsed': !effectiveLeftOpen,
      'right-collapsed': !effectiveRightOpen,
    }"
    :style="rootStyle"
  >
    <TopBar
      :source="lab.source"
      :market="lab.market"
      :rows="lab.rows"
      :decision="lab.graph?.decision"
      :extremeness="briefExtremeness"
      :profile-id="lab.input.strategyProfile"
      :auto-profile="lab.featureFlags.replayAutoProfile"
      :profile-list="lab.strategyProfileList"
      :recommended-id="lab.recommendedProfile?.id ?? 'balanced'"
      :theme="theme"
      @set-profile="onSetProfile"
      @set-auto-profile="onSetAutoProfile"
      @toggle-theme="toggleTheme"
      @reset="resetWorkbench"
      @mobile-open-left="openMobileLeft"
      @mobile-open-right="openMobileRight"
    />

    <div
      v-if="isCompact && (effectiveLeftOpen || effectiveRightOpen)"
      class="mobile-backdrop"
      @click="closeMobileDrawers"
    />

    <p v-if="lab.error" class="err-bar" :class="`kind-${lab.error.kind}`">
      <span class="err-msg">{{ lab.error.message }}</span>
      <button v-if="lab.error.sample" class="err-btn" :disabled="lab.loading" @click="lab.retryLast()">
        {{ lab.loading ? '重试中…' : '重试' }}
      </button>
      <button class="err-btn err-dismiss" @click="lab.dismissError()">关闭</button>
    </p>

    <div class="cols">
      <LeftPanel
        :open="effectiveLeftOpen"
        :active-tab="lab.activeLeftTab"
        :lab="lab"
        :theme="theme"
        @toggle="toggleLeftPanel"
        @set-tab="(name) => (lab.activeLeftTab = name)"
        @set-profile="onSetProfile"
        @set-auto-profile="onSetAutoProfile"
        @select-formula="lab.selectFormula"
        @override-tdpy="(sym, val) => lab.setTdpyOverride(sym, val)"
        @reset-tdpy="(sym) => lab.clearTdpyOverride(sym)"
        @set-theme="
          (t) => {
            theme.value = t
          }
        "
        @set-overlay="lab.setChartOverlay"
        @reset-all="resetWorkbench"
      />

      <div
        v-if="effectiveLeftOpen"
        class="resizer resizer-left"
        title="拖动调宽，双击重置"
        @mousedown="(e) => onResizerMouseDown('left', e)"
        @dblclick="onResizerDblclick('left')"
      />

      <main class="app-main">
        <ChartWorkspace
          v-if="lab.activeRows.length"
          :rows="lab.activeRows"
          :source="lab.source"
          :cost-path="lab.costPath"
          :formula-path="lab.formulaPath"
          :entry-price="lab.input.entryPrice"
          :replay="lab.replay"
          :market="lab.market"
          :decision="lab.graph?.decision"
          :position="lab.graph?.position"
          :summary="lab.workbenchSummary"
          :drawing-scope="lab.source?.id ?? lab.source?.symbol ?? ''"
          :overlays="lab.chartOverlays"
          :input="lab.input"
          :theme="theme"
          @param-change="onParamChange"
          @cursor-change="lab.setHoverIndex"
          @set-overlay="lab.setChartOverlay"
        />
        <div v-else class="empty-state">
          <Activity :size="36" />
          <strong>Market Lab</strong>
          <small v-if="lab.loading">加载中…{{ lab.loadingSampleId ? ' ' + lab.loadingSampleId : '' }}</small>
          <small v-else>右侧标的列表选品种加载（首次约 1~2 秒）</small>
        </div>
      </main>

      <div
        v-if="effectiveRightOpen"
        class="resizer resizer-right"
        title="拖动调宽，双击重置"
        @mousedown="(e) => onResizerMouseDown('right', e)"
        @dblclick="onResizerDblclick('right')"
      />

      <RightPanel
        :open="effectiveRightOpen"
        :samples="allSamples"
        :current-source="lab.source"
        :loading-sample-id="lab.loadingSampleId"
        @toggle="toggleRightPanel"
        @select-sample="selectSample"
      />
    </div>
  </div>
</template>
