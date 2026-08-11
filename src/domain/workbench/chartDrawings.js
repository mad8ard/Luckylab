export const CHART_DRAWING_VERSION = 1
export const CHART_DRAWING_TYPES = Object.freeze(['horizontal', 'trend', 'range'])

export function createHorizontalDrawing({ id, price }) {
  return sanitizeDrawing({ id, type: 'horizontal', price })
}

export function createTwoPointDrawing({ id, type, start, end }) {
  return sanitizeDrawing({ id, type, start, end })
}

export function sanitizeDrawing(value) {
  if (!value || typeof value !== 'object') return null
  const id = sanitizeId(value.id)
  if (!id || !CHART_DRAWING_TYPES.includes(value.type)) return null

  if (value.type === 'horizontal') {
    const price = finitePositive(value.price)
    return price === null ? null : { id, type: value.type, price }
  }

  const start = sanitizeAnchor(value.start)
  const end = sanitizeAnchor(value.end)
  return start && end ? { id, type: value.type, start, end } : null
}

export function sanitizeDrawings(values, limit = 80) {
  if (!Array.isArray(values)) return []
  const out = []
  const ids = new Set()
  for (const value of values) {
    const drawing = sanitizeDrawing(value)
    if (!drawing || ids.has(drawing.id)) continue
    ids.add(drawing.id)
    out.push(drawing)
    if (out.length >= limit) break
  }
  return out
}

export function sanitizeDrawingLibrary(value, maxScopes = 120) {
  const source = value?.version === CHART_DRAWING_VERSION && value.byScope ? value.byScope : value?.byScope
  const byScope = {}
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return { version: CHART_DRAWING_VERSION, byScope }
  }
  for (const [rawScope, drawings] of Object.entries(source)) {
    const scope = sanitizeScope(rawScope)
    if (!scope || Object.hasOwn(byScope, scope)) continue
    byScope[scope] = sanitizeDrawings(drawings)
    if (Object.keys(byScope).length >= maxScopes) break
  }
  return { version: CHART_DRAWING_VERSION, byScope }
}

export function updateDrawingAnchor(drawing, anchor, point) {
  const current = sanitizeDrawing(drawing)
  if (!current) return null
  if (current.type === 'horizontal') {
    const price = finitePositive(point?.price)
    return price === null ? current : { ...current, price }
  }
  if (anchor !== 'start' && anchor !== 'end') return current
  const nextAnchor = sanitizeAnchor(point)
  return nextAnchor ? { ...current, [anchor]: nextAnchor } : current
}

export function replaceDrawing(drawings, nextDrawing) {
  const next = sanitizeDrawing(nextDrawing)
  if (!next) return sanitizeDrawings(drawings)
  return sanitizeDrawings(drawings).map((drawing) => (drawing.id === next.id ? next : drawing))
}

export function findNearestDrawing(renderedDrawings, point, tolerance = 10) {
  if (!Array.isArray(renderedDrawings) || !finitePoint(point)) return null
  let nearest = null
  for (let index = renderedDrawings.length - 1; index >= 0; index -= 1) {
    const rendered = renderedDrawings[index]
    const distance = distanceToRenderedDrawing(rendered, point)
    if (distance > tolerance || (nearest && distance >= nearest.distance)) continue
    nearest = { id: rendered.id, type: rendered.type, distance }
  }
  return nearest
}

export function distanceToRenderedDrawing(drawing, point) {
  if (!drawing || !finitePoint(point)) return Number.POSITIVE_INFINITY
  if (drawing.type === 'range') {
    const left = Math.min(drawing.x1, drawing.x2)
    const right = Math.max(drawing.x1, drawing.x2)
    const top = Math.min(drawing.y1, drawing.y2)
    const bottom = Math.max(drawing.y1, drawing.y2)
    return Math.min(
      distanceToSegment(point, { x: left, y: top }, { x: right, y: top }),
      distanceToSegment(point, { x: right, y: top }, { x: right, y: bottom }),
      distanceToSegment(point, { x: right, y: bottom }, { x: left, y: bottom }),
      distanceToSegment(point, { x: left, y: bottom }, { x: left, y: top }),
    )
  }
  return distanceToSegment(point, { x: drawing.x1, y: drawing.y1 }, { x: drawing.x2, y: drawing.y2 })
}

export function distanceToSegment(point, start, end) {
  if (![point, start, end].every(finitePoint)) return Number.POSITIVE_INFINITY
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy))
}

export function normalizeChartTime(value) {
  if (Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 40)
  if (value && Number.isInteger(value.year) && Number.isInteger(value.month) && Number.isInteger(value.day)) {
    return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`
  }
  return null
}

function sanitizeAnchor(value) {
  const time = normalizeChartTime(value?.time)
  const price = finitePositive(value?.price)
  return time === null || price === null ? null : { time, price }
}

function sanitizeId(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : ''
}

function sanitizeScope(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : ''
}

function finitePositive(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function finitePoint(value) {
  return Number.isFinite(value?.x) && Number.isFinite(value?.y)
}
