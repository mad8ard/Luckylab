import { computed, onBeforeUnmount, onMounted, reactive, readonly } from 'vue'

export function useCanvasZoom() {
  const state = reactive({
    panX: 0,
    panY: 0,
    zoom: 1,
  })

  let dragging = false
  let lastX = 0
  let lastY = 0
  let velX = 0
  let velY = 0
  let inertiaFrame = null
  const MIN_ZOOM = 0.2
  const MAX_ZOOM = 4

  function onWheel(event) {
    const rect = document.activeElement?.closest('.canvas-shell')?.getBoundingClientRect()
    if (!rect) return
    event.preventDefault()
    const cx = event.clientX - rect.left
    const cy = event.clientY - rect.top

    const factor = event.deltaY > 0 ? 0.9 : 1.1
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom * factor))

    state.panX = cx - (cx - state.panX) * (nextZoom / state.zoom)
    state.panY = cy - (cy - state.panY) * (nextZoom / state.zoom)
    state.zoom = nextZoom
  }

  function onMouseDown(event) {
    if (event.button !== 0) return
    const target = event.target
    if (target.closest('button, input, select, a, textarea')) return
    if (target.closest('[data-card-drag]')) return
    dragging = true
    lastX = event.clientX
    lastY = event.clientY
    cancelInertia()
  }

  function onMouseMove(event) {
    if (!dragging) return
    velX = event.clientX - lastX
    velY = event.clientY - lastY
    state.panX += velX
    state.panY += velY
    lastX = event.clientX
    lastY = event.clientY
  }

  function onMouseUp() {
    if (!dragging) return
    dragging = false
    if (Math.abs(velX) > 1 || Math.abs(velY) > 1) startInertia()
  }

  function startInertia() {
    cancelInertia()
    const friction = 0.9
    const min = 0.15
    function step() {
      velX *= friction
      velY *= friction
      state.panX += velX
      state.panY += velY
      if (Math.abs(velX) < min && Math.abs(velY) < min) { cancelInertia(); return }
      inertiaFrame = requestAnimationFrame(step)
    }
    inertiaFrame = requestAnimationFrame(step)
  }

  function cancelInertia() { if (inertiaFrame) { cancelAnimationFrame(inertiaFrame); inertiaFrame = null } }

  function reset() { cancelInertia(); state.panX = 0; state.panY = 0; state.zoom = 1 }

  const transformStyle = computed(() =>
    `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`
  )

  onMounted(() => {
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('mousedown', onMouseDown)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    cancelInertia()
  })

  return { zoomState: readonly(state), transformStyle, reset }
}
