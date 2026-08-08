<script setup>
import { computed } from 'vue'

const props = defineProps({
  model: { type: Object, required: true },
  precision: { type: Number, default: 2 },
})

const signal = computed(() => props.model.opportunity ?? {})
const topZone = computed(() => signal.value.zones?.shortfall?.[0] ?? signal.value.zones?.divergence?.[0] ?? null)

function fmt(value, digits = props.precision) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value)
    : '-'
}

function pct(value) {
  if (!Number.isFinite(value)) return '-'
  if (value > 0 && value < 0.001) return '<0.1%'
  return `${(value * 100).toFixed(1)}%`
}

function zoneLabel(zone) {
  if (!zone) return '等待价格带'
  return `${fmt(zone.lower)} - ${fmt(zone.upper)}`
}
</script>

<template>
  <section :class="['lf-opportunity', `tone-${signal.tone || 'pending'}`]" aria-label="流动性情绪机会信号">
    <header>
      <span>情绪信号</span>
      <strong>{{ signal.label }}</strong>
      <b>{{ pct(signal.confidence) }}</b>
    </header>
    <div class="lf-opportunity-main">
      <div>
        <span>交易机会</span>
        <strong>{{ signal.action }}</strong>
      </div>
      <div>
        <span>优先价格带</span>
        <strong>{{ zoneLabel(topZone) }}</strong>
      </div>
    </div>
    <div class="lf-opportunity-evidence">
      <div v-for="item in signal.evidence" :key="item.label">
        <span>{{ item.label }}</span>
        <b>{{ pct(item.value) }}</b>
      </div>
      <div v-if="!signal.evidence?.length">
        <span>状态</span>
        <b>{{ signal.action }}</b>
      </div>
    </div>
  </section>
</template>

<style scoped>
.lf-opportunity {
  display: grid;
  gap: 1px;
  border-bottom: 1px solid var(--line);
  background: var(--line);
}

.lf-opportunity header,
.lf-opportunity-main,
.lf-opportunity-evidence {
  min-width: 0;
  background: var(--surface);
}

.lf-opportunity header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: end;
  padding: 7px 9px;
}

.lf-opportunity span {
  color: var(--green);
  font-size: 0.56rem;
  font-weight: 900;
  letter-spacing: 0.04em;
}

.lf-opportunity strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
  line-height: 1.1;
}

.lf-opportunity header b {
  color: var(--ink);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

.lf-opportunity-main {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  background: var(--line);
}

.lf-opportunity-main div,
.lf-opportunity-evidence div {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 7px 9px;
  background: var(--panel);
}

.lf-opportunity-evidence {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1px;
  background: var(--line);
}

.lf-opportunity-evidence b {
  color: var(--ink);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
}

.tone-bullish header {
  box-shadow: inset 3px 0 0 var(--green);
}

.tone-bearish header {
  box-shadow: inset 3px 0 0 var(--red);
}

.tone-crowded header {
  box-shadow: inset 3px 0 0 #8b5a16;
}

.tone-pending header {
  box-shadow: inset 3px 0 0 var(--line);
}
</style>
