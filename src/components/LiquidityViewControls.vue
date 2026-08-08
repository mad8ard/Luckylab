<script setup>
defineProps({
  viewMode: { type: String, required: true },
  gapMode: { type: String, default: 'shortfall' },
})

defineEmits(['update:viewMode', 'update:gapMode'])

const viewModes = [
  { id: 'simulate', label: '模拟' },
  { id: 'real', label: '真实' },
  { id: 'compare', label: '对照' },
  { id: 'gap', label: '缺口' },
]

const gapModes = [
  { id: 'shortfall', label: '缺口' },
  { id: 'signed', label: '偏差' },
  { id: 'absolute', label: '反差' },
]
</script>

<template>
  <div class="lf-view-controls" aria-label="流动性视角">
    <div class="lf-segment-row">
      <button
        v-for="mode in viewModes"
        :key="mode.id"
        type="button"
        :class="{ active: viewMode === mode.id }"
        @click="$emit('update:viewMode', mode.id)"
      >
        {{ mode.label }}
      </button>
    </div>
    <div v-if="viewMode === 'gap'" class="lf-segment-row is-gap-style" aria-label="缺口风格">
      <button
        v-for="mode in gapModes"
        :key="mode.id"
        type="button"
        :class="{ active: gapMode === mode.id }"
        @click="$emit('update:gapMode', mode.id)"
      >
        {{ mode.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.lf-view-controls {
  display: grid;
  gap: 4px;
  padding: 4px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}

.lf-segment-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
}

.lf-segment-row.is-gap-style {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.lf-segment-row button {
  min-width: 0;
  min-height: 25px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  font-size: 0.58rem;
  font-weight: 900;
  cursor: pointer;
}

.lf-segment-row button:hover {
  border-color: var(--line);
  color: var(--green);
}

.lf-segment-row button.active {
  border-color: var(--green);
  background: var(--surface-active);
  color: var(--green);
}
</style>
