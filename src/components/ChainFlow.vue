<script setup>
import { computed } from 'vue'

const props = defineProps({
  graph: { type: Object, required: true },
  market: { type: Object, default: null },
  activeId: { type: String, default: 'delta-band' },
})

const emit = defineEmits(['select'])

const pipeline = computed(() => [
  { id: 'path', label: '路径', val: props.market?.rows ? `${props.market.rows}条` : '—' },
  { id: 'cost', label: '成本', val: fmt(props.market?.costAnchor), sub: pctFmt(props.market?.costDistance), tone: (props.market?.costDistance ?? 0) < 0 ? 'lo' : 'hi' },
  { id: 'volatility', label: '波动', val: pctFmt(props.market?.annualVol), sub: `ATR ${pctFmt(props.market?.atrPercent)}` },
  { id: 'delta-band', label: 'Δ带', val: fmt(props.graph.deltaBands?.long?.low), sub: fmt(props.graph.deltaBands?.long?.high), tone: 'band' },
  { id: 'order-plan', label: '条件', val: props.graph.plan?.primaryOrders?.length ? `${props.graph.plan.primaryOrders.length}档` : '未触发', sub: props.graph.decision?.state ?? '等待' },
])

function fmt(v) { return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—' }
function pctFmt(v) { return Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '—' }

function nClass(n) {
  if (!n.tone) return ''
  return n.tone === 'lo' ? 'cf-lo' : n.tone === 'hi' ? 'cf-hi' : n.tone === 'up' ? 'cf-up' : n.tone === 'down' ? 'cf-down' : n.tone === 'band' ? 'cf-band' : ''
}
</script>

<template>
  <div class="cf-strip">
    <div class="cf-layer">
      <span class="cf-layer-tag">事实链</span>
      <template v-for="(n, i) in pipeline" :key="n.id">
        <button :class="['cf-node', nClass(n), { active: n.id === activeId }]" @click="emit('select', n.id)">
          <span class="cf-label">{{ n.label }}</span>
          <span class="cf-val">{{ n.val }}</span>
          <span v-if="n.sub" class="cf-sub">{{ n.sub }}</span>
        </button>
        <span v-if="i < pipeline.length - 1" class="cf-arrow">→</span>
      </template>
    </div>
  </div>
</template>

<style>
.cf-strip { display: flex; flex-direction: column; gap: 2px; padding: 4px 8px; border-bottom: 1px solid var(--line); background: var(--panel); }
.cf-layer { display: flex; align-items: flex-start; gap: 0; min-height: 32px; overflow-x: auto; }
.cf-layer-tag { flex-shrink: 0; font-size: 0.52rem; font-weight: 900; color: var(--green); letter-spacing: 0.05em; text-transform: uppercase; padding: 8px 8px 0 0; min-width: 40px; text-align: right; }

.cf-node { display: grid; gap: 1px; justify-items: center; min-width: 62px; border: 1px solid transparent; border-radius: 5px; padding: 4px 6px; background: transparent; color: var(--ink); cursor: pointer; flex-shrink: 0; transition: background 0.1s; }
.cf-node:hover { background: var(--surface-alt); }
.cf-node.active { border-color: var(--green); background: var(--surface-active); }

.cf-label { font-size: 0.56rem; font-weight: 900; color: var(--green); letter-spacing: 0.03em; text-transform: uppercase; }
.cf-val { font-size: 0.72rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.cf-sub { font-size: 0.56rem; color: var(--muted); }
.cf-arrow { font-size: 0.62rem; color: var(--muted); padding: 9px 3px 0; flex-shrink: 0; }

.cf-lo .cf-val { color: var(--blue); }
.cf-hi .cf-val { color: var(--red); }
.cf-up .cf-val { color: var(--green); }
.cf-down .cf-val { color: var(--red); }
.cf-band .cf-val { color: var(--blue); }
</style>
