<script setup>
import { formulaCapabilities, formulaStages } from '../domain/formulas/registry.js'

defineProps({
  activeId: { type: String, required: true },
})

const emit = defineEmits(['select'])

const grouped = formulaCapabilities.map((cap) => ({
  ...cap,
  stages: cap.stages.map((sid) => formulaStages.find((s) => s.id === sid)).filter(Boolean),
}))
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
        @click="emit('select', stage.id)"
      >
        <span class="fn-dot" :class="stage.status === 'implemented' ? 'live' : 'mapped'" />
        <span class="fn-name">{{ stage.label }}</span>
        <span class="fn-out">{{ stage.outputs[0] }}</span>
      </button>
    </div>
  </nav>
</template>

<style>
.fn-nav { display: flex; flex-direction: column; gap: 2px; }
.fn-group { display: grid; gap: 1px; margin-bottom: 6px; }
.fn-cap-label { display: block; padding: 6px 8px 2px; color: var(--green); font-size: 0.6rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.fn-item { display: grid; grid-template-columns: 8px 1fr auto; gap: 8px; align-items: center; min-height: 32px; border: none; border-radius: 6px; padding: 4px 8px; background: transparent; color: var(--ink); font-size: 0.78rem; text-align: left; cursor: pointer; width: 100%; }
.fn-item:hover { background: var(--surface-alt); }
.fn-item.active { background: var(--surface-active); border: 1px solid var(--green); padding: 3px 7px; }
.fn-dot { width: 6px; height: 6px; border-radius: 999px; flex-shrink: 0; }
.fn-dot.live { background: var(--green); }
.fn-dot.mapped { background: var(--muted); }
.fn-name { font-weight: 700; }
.fn-out { font-size: 0.66rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100px; }
</style>
