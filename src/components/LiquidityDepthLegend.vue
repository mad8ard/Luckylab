<script setup>
import { computed } from 'vue'

const props = defineProps({
  model: { type: Object, required: true },
})

const items = computed(() => {
  const mode = props.model.effectiveViewMode ?? props.model.viewMode
  const rows = [
    { id: 'bid', label: '下侧密度' },
    { id: 'ask', label: '上侧密度' },
    { id: 'base', label: '底层' },
    { id: 'active', label: '现价' },
    { id: 'cost', label: '成本' },
    { id: 'orders', label: '挂单' },
    { id: 'range', label: '区间' },
  ]
  if (props.model.hasRealSignal && mode !== 'simulate') rows.splice(2, 0, { id: 'real', label: mode === 'gap' ? '缺口' : '真实池' })
  return rows
})
</script>

<template>
  <div class="lf-depth-legend" aria-label="图内颜色说明">
    <span v-for="item in items" :key="item.id" :class="`legend-${item.id}`">
      <i></i>{{ item.label }}
    </span>
  </div>
</template>

<style scoped>
.lf-depth-legend {
  position: absolute;
  right: 8px;
  bottom: 8px;
  left: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
  padding: 5px 6px;
  border: 1px solid rgba(215, 209, 194, 0.86);
  background: color-mix(in srgb, var(--surface) 90%, transparent);
}

.lf-depth-legend span {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  color: var(--muted);
  font-size: 8px;
  font-weight: 900;
  line-height: 1;
  white-space: nowrap;
}

.lf-depth-legend i {
  width: 10px;
  height: 5px;
  border: 1px solid transparent;
  background: var(--line);
}

.legend-bid i { background: linear-gradient(90deg, var(--blue), var(--green)); }
.legend-ask i { background: linear-gradient(90deg, var(--red), var(--blue)); }
.legend-real i { border-color: #8b5a16; background: rgba(139, 90, 22, 0.18); }
.legend-base i { background: var(--blue); }
.legend-active i { background: var(--green); }
.legend-cost i { background: var(--ink); }
.legend-orders i { background: var(--red); }
.legend-range i,
.legend-gap i { background: #8b5a16; }
</style>
