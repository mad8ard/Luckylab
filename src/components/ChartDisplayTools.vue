<script setup>
const props = defineProps({
  overlays: { type: Object, required: true },
  ready: { type: Boolean, default: true },
  chipAvailable: { type: Boolean, default: true },
})

const emit = defineEmits(['set-overlay'])

function toggle(key, available = true) {
  if (!props.ready || !available || !Object.hasOwn(props.overlays, key)) return
  emit('set-overlay', key, !props.overlays[key])
}
</script>

<template>
  <div class="chart-display-tools" role="toolbar" aria-label="成交与筹码显示工具">
    <span class="chart-display-tools-label">显示</span>
    <button
      type="button"
      :class="{ active: overlays.volume !== false }"
      :aria-pressed="overlays.volume !== false"
      :disabled="!ready"
      title="显示或隐藏 OHLCV 成交量副图"
      @click="toggle('volume')"
    >
      成交量
    </button>
    <button
      type="button"
      class="chart-chip-tool"
      :class="{ active: overlays.stockChipProfile !== false }"
      :aria-pressed="overlays.stockChipProfile !== false"
      :disabled="!ready || !chipAvailable"
      :title="chipAvailable ? '显示或隐藏成交量按价格分布代理' : '筹码图在桌面宽度显示'"
      @click="toggle('stockChipProfile', chipAvailable)"
    >
      筹码
    </button>
    <span class="chart-scale-badge" title="主图价格轴默认使用对数坐标">主图 Log</span>
  </div>
</template>

<style>
.chart-display-tools {
  flex: 0 0 auto;
  display: flex;
  gap: 3px;
  align-items: center;
  min-width: max-content;
}
.chart-display-tools-label {
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
}
.chart-display-tools button,
.chart-scale-badge {
  min-height: 30px;
  padding: 3px 7px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--surface);
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}
.chart-display-tools button {
  cursor: pointer;
}
.chart-display-tools button.active {
  border-color: var(--green);
  background: var(--green-dim);
  color: var(--green);
}
.chart-display-tools button:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}
.chart-scale-badge {
  display: grid;
  place-items: center;
  border-style: dashed;
  background: transparent;
  color: var(--green);
}
.chart-display-tools :focus-visible {
  outline: 3px solid color-mix(in srgb, var(--green) 58%, white);
  outline-offset: 2px;
}
</style>
