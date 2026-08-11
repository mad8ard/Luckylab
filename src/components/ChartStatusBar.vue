<script setup>
import { computed, nextTick, ref } from 'vue'
import ParamPopover from './ParamPopover.vue'

const props = defineProps({
  input: { type: Object, required: true },
})

const emit = defineEmits(['change'])

const openField = ref(null) // 'entryPrice' | 'iv' | 'deltaSlope' | 'exitTargetReturn' | null
const popoverWrapper = ref(null)

const FIELDS = [
  {
    id: 'entryPrice',
    label: '入场价',
    title: 'GetDelta 输入：入场价格',
    format: (v) => (Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—'),
  },
  {
    id: 'iv',
    label: 'IV',
    title: 'GetDelta 输入：年化波动率',
    format: (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—'),
  },
  {
    id: 'deltaSlope',
    label: 'd',
    title: 'GetDelta 输入：目标增量 d',
    format: (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—'),
  },
  {
    id: 'exitTargetReturn',
    label: '退出',
    title: '模拟退出目标收益',
    format: (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—'),
  },
]

function open(field) {
  openField.value = field
  // 下次微任务再绑外点击监听，避免捕获本次 click
  nextTick(() => {
    document.addEventListener('mousedown', onOutside)
  })
}

function close() {
  openField.value = null
  document.removeEventListener('mousedown', onOutside)
}

function onOutside(e) {
  if (popoverWrapper.value && !popoverWrapper.value.contains(e.target)) {
    close()
  }
}

function onConfirm(value) {
  emit('change', openField.value, value)
  close()
}

const currentValue = computed(() => (openField.value ? props.input[openField.value] : 0))
</script>

<template>
  <div class="chart-status-bar">
    <button
      v-for="f in FIELDS"
      :key="f.id"
      type="button"
      :class="['csb-chip', { open: openField === f.id }]"
      :title="f.title"
      @click="open(f.id)"
    >
      <span class="csb-label">{{ f.label }}</span>
      <strong>{{ f.format(input[f.id]) }}</strong>
      <span class="csb-arrow">▾</span>
    </button>

    <div v-if="openField" ref="popoverWrapper" class="csb-popover-wrap">
      <ParamPopover :field="openField" :value="currentValue" @confirm="onConfirm" @cancel="close" />
    </div>
  </div>
</template>

<style>
.chart-status-bar {
  position: relative;
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  z-index: 24;
  flex-wrap: wrap;
}
.csb-chip {
  display: inline-flex;
  gap: 4px;
  align-items: baseline;
  min-height: 28px;
  padding: 3px 9px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.84);
  backdrop-filter: blur(4px);
  color: var(--ink);
  cursor: pointer;
  font-size: 0.74rem;
}
.dark .csb-chip {
  background: rgba(34, 36, 31, 0.84);
}
.csb-chip:hover {
  border-color: var(--green);
}
.csb-chip.open {
  border-color: var(--green);
  background: var(--surface-active);
}
.csb-label {
  color: var(--muted);
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.csb-chip strong {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}
.csb-arrow {
  color: var(--muted);
  font-size: 0.62rem;
}
.csb-popover-wrap {
  position: absolute;
  top: calc(100% + 5px);
  right: 0;
}
@media (max-width: 1279px) {
  .chart-status-bar {
    justify-content: flex-start;
  }
  .csb-popover-wrap {
    right: auto;
    left: 0;
  }
}
@media (max-width: 640px) {
  .chart-status-bar {
    gap: 4px;
  }
  .csb-chip {
    min-height: 38px;
    padding: 4px 7px;
  }
}
</style>
