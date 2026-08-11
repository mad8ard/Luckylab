<script setup>
import { computed } from 'vue'
import { buildFormulaAvailabilityMap } from '../domain/formula-research/formulaAvailability.js'
import { formulaCapabilities, formulaStages } from '../domain/formulas/registry.js'

const props = defineProps({
  activeId: { type: String, required: true },
  graph: { type: Object, default: () => ({}) },
  market: { type: Object, default: null },
  rows: { type: Array, default: () => [] },
  costPath: { type: Array, default: () => [] },
  formulaPath: { type: Array, default: () => [] },
})

const emit = defineEmits(['select'])

const availability = computed(() =>
  buildFormulaAvailabilityMap({
    graph: props.graph,
    market: props.market,
    rows: props.rows,
    costPath: props.costPath,
    formulaPath: props.formulaPath,
  }),
)
const grouped = computed(() =>
  formulaCapabilities.map((cap) => ({
    ...cap,
    stages: cap.stages
      .map((sid) => formulaStages.find((stage) => stage.id === sid))
      .filter(Boolean)
      .map((stage) => ({ ...stage, availability: availability.value[stage.id] })),
  })),
)
</script>

<template>
  <nav class="fn-nav">
    <div v-for="cap in grouped" :key="cap.id" class="fn-group">
      <span class="fn-cap-label">{{ cap.label }}</span>
      <button
        v-for="stage in cap.stages"
        :key="stage.id"
        type="button"
        class="fn-item"
        :class="{ active: stage.id === activeId }"
        :title="`${stage.availability.label}：${stage.availability.missingInputs.length ? `缺少 ${stage.availability.missingText}` : stage.availability.boundary}`"
        @click="emit('select', stage.id)"
      >
        <span class="fn-dot" :class="`state-${stage.availability.tone}`" />
        <span class="fn-copy">
          <span class="fn-name">{{ stage.label }}</span>
          <span class="fn-out">{{ stage.outputs[0] }}</span>
        </span>
        <span class="fn-state" :class="`state-${stage.availability.tone}`">{{ stage.availability.label }}</span>
      </button>
    </div>
  </nav>
</template>

<style>
.fn-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.fn-group {
  display: grid;
  gap: 1px;
  margin-bottom: 6px;
}
.fn-cap-label {
  display: block;
  padding: 6px 8px 2px;
  color: var(--green);
  font-size: 0.6rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.fn-item {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-height: 36px;
  border: none;
  border-radius: 6px;
  padding: 4px 8px;
  background: transparent;
  color: var(--ink);
  font-size: 0.78rem;
  text-align: left;
  cursor: pointer;
  width: 100%;
}
.fn-item:hover {
  background: var(--surface-alt);
}
.fn-item.active {
  background: var(--surface-active);
  border: 1px solid var(--green);
  padding: 3px 7px;
}
.fn-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  flex-shrink: 0;
}
.fn-dot.state-viewable {
  background: var(--green);
}
.fn-dot.state-missing {
  background: var(--red);
}
.fn-dot.state-research {
  background: var(--blue);
}
.fn-dot.state-proxy {
  background: #a56d13;
}
.fn-dot.state-unverified {
  background: var(--muted);
}
.fn-dot.state-not-applicable {
  background: var(--muted);
}
.fn-dot.state-gate-failed {
  background: var(--red);
}
.fn-copy {
  min-width: 0;
  display: grid;
  gap: 1px;
}
.fn-name {
  font-weight: 700;
}
.fn-out {
  min-width: 0;
  font-size: 0.62rem;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fn-state {
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 1px 5px;
  font-size: 0.58rem;
  font-weight: 850;
  white-space: nowrap;
}
.fn-state.state-viewable {
  color: var(--green);
}
.fn-state.state-missing {
  color: var(--red);
}
.fn-state.state-research {
  color: var(--blue);
}
.fn-state.state-proxy {
  color: #8b5a16;
}
.fn-state.state-unverified {
  color: var(--muted);
}
.fn-state.state-not-applicable {
  color: var(--muted);
}
.fn-state.state-gate-failed {
  color: var(--red);
}
</style>
