<script setup>
import { computed, onMounted, ref } from 'vue'

/**
 * 单字段编辑 popover
 *
 * field: 'entryPrice' | 'iv' | 'holdingDays' | 'deltaSlope' | 'exitTargetReturn'
 *
 * 单位转换：
 *   - iv / deltaSlope / exitTargetReturn 内部存 0~5 浮点（0.4 = 40%），UI 显示 0~500 整数
 *   - entryPrice / holdingDays 直传
 *
 * 校验：
 *   - entryPrice > 0
 *   - iv: 1 ≤ ui ≤ 500（即 0.01 ≤ store ≤ 5）
 *   - holdingDays: 1 ≤ ui ≤ 365 整数
 *   - deltaSlope: 1 ≤ ui ≤ 500，对应 GetDelta 里的目标增量 d
 *   - exitTargetReturn: 0 ≤ ui ≤ 500，对应执行退出收益目标
 */
const props = defineProps({
  field: { type: String, required: true },
  value: { type: Number, required: true },
})

const emit = defineEmits(['confirm', 'cancel'])

const META = {
  entryPrice:   { label: '入场价',  unit: '',  step: 0.01, min: 0.01, max: 1e9, scale: 1 },
  iv:           { label: '波动率',  unit: '%', step: 0.5,  min: 1,    max: 500, scale: 0.01 },
  holdingDays:  { label: '持仓窗口', unit: '天', step: 1,    min: 1,    max: 365, scale: 1, integer: true },
  deltaSlope: { label: '目标增量 d', unit: '%', step: 0.5,  min: 1,    max: 500, scale: 0.01 },
  exitTargetReturn: { label: '退出目标', unit: '%', step: 0.5, min: 0, max: 500, scale: 0.01 },
}

const meta = computed(() => META[props.field] ?? META.entryPrice)

const inputValue = ref('')
const inputEl = ref(null)

onMounted(() => {
  inputValue.value = String(props.value / meta.value.scale)
  // 自动聚焦 + 全选
  inputEl.value?.focus()
  inputEl.value?.select()
})

const numericInput = computed(() => Number(inputValue.value))
const isValid = computed(() => {
  const n = numericInput.value
  if (!Number.isFinite(n)) return false
  if (n < meta.value.min || n > meta.value.max) return false
  if (meta.value.integer && !Number.isInteger(n)) return false
  return true
})

function confirm() {
  if (!isValid.value) return
  const final = numericInput.value * meta.value.scale
  emit('confirm', final)
}

function cancel() {
  emit('cancel')
}
</script>

<template>
  <div class="param-popover">
    <header>{{ meta.label }}</header>
    <label>
      <input
        ref="inputEl"
        v-model="inputValue"
        type="number"
        :min="meta.min"
        :max="meta.max"
        :step="meta.step"
        :class="{ invalid: !isValid }"
        @keydown.enter.prevent="confirm"
        @keydown.escape.prevent="cancel"
      />
      <span v-if="meta.unit">{{ meta.unit }}</span>
    </label>
    <div class="pp-actions">
      <button type="button" :disabled="!isValid" @click="confirm">应用</button>
      <button type="button" class="pp-cancel" @click="cancel">取消</button>
    </div>
  </div>
</template>

<style>
.param-popover { width: 220px; padding: 10px 12px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 6px 18px rgba(0,0,0,0.12); display: grid; gap: 8px; }
.param-popover header { color: var(--green); font-size: 0.62rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.param-popover label { display: flex; gap: 4px; align-items: baseline; }
.param-popover input { flex: 1; min-height: 30px; padding: 4px 7px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); font-variant-numeric: tabular-nums; font-size: 0.86rem; }
.param-popover input.invalid { border-color: #b8860b; }
.param-popover label span { color: var(--muted); font-size: 0.7rem; }
.pp-actions { display: flex; gap: 6px; justify-content: flex-end; }
.pp-actions button { min-height: 26px; padding: 1px 10px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink); font-size: 0.74rem; font-weight: 800; cursor: pointer; }
.pp-actions button:disabled { opacity: 0.4; cursor: not-allowed; }
.pp-actions button:not(:disabled):not(.pp-cancel):hover { border-color: var(--green); }
.pp-cancel { color: var(--muted); }
</style>
