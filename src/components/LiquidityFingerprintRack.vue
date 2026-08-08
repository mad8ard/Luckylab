<script setup>
import { computed, ref } from 'vue'
import { Maximize2, Minus, Plus, RotateCcw, X } from 'lucide-vue-next'
import { buildLiquidityRackModel } from '../domain/research-visualization/liquidityRackModel.js'
import LiquidityComponentStrip from './LiquidityComponentStrip.vue'
import LiquidityOpportunityPanel from './LiquidityOpportunityPanel.vue'
import LiquidityRackDepth from './LiquidityRackDepth.vue'
import LiquidityRouteStrip from './LiquidityRouteStrip.vue'
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

const compactModel = computed(() => rackModel({ binCount: 36, visibleWindow: 120 }))
const expandedModel = computed(() => rackModel({
  binCount: 48 + zoom.value * 24,
  visibleWindow: 120 + zoom.value * 40,
}))
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

function zoomBy(delta) {
  zoom.value = Math.max(0, Math.min(3, zoom.value + delta))
}

function resetZoom() {
  zoom.value = 1
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
      <div><b>{{ pct(compactModel.fingerprintStats?.entropy) }}</b><span>分散度</span></div>
      <div><b>{{ pct(compactModel.fingerprintStats?.orderShare) }}</b><span>挂单权重</span></div>
      <div><b>{{ compactModel.fingerprintStats?.modeCount ?? 0 }}</b><span>峰数</span></div>
    </footer>
  </aside>

  <Teleport to="body">
    <div v-if="expanded" class="lf-modal" tabindex="-1" @click.self="closeExpanded" @keydown.esc="closeExpanded">
      <section class="lf-panel">
        <header class="lf-panel-head">
          <div>
            <span>流动性指纹 · 精读仓</span>
            <strong>{{ expandedModel.meta.title }} / 密度 / 挂单刻度</strong>
          </div>
          <div class="lf-toolbar">
            <button type="button" title="缩小" :disabled="zoom <= 0" @click="zoomBy(-1)">
              <Minus :size="15" />
            </button>
            <button type="button" title="重置" @click="resetZoom">
              <RotateCcw :size="15" />
            </button>
            <button type="button" title="放大" :disabled="zoom >= 3" @click="zoomBy(1)">
              <Plus :size="15" />
            </button>
            <button type="button" title="关闭" @click="closeExpanded">
              <X :size="16" />
            </button>
          </div>
        </header>

        <div class="lf-panel-strip">
          <div><span>价格上沿</span><b>{{ fmt(expandedModel.range.upper) }}</b></div>
          <div><span>价格下沿</span><b>{{ fmt(expandedModel.range.lower) }}</b></div>
          <div><span>单档跨度</span><b>{{ fmt(expandedModel.priceStep) }}</b></div>
          <div><span>视图</span><b>{{ expandedModel.viewLabel }}</b></div>
          <div><span>LP 数据</span><b>{{ expandedModel.meta.lpModeLabel }}</b></div>
        </div>

        <LiquidityViewControls v-model:view-mode="viewMode" v-model:gap-mode="gapMode" />

        <div class="lf-explain">
          <article>
            <span>构成</span>
            <strong>{{ expandedModel.meta.compositionLabel }}</strong>
            <small>{{ expandedModel.meta.sourceLabel }}</small>
          </article>
          <article>
            <span>数据</span>
            <strong>{{ expandedModel.meta.dataLabel }}</strong>
            <small>{{ expandedModel.hasRealSignal ? `${expandedModel.shareLabel}用于观察策略意图和池状态是否同向。` : '真实层待接入，当前表格只显示模型参考。' }}</small>
          </article>
          <article>
            <span>目的</span>
            <strong>解释挂单在目标密度上的位置</strong>
            <small>{{ expandedModel.meta.purpose[0] }}</small>
          </article>
          <article>
            <span>增强</span>
            <strong>真实层、模拟层、对照和缺口可切换</strong>
            <small>{{ expandedModel.meta.nextInputs.slice(0, 2).join(' / ') }}</small>
          </article>
        </div>

        <div class="lf-analysis-grid">
          <div class="lf-analysis-meta">
            <LiquidityComponentStrip :model="expandedModel" />
            <LiquidityOpportunityPanel :model="expandedModel" :precision="precision" />
            <div class="lf-layer-row">
              <div v-for="layer in expandedModel.meta.layers" :key="layer.label">
                <b>{{ layer.label }}</b>
                <span>{{ layer.value }}</span>
                <small>{{ layer.note }}</small>
              </div>
            </div>
            <LiquidityRouteStrip :model="expandedModel" :precision="precision" />
          </div>

          <LiquidityRackDepth :model="expandedModel" variant="expanded" :precision="precision" show-table />
        </div>
      </section>
    </div>
  </Teleport>
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
.lf-range b,
.lf-panel-head span,
.lf-panel-strip span {
  color: var(--green);
  font-size: 0.58rem;
  font-weight: 900;
  letter-spacing: 0.05em;
}

.lf-head strong {
  font-size: 0.9rem;
  line-height: 1.05;
}

.lf-actions { display: flex !important; flex-direction: column; align-items: flex-end; gap: 4px; }

.lf-actions button,
.lf-toolbar button { display: grid; place-items: center; width: 28px; height: 26px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); cursor: pointer; }

