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
  {
    id: 'cost',
    label: '成本',
    val: fmt(props.market?.costAnchor),
    sub: pctFmt(props.market?.costDistance),
    tone: (props.market?.costDistance ?? 0) < 0 ? 'lo' : 'hi',
  },
  {
    id: 'volatility',
    label: '波动',
    val: pctFmt(props.market?.annualVol),
    sub: `ATR ${pctFmt(props.market?.atrPercent)}`,
  },
  {
    id: 'delta-band',
    label: 'Δ带',
    val: fmt(props.graph.deltaBands?.long?.low),
    sub: fmt(props.graph.deltaBands?.long?.high),
    tone: 'band',
  },
  {
    id: 'order-plan',
    label: '候选 / 执行',
    val: props.graph.plan?.primaryOrders?.length
      ? `${props.graph.plan.primaryOrders.length} 档模拟`
      : `候选${props.graph.decision?.candidateStatus ?? '等待'}`,
    sub: `市场结构 ${props.graph.decision?.state ?? '等待'} · ${executionLabel(props.graph.decision?.executionStatus)}`,
  },
])

function executionLabel(status) {
  return status === 'simulation-only' ? '仅模拟' : '不可执行'
}

function fmt(v) {
  return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—'
}
function pctFmt(v) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '—'
}

function nClass(n) {
  if (!n.tone) return ''
  return n.tone === 'lo'
    ? 'cf-lo'
    : n.tone === 'hi'
      ? 'cf-hi'
      : n.tone === 'up'
        ? 'cf-up'
        : n.tone === 'down'
          ? 'cf-down'
          : n.tone === 'band'
            ? 'cf-band'
            : ''
}
</script>

<template>
  <div class="cf-strip">
    <span class="cf-layer-tag">事实链</span>
    <ol class="cf-layer">
      <li v-for="n in pipeline" :key="n.id" class="cf-step">
        <button
          type="button"
          :class="['cf-node', nClass(n), { active: n.id === activeId }]"
          :aria-current="n.id === activeId ? 'step' : undefined"
          @click="emit('select', n.id)"
        >
          <span class="cf-label">{{ n.label }}</span>
          <span class="cf-val">{{ n.val }}</span>
          <span v-if="n.sub" class="cf-sub">{{ n.sub }}</span>
        </button>
      </li>
    </ol>
  </div>
</template>

<style>
.cf-strip {
  container-type: inline-size;
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 6px 8px 8px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}
.cf-layer {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cf-layer-tag {
  color: var(--green);
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.05em;
}
.cf-step {
  position: relative;
  min-width: 0;
}
.cf-step:not(:last-child)::after {
  content: '›';
  position: absolute;
  top: 50%;
  right: -8px;
  color: var(--muted);
  font-size: 0.86rem;
  line-height: 1;
  transform: translateY(-50%);
}
.cf-node {
  display: grid;
  gap: 2px;
  justify-items: center;
  width: 100%;
  min-width: 0;
  min-height: 48px;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 5px 4px;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
  transition: background 0.1s;
}
.cf-node:hover {
  background: var(--surface-alt);
}
.cf-node.active {
  border-color: var(--green);
  background: var(--surface-active);
}
.cf-node:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 1px;
}

.cf-label {
  min-width: 0;
  color: var(--green);
  font-size: 0.7rem;
  font-weight: 900;
  letter-spacing: 0.02em;
}
.cf-val {
  max-width: 100%;
  overflow-wrap: anywhere;
  font-size: 0.78rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.cf-sub {
  max-width: 100%;
  overflow-wrap: anywhere;
  color: var(--muted);
  font-size: 0.68rem;
}

.cf-lo .cf-val {
  color: var(--blue);
}
.cf-hi .cf-val {
  color: var(--red);
}
.cf-up .cf-val {
  color: var(--green);
}
.cf-down .cf-val {
  color: var(--red);
}
.cf-band .cf-val {
  color: var(--blue);
}

@container (max-width: 339px) {
  .cf-layer {
    grid-template-columns: 1fr;
    gap: 14px;
  }
  .cf-step:not(:last-child)::after {
    content: '↓';
    top: auto;
    right: auto;
    bottom: -13px;
    left: 18px;
    transform: none;
  }
  .cf-node {
    grid-template-columns: minmax(46px, auto) minmax(0, 1fr) minmax(0, auto);
    align-items: baseline;
    justify-items: start;
    min-height: 40px;
    padding: 7px 9px;
    text-align: left;
  }
  .cf-sub {
    justify-self: end;
    text-align: right;
  }
}
</style>
