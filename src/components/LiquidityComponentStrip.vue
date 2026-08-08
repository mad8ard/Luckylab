<script setup>
import { computed } from 'vue'

const props = defineProps({
  model: { type: Object, required: true },
})

const rows = computed(() => {
  const names = { base: '底层', active: '现价', cost: '成本', orders: '挂单', range: '区间' }
  return (props.model.components ?? [])
    .map((component) => ({
      id: component.id,
      label: names[component.id] ?? component.id,
      value: component.normalizedWeight,
    }))
    .filter((row) => Number.isFinite(row.value) && row.value > 0.001)
})

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '-'
}
</script>

<template>
  <div class="lf-components" aria-label="指纹模型权重">
    <div v-for="component in rows" :key="component.id" :class="`is-${component.id}`">
      <span>{{ component.label }}</span>
      <b>{{ pct(component.value) }}</b>
    </div>
  </div>
</template>

<style scoped>
.lf-components {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1px;
  border-bottom: 1px solid var(--line);
  background: var(--line);
}

.lf-components div {
  min-width: 0;
  padding: 5px 6px;
  background: var(--surface);
  border-top: 3px solid var(--line);
}

.lf-components span {
  display: block;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.52rem;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lf-components b {
  display: block;
  color: var(--ink);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.is-base { border-top-color: var(--blue) !important; }
.is-active { border-top-color: var(--green) !important; }
.is-cost { border-top-color: var(--ink) !important; }
.is-orders { border-top-color: var(--red) !important; }
.is-range { border-top-color: #8b5a16 !important; }
</style>