.lf-actions button:hover,
.lf-toolbar button:hover:not(:disabled) {
  border-color: var(--green);
  color: var(--green);
}

.lf-toolbar button:disabled { opacity: 0.45; cursor: not-allowed; }

.lf-actions em { border: 1px solid var(--line); border-radius: 999px; padding: 1px 6px; color: var(--muted); font-size: 0.56rem; font-style: normal; font-weight: 900; white-space: nowrap; }

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

.lf-modal {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(16, 18, 15, 0.42);
}

.lf-panel {
  width: min(1120px, 96vw);
  height: min(820px, 92vh);
  display: grid;
  grid-template-rows: auto auto auto auto minmax(0, 1fr);
  border: 1px solid var(--line);
  background: var(--surface);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.24);
}

.lf-panel-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}

.lf-panel-head div:first-child {
  display: grid;
  gap: 2px;
}

.lf-panel-head strong {
  font-size: 1rem;
}

.lf-toolbar {
  display: flex;
  gap: 6px;
}

.lf-panel-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1px;
  border-bottom: 1px solid var(--line);
  background: var(--line);
}

.lf-analysis-grid { min-height: 0; display: grid; grid-template-columns: minmax(260px, 0.72fr) minmax(620px, 1.5fr); border-top: 1px solid var(--line); }
.lf-analysis-meta { min-width: 0; min-height: 0; overflow: auto; border-right: 1px solid var(--line); background: var(--surface); }
.lf-analysis-meta .lf-layer-row { grid-template-columns: 1fr; }
.lf-analysis-meta :deep(.lf-components) { grid-template-columns: repeat(2, minmax(0, 1fr)); }

.lf-explain,
.lf-layer-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  border-bottom: 1px solid var(--line);
  background: var(--line);
}

.lf-explain article,
.lf-layer-row div {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 8px 10px;
  background: var(--surface);
}

.lf-explain strong,
.lf-layer-row b {
  font-size: 0.78rem;
  line-height: 1.25;
}

.lf-explain small,
.lf-layer-row span,
.lf-layer-row small {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--muted);
  font-size: 0.68rem;
  line-height: 1.3;
}

.lf-layer-row small {
  color: var(--ink);
}

.lf-panel-strip div {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 8px 10px;
  background: var(--panel);
}

.lf-panel-strip b {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.92rem;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 768px) {
  .lf-modal {
    padding: 8px;
  }

  .lf-panel {
    width: 100%;
    height: 94vh;
  }

  .lf-panel-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .lf-explain,
  .lf-layer-row,
  .lf-analysis-grid {
    grid-template-columns: 1fr;
  }

  .lf-analysis-meta { border-right: 0; border-bottom: 1px solid var(--line); }
}
</style>
