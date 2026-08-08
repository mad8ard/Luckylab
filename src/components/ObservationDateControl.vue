<script setup>
import { computed } from 'vue'

const props = defineProps({
  rows: { type: Array, required: true },
  cursor: { type: Number, required: true },
  observationDate: { type: String, default: '' },
})

const emit = defineEmits(['set-date', 'latest'])

const current = computed(() => props.rows[props.cursor] ?? null)
const firstDate = computed(() => props.rows[0]?.date ?? '')
const lastDate = computed(() => props.rows.at(-1)?.date ?? '')
const progress = computed(() => props.rows.length > 1 ? props.cursor / (props.rows.length - 1) : 1)
</script>

<template>
  <section class="odc">
    <header>
      <span>样本时间</span>
      <strong>{{ current?.date || '未载入' }}</strong>
    </header>
    <label>
      <span>As-of</span>
      <input
        type="date"
        :value="observationDate"
        :min="firstDate"
        :max="lastDate"
        :disabled="!rows.length"
        @input="emit('set-date', $event.target.value)"
      />
    </label>
    <input
      type="range"
      min="0"
      max="1"
      step="0.001"
      :value="progress"
      :disabled="!rows.length"
      @input="emit('set-date', rows[Math.round(Number($event.target.value) * (rows.length - 1))]?.date)"
    />
    <footer>
      <small>{{ firstDate || '—' }} → {{ lastDate || '—' }}</small>
      <button type="button" :disabled="!rows.length || cursor === rows.length - 1" @click="emit('latest')">样本最新</button>
    </footer>
    <p>每个数据源有自己的截止日期；主图、默认模拟和路径回放只使用该日期及之前的 K 线。</p>
  </section>
</template>

<style>
.odc { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-alt); }
.odc header,
.odc footer { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.odc header span,
.odc label span { color: var(--green); font-size: 0.62rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.odc header strong { font-size: 0.9rem; }
.odc label { display: grid; gap: 3px; }
.odc input[type="date"] { min-height: 28px; padding: 3px 7px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); font-size: 0.78rem; }
.odc input[type="range"] { width: 100%; accent-color: var(--green); }
.odc footer small,
.odc p { margin: 0; color: var(--muted); font-size: 0.66rem; line-height: 1.35; }
.odc button { min-height: 26px; padding: 2px 9px; border-radius: 5px; font-size: 0.7rem; }
</style>
