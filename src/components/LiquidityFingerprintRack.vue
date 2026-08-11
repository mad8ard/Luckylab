<script setup>
import { computed, ref } from 'vue'
import { Maximize2 } from 'lucide-vue-next'
import { buildLiquidityRackModel } from '../domain/research-visualization/liquidityRackModel.js'
import LiquidityComponentStrip from './LiquidityComponentStrip.vue'
import LiquidityFingerprintExpanded from './LiquidityFingerprintExpanded.vue'
import LiquidityOpportunityPanel from './LiquidityOpportunityPanel.vue'
import LiquidityRackDepth from './LiquidityRackDepth.vue'
import LiquidityViewControls from './LiquidityViewControls.vue'

const props = defineProps({
  rows: { type: Array, required: true },
  costPath: { type: Array, required: true },
  formulaPath: { type: Array, required: true },
  graph: { type: Object, required: true },
  activeIndex: { type: Number, required: true },
})

const expanded = ref(false)
const zoom = ref(1)
const viewMode = ref('compare')
const gapMode = ref('shortfall')

const compactModel = computed(() => rackModel({ binCount: 36 }))
const expandedModel = computed(() =>
  rackModel({
    binCount: 48 + zoom.value * 24,
  }),
)
const precision = computed(() => {
  const step = expanded.value ? expandedModel.value.priceStep : compactModel.value.priceStep
  if (!Number.isFinite(step)) return 2
  if (step < 0.01) return 6
  if (step < 1) return 4
  return 2
})

function rackModel(extra) {
  return buildLiquidityRackModel({
    rows: props.rows,
    costPath: props.costPath,
    formulaPath: props.formulaPath,
    graph: props.graph,
    activeIndex: props.activeIndex,
    viewMode: viewMode.value,
    gapMode: gapMode.value,
    ...extra,
  })
}

function openExpanded() {
  expanded.value = true
}

function closeExpanded() {
  expanded.value = false
}

function fmt(value, digits = precision.value) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value)
    : '-'
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(0)}%` : '-'
}
</script>

<template>
  <aside class="lf-rack" aria-label="流动性指纹挂单分布仓">
    <header class="lf-head">
      <div>
        <span>流动性指纹</span>
        <strong>{{ compactModel.meta.title }}</strong>
      </div>
      <div class="lf-actions">
        <button type="button" title="展开精读" @click="openExpanded">
          <Maximize2 :size="14" />
        </button>
        <em>研究层</em>
      </div>
    </header>

    <div class="lf-source">
      <b>{{ compactModel.meta.orderLabel }}</b>
      <span>{{ compactModel.meta.compositionLabel }}</span>
    </div>

    <LiquidityViewControls v-model:view-mode="viewMode" v-model:gap-mode="gapMode" />

    <LiquidityComponentStrip :model="compactModel" />
    <LiquidityOpportunityPanel :model="compactModel" :precision="precision" />

    <div class="lf-range">
      <span>{{ fmt(compactModel.range.upper) }}</span>
      <b>{{ compactModel.inputMode === 'hybrid-model' ? '混合模型' : `${compactModel.binCount} 档` }}</b>
      <span>{{ fmt(compactModel.range.lower) }}</span>
    </div>

    <LiquidityRackDepth :model="compactModel" variant="compact" :precision="precision" />

    <footer class="lf-foot">
      <div>
        <b>{{ pct(compactModel.fingerprintStats?.entropy) }}</b
        ><span>分散度</span>
      </div>
      <div>
        <b>{{ pct(compactModel.fingerprintStats?.orderShare) }}</b
        ><span>挂单权重</span>
      </div>
      <div>
        <b>{{ compactModel.fingerprintStats?.modeCount ?? 0 }}</b
        ><span>峰数</span>
      </div>
    </footer>
  </aside>

  <LiquidityFingerprintExpanded
    v-if="expanded"
    v-model:view-mode="viewMode"
    v-model:gap-mode="gapMode"
    v-model:zoom="zoom"
    :model="expandedModel"
    :precision="precision"
    @close="closeExpanded"
  />
</template>

<style scoped>
.lf-rack {
  display: grid;
  grid-template-rows: auto auto auto auto minmax(0, 1fr) auto;
  min-width: 0;
  border-left: 1px solid var(--line);
  background: var(--surface);
}

.lf-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 9px 7px;
  border-bottom: 1px solid var(--line);
}

.lf-head div {
  display: grid;
  gap: 1px;
}

.lf-head span,
.lf-range b {
  color: var(--green);
  font-size: 0.58rem;
  font-weight: 900;
  letter-spacing: 0.05em;
}

.lf-head strong {
  font-size: 0.9rem;
  line-height: 1.05;
}

.lf-actions {
  display: flex !important;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.lf-actions button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 26px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--bg);
  color: var(--ink);
  cursor: pointer;
}

.lf-actions button:hover {
  border-color: var(--green);
  color: var(--green);
}

.lf-actions em {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 1px 6px;
  color: var(--muted);
  font-size: 0.56rem;
  font-style: normal;
  font-weight: 900;
  white-space: nowrap;
}

.lf-source {
  display: grid;
  gap: 2px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}

.lf-source b {
  color: var(--ink);
  font-size: 0.62rem;
}

.lf-source span {
  color: var(--muted);
  font-size: 0.56rem;
  line-height: 1.25;
}

.lf-range {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 6px;
  align-items: center;
  padding: 5px 8px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 0.62rem;
  font-variant-numeric: tabular-nums;
}

.lf-range span:last-child {
  text-align: right;
}

.lf-foot {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  border-top: 1px solid var(--line);
}

.lf-foot div {
  display: grid;
  gap: 1px;
  min-width: 0;
  padding: 6px 7px;
  background: var(--panel);
}

.lf-foot b {
  color: var(--green);
  font-size: 0.82rem;
  line-height: 1;
}

.lf-foot span {
  color: var(--muted);
  font-size: 0.53rem;
  font-weight: 800;
  white-space: nowrap;
}
</style>
