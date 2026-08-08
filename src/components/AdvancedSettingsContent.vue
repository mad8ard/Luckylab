<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  tdpyMeta: { type: Object, required: true },
  effectiveTdpy: { type: Number, required: true },
  symbol: { type: String, default: '' },
})

const emit = defineEmits(['override', 'reset'])

const PRESETS = [
  { value: 365, label: '365' },
  { value: 252, label: '252' },
  { value: 242, label: '242' },
  { value: 179, label: '179' },
]

const customInput = ref('')

const isOverridden = computed(() => props.effectiveTdpy !== props.tdpyMeta.value)

function applyPreset(value) {
  if (!props.symbol) return
  emit('override', props.symbol, value)
}

function applyCustom() {
  const num = Number(customInput.value)
  if (!Number.isFinite(num) || num <= 0) {
    customInput.value = ''
    return
  }
  // clamp 到 60..400 防离谱值
  const clamped = Math.max(60, Math.min(400, Math.round(num)))
  emit('override', props.symbol, clamped)
  customInput.value = String(clamped)
}

function resetToAuto() {
  emit('reset', props.symbol)
}
</script>

<template>
  <div class="adv-content">
    <div class="adv-current-line">
      年时间基 <strong>{{ effectiveTdpy }}</strong>
      <em :class="['adv-source', { overridden: isOverridden }]">
        {{ isOverridden ? '已手动覆盖' : `按品种自动 · ${tdpyMeta.label}` }}
      </em>
    </div>
    <div class="adv-presets">
      <button
        v-for="p in PRESETS"
        :key="p.value"
        type="button"
        :class="['adv-preset', { active: effectiveTdpy === p.value }]"
        :disabled="!symbol"
        @click="applyPreset(p.value)"
      >{{ p.label }}</button>
      <label class="adv-custom">
        <span>自定义</span>
        <input v-model="customInput" type="number" min="60" max="400" placeholder="60-400" @keydown.enter="applyCustom" />
        <button type="button" :disabled="!symbol || !customInput" @click="applyCustom">应用</button>
      </label>
    </div>
    <button type="button" class="adv-reset" :disabled="!isOverridden" @click="resetToAuto">恢复自动</button>
    <p class="adv-hint">
      年时间基用于把日波动年化（IV、Δ 带、BS、路径回放共用）。日常无需调整；当数据集与默认市场口径不符时再手动覆盖。
    </p>
  </div>
</template>

<style>
.adv-content { display: grid; gap: 8px; }
.adv-current-line { font-size: 0.78rem; color: var(--ink); display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
.adv-current-line strong { font-variant-numeric: tabular-nums; }
.adv-source { font-style: normal; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); font-size: 0.62rem; }
.adv-source.overridden { border-color: #b8860b; color: #b8860b; }
.adv-presets { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.adv-preset { min-height: 26px; padding: 2px 9px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink); font-size: 0.74rem; font-weight: 700; cursor: pointer; }
.adv-preset.active { border-color: var(--green); background: var(--surface-active); }
.adv-preset:disabled { opacity: 0.4; cursor: not-allowed; }
.adv-custom { display: inline-flex; gap: 3px; align-items: center; font-size: 0.66rem; color: var(--muted); }
.adv-custom input { width: 70px; min-height: 26px; border: 1px solid var(--line); border-radius: 4px; padding: 2px 5px; background: var(--bg); color: var(--ink); font-variant-numeric: tabular-nums; }
.adv-custom button { min-height: 26px; padding: 1px 7px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink); font-size: 0.7rem; cursor: pointer; }
.adv-reset { width: fit-content; min-height: 26px; padding: 1px 9px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink); font-size: 0.7rem; cursor: pointer; }
.adv-reset:disabled { opacity: 0.4; cursor: not-allowed; }
.adv-hint { margin: 0; padding: 4px 0 0; color: var(--muted); font-size: 0.62rem; line-height: 1.4; border-top: 1px dashed var(--line); }
</style>
