<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  profileId: { type: String, required: true },
  autoProfile: { type: Boolean, required: true },
  profileList: { type: Array, required: true },
  recommendedId: { type: String, default: 'balanced' },
})

const emit = defineEmits(['set', 'set-auto'])

const open = ref(false)
const wrapper = ref(null)

const TONES = {
  conservative: 'tone-blue',
  balanced:     'tone-green',
  aggressive:   'tone-orange',
}

const activeLabel = computed(() => {
  const id = props.autoProfile ? props.recommendedId : props.profileId
  return props.profileList.find(p => p.id === id)?.label ?? '均衡'
})

const tone = computed(() => {
  if (props.autoProfile) return 'tone-neutral'
  return TONES[props.profileId] ?? 'tone-neutral'
})

function toggle() {
  open.value = !open.value
  if (open.value) {
    setTimeout(() => document.addEventListener('mousedown', onOutside), 0)
  }
}

function close() {
  open.value = false
  document.removeEventListener('mousedown', onOutside)
}

function onOutside(e) {
  if (wrapper.value && !wrapper.value.contains(e.target)) close()
}

function setAuto() { emit('set-auto', true); close() }
function set(id) { emit('set', id); close() }

onBeforeUnmount(() => document.removeEventListener('mousedown', onOutside))
</script>

<template>
  <div ref="wrapper" :class="['profile-chip', tone]">
    <button type="button" class="pc-trigger" @click="toggle">
      <span class="pc-dot" />
      {{ autoProfile ? `回放选档 · ${activeLabel}` : activeLabel }}
      <span class="pc-arrow">▾</span>
    </button>
    <ul v-if="open" class="pc-menu">
      <li :class="{ active: autoProfile }" @click="setAuto">
        <span class="pc-dot tone-neutral" />
        回放选档
      </li>
      <li
        v-for="p in profileList"
        :key="p.id"
        :class="['pc-item', `tone-${p.id === 'conservative' ? 'blue' : p.id === 'balanced' ? 'green' : 'orange'}`, { active: !autoProfile && profileId === p.id }]"
        @click="set(p.id)"
      >
        <span class="pc-dot" />
        {{ p.label }}
      </li>
    </ul>
  </div>
</template>

<style>
.profile-chip { position: relative; }
.pc-trigger { display: inline-flex; gap: 5px; align-items: center; min-height: 28px; padding: 3px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--ink); cursor: pointer; font-size: 0.74rem; font-weight: 700; }
.pc-trigger:hover { border-color: var(--green); }
.pc-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); display: inline-block; }
.tone-blue .pc-dot, .pc-item.tone-blue .pc-dot { background: #1f5fbf; }
.tone-green .pc-dot, .pc-item.tone-green .pc-dot { background: #0e7558; }
.tone-orange .pc-dot, .pc-item.tone-orange .pc-dot { background: #b8860b; }
.tone-neutral .pc-dot { background: var(--muted); }
.tone-blue .pc-trigger { border-color: #1f5fbf; }
.tone-green .pc-trigger { border-color: #0e7558; }
.tone-orange .pc-trigger { border-color: #b8860b; }
.pc-arrow { color: var(--muted); font-size: 0.62rem; }
.pc-menu { position: absolute; top: 32px; right: 0; min-width: 160px; padding: 4px; margin: 0; list-style: none; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.12); z-index: 25; }
.pc-menu li { display: flex; gap: 6px; align-items: center; padding: 5px 9px; border-radius: 5px; cursor: pointer; font-size: 0.78rem; }
.pc-menu li:hover { background: var(--surface-alt); }
.pc-menu li.active { background: var(--surface-active); font-weight: 700; }
</style>
