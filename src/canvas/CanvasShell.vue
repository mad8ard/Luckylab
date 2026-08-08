<script setup>
import { useCanvasZoom } from './composables/useCanvasZoom.js'

const { zoomState, transformStyle } = useCanvasZoom()
</script>

<template>
  <div class="canvas-shell">
    <div class="canvas-world" :style="{ transform: transformStyle, transformOrigin: '0 0' }">
      <slot />
    </div>
    <div class="canvas-hud">
      <span class="zoom-badge">{{ Math.round(zoomState.zoom * 100) }}%</span>
    </div>
  </div>
</template>

<style>
.canvas-shell {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background-color: var(--bg);
  background-image: radial-gradient(circle, var(--line) 1px, transparent 1px);
  background-size: 30px 30px;
}

.canvas-world {
  will-change: transform;
  width: 0;
  height: 0;
}

.canvas-hud {
  position: fixed;
  bottom: 12px;
  right: 12px;
  z-index: 100;
  display: flex;
  gap: 6px;
}

.zoom-badge {
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 5px 10px;
  background: var(--panel);
  color: var(--muted);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}
</style>
