<script setup>
import { useGraphLayout } from './composables/useGraphLayout.js'

const props = defineProps({
  activeId: { type: String, required: true },
})

const emit = defineEmits(['select-stage'])

const { nodes, edges, bounds } = useGraphLayout()

const svgW = Math.max(bounds.w, 900)
const svgH = Math.max(bounds.h, 640)

function labelClass(node) {
  return [
    'gn-label',
    node.stage.status === 'mapped' ? 'is-mapped' : 'is-live',
    node.stage.id === props.activeId ? 'is-active' : '',
  ].join(' ')
}

function pathD(edge) {
  const mx = (edge.x1 + edge.x2) / 2
  return `M${edge.x1},${edge.y1} C${mx},${edge.y1} ${mx},${edge.y2} ${edge.x2},${edge.y2}`
}

function edgeAlpha(edge) {
  return edge.source === props.activeId || edge.target === props.activeId ? 0.9 : 0.25
}
</script>

<template>
  <svg
    class="formula-graph-svg"
    :viewBox="`0 0 ${svgW} ${svgH}`"
    :style="{ width: '100%', height: 'auto', maxHeight: `${svgH}px` }"
  >
    <defs>
      <marker id="arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M0,0 L6,3 L0,6 Z" fill="var(--muted)" />
      </marker>
      <marker id="arrow-active" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M0,0 L6,3 L0,6 Z" fill="var(--green)" />
      </marker>
    </defs>

    <g v-for="edge in edges" :key="edge.id" class="gn-edge">
      <path
        :d="pathD(edge)"
        fill="none"
        stroke="var(--muted)"
        :stroke-width="edgeAlpha(edge) > 0.5 ? 1.2 : 0.7"
        :opacity="edgeAlpha(edge)"
        :marker-end="edgeAlpha(edge) > 0.5 ? 'url(#arrow-active)' : 'url(#arrow)'"
      />
    </g>

    <g
      v-for="node in nodes"
      :key="node.id"
      class="gn-node"
      :transform="`translate(${node.x}, ${node.y})`"
      :style="{ cursor: 'pointer' }"
      @click="emit('select-stage', node.stage.id)"
    >
      <rect
        x="0" y="0"
        :width="node.w" :height="node.h"
        rx="8"
        :fill="node.stage.id === activeId ? 'var(--surface-active)' : 'var(--panel)'"
        :stroke="node.stage.id === activeId ? 'var(--green)' : 'var(--line)'"
        :stroke-width="node.stage.id === activeId ? 1.5 : 1"
      />
      <text x="10" y="18" :class="labelClass(node)">{{ node.stage.label }}</text>
      <text x="10" y="36" class="gn-outputs">{{ node.stage.outputs.slice(0, 2).join(' / ') }}</text>
      <circle
        :cx="node.w - 8" cy="8" r="4"
        :fill="node.stage.status === 'implemented' ? 'var(--green)' : 'var(--muted)'"
      />
    </g>
  </svg>
</template>

<style>
.formula-graph-svg {
  display: block;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  overflow: hidden;
}

.gn-label { font-size: 11px; fill: var(--ink); font-weight: 700; }
.gn-label.is-mapped { fill: var(--muted); }
.gn-label.is-active { fill: var(--green); }
.gn-outputs { font-size: 9px; fill: var(--muted); }
</style>
