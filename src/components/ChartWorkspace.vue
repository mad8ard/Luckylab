<script setup>
import { computed, ref } from 'vue'
import MainChart from './MainChart.vue'
import ChartEngineSwitcher from './ChartEngineSwitcher.vue'
import { useChartWorkspace } from '../composables/useChartWorkspace.js'

defineProps({
  rows: { type: Array, required: true },
  source: { type: Object, default: null },
  costPath: { type: Array, required: true },
  formulaPath: { type: Array, required: true },
  entryPrice: { type: Number, required: true },
  replay: { type: Object, required: true },
  market: { type: Object, default: null },
  decision: { type: Object, default: null },
  position: { type: Object, default: null },
  summary: { type: Object, default: null },
  drawingScope: { type: String, default: '' },
  overlays: { type: Object, required: true },
  input: { type: Object, required: true },
  theme: { type: String, default: 'light' },
})

const emit = defineEmits(['cursor-change', 'param-change', 'set-overlay'])
const workspace = useChartWorkspace()
const hqRuntimeLoading = ref(false)
const showHq = computed(
  () => Boolean(workspace.hqComponent.value) && (workspace.isHq.value || workspace.isHqPending.value),
)
const switchLoading = computed(
  () =>
    workspace.isHqPending.value ||
    (workspace.isHq.value && workspace.hqLoadState.value === 'loading') ||
    hqRuntimeLoading.value,
)

function changeEngine(engine) {
  if (engine === workspace.engine.value && !workspace.isHqPending.value) return
  emit('cursor-change', null)
  if (engine === 'lightweight') hqRuntimeLoading.value = false
  workspace.selectEngine(engine)
}

function handleHqFailure(error) {
  hqRuntimeLoading.value = false
  workspace.fallbackToLight(error)
}

function handleHqReady() {
  hqRuntimeLoading.value = false
  workspace.confirmHqReady()
}
</script>

<template>
  <div class="chart-workspace">
    <MainChart
      v-if="!showHq"
      :rows="rows"
      :cost-path="costPath"
      :formula-path="formulaPath"
      :entry-price="entryPrice"
      :replay="replay"
      :market="market"
      :decision="decision"
      :position="position"
      :summary="summary"
      :drawing-scope="drawingScope"
      :overlays="overlays"
      :input="input"
      @param-change="(field, value) => emit('param-change', field, value)"
      @cursor-change="(index) => emit('cursor-change', index)"
      @set-overlay="(key, value) => emit('set-overlay', key, value)"
    >
      <template #engine-switch>
        <ChartEngineSwitcher
          :engine="workspace.engine.value"
          :loading="switchLoading"
          :error="workspace.fallbackError.value"
          @change="changeEngine"
          @retry="workspace.retryHq"
        />
      </template>
    </MainChart>

    <component
      :is="workspace.hqComponent.value"
      v-else
      :rows="rows"
      :source="source"
      :cost-path="costPath"
      :formula-path="formulaPath"
      :entry-price="entryPrice"
      :replay="replay"
      :position="position"
      :overlays="overlays"
      :drawing-scope="drawingScope"
      :summary="summary"
      :theme="theme"
      @cursor-change="(index) => emit('cursor-change', index)"
      @loading-change="(value) => (hqRuntimeLoading = value)"
      @fatal-error="handleHqFailure"
      @ready="handleHqReady"
      @set-overlay="(key, value) => emit('set-overlay', key, value)"
    >
      <template #engine-switch>
        <ChartEngineSwitcher
          :engine="workspace.engine.value"
          :loading="switchLoading"
          :error="workspace.fallbackError.value"
          @change="changeEngine"
          @retry="workspace.retryHq"
        />
      </template>
    </component>
  </div>
</template>
