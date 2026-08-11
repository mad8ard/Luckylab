<script setup>
import { Minus, Plus, RotateCcw, X } from 'lucide-vue-next'
import LiquidityComponentStrip from './LiquidityComponentStrip.vue'
import LiquidityOpportunityPanel from './LiquidityOpportunityPanel.vue'
import LiquidityRackDepth from './LiquidityRackDepth.vue'
import LiquidityRouteStrip from './LiquidityRouteStrip.vue'
import LiquidityViewControls from './LiquidityViewControls.vue'

const props = defineProps({
  model: { type: Object, required: true },
  precision: { type: Number, required: true },
  zoom: { type: Number, required: true },
  viewMode: { type: String, required: true },
  gapMode: { type: String, required: true },
})

const emit = defineEmits(['close', 'update:zoom', 'update:viewMode', 'update:gapMode'])

function zoomBy(delta) {
  emit('update:zoom', Math.max(0, Math.min(3, props.zoom + delta)))
}

function resetZoom() {
  emit('update:zoom', 1)
}

function fmt(value, digits = props.precision) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value)
    : '-'
}
</script>

<template>
  <Teleport to="body">
    <div class="lf-modal" tabindex="-1" @click.self="emit('close')" @keydown.esc="emit('close')">
      <section class="lf-panel">
        <header class="lf-panel-head">
          <div>
            <span>流动性指纹 · 精读仓</span>
            <strong>{{ model.meta.title }} / 密度 / 挂单刻度</strong>
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
            <button type="button" title="关闭" @click="emit('close')">
              <X :size="16" />
            </button>
          </div>
        </header>

        <div class="lf-panel-strip">
          <div>
            <span>价格上沿</span><b>{{ fmt(model.range.upper) }}</b>
          </div>
          <div>
            <span>价格下沿</span><b>{{ fmt(model.range.lower) }}</b>
          </div>
          <div>
            <span>单档跨度</span><b>{{ fmt(model.priceStep) }}</b>
          </div>
          <div>
            <span>视图</span><b>{{ model.viewLabel }}</b>
          </div>
          <div>
            <span>LP 数据</span><b>{{ model.meta.lpModeLabel }}</b>
          </div>
        </div>

        <LiquidityViewControls
          :view-mode="viewMode"
          :gap-mode="gapMode"
          @update:view-mode="emit('update:viewMode', $event)"
          @update:gap-mode="emit('update:gapMode', $event)"
        />

        <div class="lf-explain">
          <article>
            <span>构成</span>
            <strong>{{ model.meta.compositionLabel }}</strong>
            <small>{{ model.meta.sourceLabel }}</small>
          </article>
          <article>
            <span>数据</span>
            <strong>{{ model.meta.dataLabel }}</strong>
            <small>{{
              model.hasRealSignal
                ? `${model.shareLabel}用于观察策略意图和 tick 深度是否同向。`
                : '真实 tick 深度待接入；聚合池报价只作校准代理。'
            }}</small>
          </article>
          <article>
            <span>目的</span>
            <strong>解释挂单在目标密度上的位置</strong>
            <small>{{ model.meta.purpose[0] }}</small>
          </article>
          <article>
            <span>增强</span>
            <strong>真实层、模拟层、对照和缺口可切换</strong>
            <small>{{ model.meta.nextInputs.slice(0, 2).join(' / ') }}</small>
          </article>
        </div>

        <div class="lf-analysis-grid">
          <div class="lf-analysis-meta">
            <LiquidityComponentStrip :model="model" />
            <LiquidityOpportunityPanel :model="model" :precision="precision" />
            <div class="lf-layer-row">
              <div v-for="layer in model.meta.layers" :key="layer.label">
                <b>{{ layer.label }}</b>
                <span>{{ layer.value }}</span>
                <small>{{ layer.note }}</small>
              </div>
            </div>
            <LiquidityRouteStrip :model="model" :precision="precision" />
          </div>

          <LiquidityRackDepth :model="model" variant="expanded" :precision="precision" show-table />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
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

.lf-panel-head span,
.lf-panel-strip span {
  color: var(--green);
  font-size: 0.58rem;
  font-weight: 900;
  letter-spacing: 0.05em;
}

.lf-panel-head strong {
  font-size: 1rem;
}

.lf-toolbar {
  display: flex;
  gap: 6px;
}

.lf-toolbar button {
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

.lf-toolbar button:hover:not(:disabled) {
  border-color: var(--green);
  color: var(--green);
}

.lf-toolbar button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.lf-panel-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1px;
  border-bottom: 1px solid var(--line);
  background: var(--line);
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

.lf-analysis-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(260px, 0.72fr) minmax(620px, 1.5fr);
  border-top: 1px solid var(--line);
}

.lf-analysis-meta {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border-right: 1px solid var(--line);
  background: var(--surface);
}

.lf-analysis-meta .lf-layer-row {
  grid-template-columns: 1fr;
}

.lf-analysis-meta :deep(.lf-components) {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

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

  .lf-analysis-meta {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
}
</style>
