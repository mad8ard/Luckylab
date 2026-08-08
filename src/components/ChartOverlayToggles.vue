<script setup>
import { CHART_OVERLAY_TOGGLES } from './chartOverlayToggles.js'

defineProps({
  overlays: { type: Object, required: true },
})
</script>

<template>
  <div class="cot-grid">
    <label v-for="t in CHART_OVERLAY_TOGGLES" :key="t.key" class="cot-row">
      <input v-model="overlays[t.key]" type="checkbox" />
      <span>{{ t.label }}</span>
    </label>
  </div>
</template>

<style>
.cot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; }
.cot-row { display: flex; gap: 7px; align-items: center; padding: 5px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); cursor: pointer; }
.cot-row:has(input:checked) { border-color: var(--green); background: var(--surface-active); }
.cot-row input { margin: 0; }
.cot-row span { color: var(--ink); font-size: 0.78rem; font-weight: 600; }
</style>
