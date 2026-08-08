<script setup>
import { computed, reactive, ref } from 'vue'
import { GripVertical, Minimize2, X } from 'lucide-vue-next'

const props = defineProps({
  title: { type: String, default: '' },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  initDetached: { type: Boolean, default: false },
})

const detached = ref(props.initDetached)
const minimized = ref(false)
const pos = reactive({ x: props.x, y: props.y })
const dragging = ref(false)
const dragStart = { x: 0, y: 0 }
const cardRef = ref(null)
const z = ref(1)

function onDragStart(event) {
  if (event.button !== 0) return
  if (event.target.closest('button, input, select')) return
  dragging.value = true
  dragStart.x = event.clientX - pos.x
  dragStart.y = event.clientY - pos.y
  z.value = Date.now() % 999
  detached.value = true
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(event) {
  if (!dragging.value) return
  pos.x = event.clientX - dragStart.x
  pos.y = event.clientY - dragStart.y
}

function onDragEnd() {
  dragging.value = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}

const style = computed(() =>
  detached.value
    ? { position: 'absolute', left: `${pos.x}px`, top: `${pos.y}px`, zIndex: z.value }
    : {}
)
</script>

<template>
  <div
    ref="cardRef"
    class="dnd-card"
    :class="{ detached, minimized, dragging }"
    :style="style"
  >
    <div class="dnd-bar" data-card-drag @mousedown="onDragStart">
      <GripVertical :size="14" class="dnd-grip" />
      <span class="dnd-title">{{ title }}</span>
      <button type="button" class="dnd-act" :title="minimized ? '展开' : '最小化'" @click.stop="minimized = !minimized">
        <Minimize2 :size="13" />
      </button>
      <button type="button" class="dnd-act" :title="detached ? '停靠' : '分离'" @click.stop="detached = !detached">
        <X :size="13" :style="{ transform: detached ? 'none' : 'rotate(45deg)' }" />
      </button>
    </div>
    <div v-show="!minimized" class="dnd-body">
      <slot />
    </div>
  </div>
</template>

<style>
.dnd-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  transition: box-shadow 0.15s;
}
.dnd-card.detached {
  box-shadow: 0 4px 24px rgba(0,0,0,0.12);
  min-width: 280px;
}
.dnd-card.minimized .dnd-body { display: none; }
.dnd-card.dragging { opacity: 0.92; cursor: grabbing; }

.dnd-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-alt);
  border-radius: 8px 8px 0 0;
  cursor: grab;
  user-select: none;
}
.dnd-bar:active { cursor: grabbing; }
.dnd-grip { color: var(--muted); flex-shrink: 0; }
.dnd-title { font-size: 0.72rem; font-weight: 800; color: var(--muted); letter-spacing: 0.04em; text-transform: uppercase; flex: 1; }
.dnd-act { display: grid; place-items: center; width: 22px; height: 22px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--muted); padding: 0; }
.dnd-act:hover { border-color: var(--green); }
.dnd-body { padding: 0; }
</style>
