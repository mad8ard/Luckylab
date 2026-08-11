import { computed, ref, shallowRef, watch } from 'vue'
import {
  CHART_DRAWING_TYPES,
  createHorizontalDrawing,
  createTwoPointDrawing,
  normalizeChartTime,
  replaceDrawing,
  sanitizeDrawingLibrary,
  sanitizeDrawings,
  updateDrawingAnchor,
} from '../domain/workbench/chartDrawings.js'

const STORAGE_KEY = 'lab.chartDrawings.v1'
const TOOLS = Object.freeze(['cursor', 'select', ...CHART_DRAWING_TYPES])
const HISTORY_LIMIT = 50

export function useChartDrawings({ getChart, getSeries, getPrimitive, getScope, getLayer }) {
  const tool = ref('cursor')
  const drawings = ref([])
  const selectedId = ref(null)
  const draft = ref(null)
  const undoStack = ref([])
  const redoStack = ref([])
  const activeDrag = shallowRef(null)
  let activeScope = ''
  let idSequence = 0
  let attached = false

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  const canDelete = computed(
    () => Boolean(selectedId.value) && drawings.value.some((drawing) => drawing.id === selectedId.value),
  )
  const inputActive = computed(() => tool.value !== 'cursor')
  const sessionState = computed(() => {
    if (activeDrag.value) return 'editing'
    if (draft.value) return 'placing'
    return tool.value === 'cursor' ? 'idle' : 'armed'
  })
  const helpText = computed(() => {
    if (tool.value === 'horizontal') return '点一下价格位置，添加水平线'
    if (tool.value === 'trend') return draft.value ? '再点一下，完成趋势线' : '点起点，再点终点'
    if (tool.value === 'range') return draft.value ? '再点一下，完成观察区间' : '点两个角，框选观察区间'
    if (tool.value === 'select') return '点选标注；拖端点修改；Delete 删除'
    return '拖动或缩放图表；画线只做研究标注'
  })

  const stopScopeWatch = watch(getScope, (scope) => loadScope(typeof scope === 'string' ? scope : ''), {
    immediate: true,
  })

  function attach() {
    if (attached) return
    attached = true
    if (typeof document !== 'undefined') document.addEventListener('keydown', onKeydown)
    syncPrimitive()
  }

  function dispose() {
    if (attached && typeof document !== 'undefined') document.removeEventListener('keydown', onKeydown)
    attached = false
    cancelActiveDrag({ restore: true })
    stopScopeWatch()
  }

  function setTool(next) {
    if (!TOOLS.includes(next)) return
    if (activeDrag.value) cancelActiveDrag({ restore: true })
    if (next !== tool.value) draft.value = null
    tool.value = next
    syncPrimitive()
  }

  function onPointerDown(event) {
    if (tool.value === 'cursor') return
    const screen = screenPoint(event, true)
    if (!screen) return
    event.preventDefault()

    if (tool.value === 'select') return beginSelection(event, screen)
    if (tool.value === 'horizontal') {
      const point = dataPoint(event, false)
      if (!point) return
      const drawing = createHorizontalDrawing({ id: nextId(), price: point.price })
      if (drawing) addDrawing(drawing)
      return
    }

    const point = dataPoint(event, true)
    if (!point) return
    if (!draft.value) {
      draft.value = { id: '__draft', type: tool.value, start: point, end: point }
      syncPrimitive()
      return
    }
    const drawing = createTwoPointDrawing({ id: nextId(), type: tool.value, start: draft.value.start, end: point })
    draft.value = null
    if (drawing) addDrawing(drawing)
  }

  function onPointerMove(event) {
    if (activeDrag.value) {
      if (event.pointerId !== activeDrag.value.pointerId) return
      return moveSelection(event)
    }
    if (!draft.value || (tool.value !== 'trend' && tool.value !== 'range')) return
    const point = dataPoint(event, true)
    if (!point) return
    draft.value = { ...draft.value, end: point }
    syncPrimitive()
  }

  function onPointerUp(event) {
    const drag = activeDrag.value
    if (!drag || event.pointerId !== drag.pointerId) return
    activeDrag.value = null
    releasePointerCapture(drag.pointerId)
    if (sameSnapshot(drag.before, drawings.value)) {
      syncPrimitive()
      return
    }
    pushUndo(drag.before)
    redoStack.value = []
    persistCurrentScope()
    syncPrimitive()
  }

  function onPointerCancel(event) {
    if (!activeDrag.value || event.pointerId !== activeDrag.value.pointerId) return
    cancelActiveDrag({ restore: true })
  }

  function onLostPointerCapture(event) {
    if (!activeDrag.value || event.pointerId !== activeDrag.value.pointerId) return
    cancelActiveDrag({ restore: true, release: false })
  }

  function deleteSelected() {
    if (!selectedId.value) return
    const next = drawings.value.filter((drawing) => drawing.id !== selectedId.value)
    commit(next)
    selectedId.value = null
    syncPrimitive()
  }

  function clearDrawings() {
    if (!drawings.value.length) return
    commit([])
    selectedId.value = null
    draft.value = null
    syncPrimitive()
  }

  function undo() {
    if (!canUndo.value) return
    const previous = undoStack.value.at(-1)
    redoStack.value = [...redoStack.value, cloneDrawings(drawings.value)].slice(-HISTORY_LIMIT)
    undoStack.value = undoStack.value.slice(0, -1)
    restore(previous)
  }

  function redo() {
    if (!canRedo.value) return
    const next = redoStack.value.at(-1)
    pushUndo(drawings.value)
    redoStack.value = redoStack.value.slice(0, -1)
    restore(next)
  }

  function refresh() {
    syncPrimitive()
  }

  function beginSelection(event, screen) {
    const primitive = getPrimitive()
    const hit = primitive?.findAt(screen.x, screen.y, pointerTolerance(event)) ?? null
    selectedId.value = hit?.id ?? null
    if (!hit) return syncPrimitive()
    const anchor = primitive.findHandleAt(hit.id, screen.x, screen.y, pointerTolerance(event) + 4)
    if (!anchor) return syncPrimitive()
    activeDrag.value = {
      id: hit.id,
      anchor,
      pointerId: event.pointerId,
      before: cloneDrawings(drawings.value),
    }
    try {
      getLayer()?.setPointerCapture?.(event.pointerId)
    } catch {
      // Pointer capture can fail when the pointer has already been cancelled.
    }
    syncPrimitive()
  }

  function moveSelection(event) {
    const drag = activeDrag.value
    if (!drag) return
    const needsTime = drag.anchor !== 'price'
    const point = dataPoint(event, needsTime)
    if (!point) return
    const drawing = drawings.value.find((item) => item.id === drag.id)
    const next = updateDrawingAnchor(drawing, drag.anchor, point)
    if (!next) return
    drawings.value = replaceDrawing(drawings.value, next)
    syncPrimitive()
  }

  function addDrawing(drawing) {
    commit([...drawings.value, drawing])
    selectedId.value = drawing.id
    tool.value = 'select'
    syncPrimitive()
  }

  function commit(next) {
    const sanitized = sanitizeDrawings(next)
    if (sameSnapshot(drawings.value, sanitized)) return
    pushUndo(drawings.value)
    redoStack.value = []
    drawings.value = sanitized
    persistCurrentScope()
  }

  function restore(snapshot) {
    drawings.value = sanitizeDrawings(snapshot)
    selectedId.value = null
    draft.value = null
    persistCurrentScope()
    syncPrimitive()
  }

  function pushUndo(snapshot) {
    undoStack.value = [...undoStack.value, cloneDrawings(snapshot)].slice(-HISTORY_LIMIT)
  }

  function loadScope(scope) {
    if (activeDrag.value) cancelActiveDrag({ restore: true })
    activeScope = scope.trim().slice(0, 120)
    const library = readLibrary()
    drawings.value = activeScope ? sanitizeDrawings(library.byScope[activeScope]) : []
    selectedId.value = null
    draft.value = null
    undoStack.value = []
    redoStack.value = []
    tool.value = 'cursor'
    activeDrag.value = null
    syncPrimitive()
  }

  function persistCurrentScope() {
    if (!activeScope || typeof window === 'undefined' || !window.localStorage) return
    const library = readLibrary()
    if (drawings.value.length) library.byScope[activeScope] = sanitizeDrawings(drawings.value)
    else delete library.byScope[activeScope]
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(library))
    } catch {
      // localStorage 被禁或空间不足时，保留当前会话里的画线。
    }
  }

  function readLibrary() {
    if (typeof window === 'undefined' || !window.localStorage) return sanitizeDrawingLibrary(null)
    try {
      return sanitizeDrawingLibrary(JSON.parse(window.localStorage.getItem(STORAGE_KEY)))
    } catch {
      return sanitizeDrawingLibrary(null)
    }
  }

  function screenPoint(event, plotOnly = false) {
    const rect = getLayer()?.getBoundingClientRect?.()
    if (!rect || !Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return null
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    if (!plotOnly) return point
    const bounds = plotBounds()
    if (!bounds || point.x < 0 || point.x > bounds.width || point.y < 0 || point.y > bounds.height) return null
    return point
  }

  function dataPoint(event, needsTime) {
    const chart = getChart()
    const candle = getSeries()?.candle
    const screen = screenPoint(event, true)
    if (!chart || !candle || !screen) return null
    const price = Number(candle.coordinateToPrice(screen.y))
    if (!Number.isFinite(price) || price <= 0) return null
    if (!needsTime) return { price }
    const time = normalizeChartTime(chart.timeScale().coordinateToTime(screen.x))
    return time === null ? null : { time, price }
  }

  function syncPrimitive() {
    getPrimitive()?.setState({
      drawings: drawings.value,
      draft: draft.value,
      selectedId: selectedId.value,
      dark: typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
    })
  }

  function onKeydown(event) {
    const tag = event.target?.tagName?.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable) return
    if (event.key === 'Escape') {
      if (activeDrag.value) cancelActiveDrag({ restore: true })
      draft.value = null
      selectedId.value = null
      tool.value = 'cursor'
      syncPrimitive()
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId.value) {
      event.preventDefault()
      deleteSelected()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      event.shiftKey ? redo() : undo()
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      redo()
    }
  }

  function nextId() {
    idSequence += 1
    return `drawing-${Date.now().toString(36)}-${idSequence.toString(36)}`
  }

  function plotBounds() {
    const chart = getChart()
    const width = Number(chart?.timeScale?.().width?.())
    const height = Number(chart?.panes?.()[0]?.getHeight?.())
    return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? { width, height } : null
  }

  function releasePointerCapture(pointerId) {
    const layer = getLayer()
    if (!layer?.releasePointerCapture || pointerId === undefined || pointerId === null) return
    try {
      if (!layer.hasPointerCapture || layer.hasPointerCapture(pointerId)) layer.releasePointerCapture(pointerId)
    } catch {
      // The browser may already have released capture after pointercancel/lostcapture.
    }
  }

  function cancelActiveDrag({ restore, release = true }) {
    const drag = activeDrag.value
    if (!drag) return
    activeDrag.value = null
    if (restore) drawings.value = cloneDrawings(drag.before)
    if (release) releasePointerCapture(drag.pointerId)
    syncPrimitive()
  }

  return {
    tool,
    drawings,
    selectedId,
    draft,
    canUndo,
    canRedo,
    canDelete,
    inputActive,
    sessionState,
    helpText,
    attach,
    dispose,
    setTool,
    deleteSelected,
    clearDrawings,
    undo,
    redo,
    refresh,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
  }
}

function cloneDrawings(drawings) {
  return sanitizeDrawings(drawings).map((drawing) =>
    drawing.type === 'horizontal'
      ? { ...drawing }
      : { ...drawing, start: { ...drawing.start }, end: { ...drawing.end } },
  )
}

function sameSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function pointerTolerance(event) {
  return event.pointerType === 'touch' ? 14 : 9
}
