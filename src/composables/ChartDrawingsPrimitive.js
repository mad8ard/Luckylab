import { findNearestDrawing } from '../domain/workbench/chartDrawings.js'

export class ChartDrawingsPrimitive {
  constructor() {
    this.chart = null
    this.series = null
    this.requestUpdate = null
    this.drawings = []
    this.draft = null
    this.selectedId = null
    this.dark = false
    this.view = new ChartDrawingsPaneView(this)
    this.views = [this.view]
  }

  attached({ chart, series, requestUpdate }) {
    this.chart = chart
    this.series = series
    this.requestUpdate = requestUpdate
    this.requestUpdate?.()
  }

  detached() {
    this.chart = null
    this.series = null
    this.requestUpdate = null
  }

  paneViews() {
    return this.views
  }

  updateAllViews() {
    this.view.update()
  }

  hitTest(x, y) {
    const hit = this.findAt(x, y, 8)
    return hit
      ? { externalId: `chart-drawing:${hit.id}`, zOrder: 'top', cursorStyle: 'pointer', itemType: 'primitive' }
      : null
  }

  setState({ drawings, draft, selectedId, dark }) {
    this.drawings = drawings ?? []
    this.draft = draft ?? null
    this.selectedId = selectedId ?? null
    this.dark = Boolean(dark)
    this.requestUpdate?.()
  }

  projectDrawings(includeDraft = false) {
    if (!this.chart || !this.series) return []
    const width = Number(this.chart.timeScale().width())
    if (!Number.isFinite(width) || width <= 0) return []
    const values = includeDraft && this.draft ? [...this.drawings, { ...this.draft, id: '__draft' }] : this.drawings
    return values.map((drawing) => projectDrawing(drawing, this.chart, this.series, width)).filter(Boolean)
  }

  findAt(x, y, tolerance = 10) {
    return findNearestDrawing(this.projectDrawings(false), { x, y }, tolerance)
  }

  findHandleAt(id, x, y, tolerance = 13) {
    const drawing = this.projectDrawings(false).find((item) => item.id === id)
    if (!drawing) return null
    if (drawing.type === 'horizontal') return Math.abs(y - drawing.y1) <= tolerance ? 'price' : null
    const startDistance = Math.hypot(x - drawing.x1, y - drawing.y1)
    const endDistance = Math.hypot(x - drawing.x2, y - drawing.y2)
    if (startDistance <= tolerance && startDistance <= endDistance) return 'start'
    return endDistance <= tolerance ? 'end' : null
  }
}

class ChartDrawingsPaneView {
  constructor(source) {
    this.source = source
    this.chartRenderer = new ChartDrawingsRenderer(source)
  }

  update() {}

  zOrder() {
    return 'top'
  }

  renderer() {
    return this.chartRenderer
  }
}

class ChartDrawingsRenderer {
  constructor(source) {
    this.source = source
  }

  draw(target) {
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const projected = this.source.projectDrawings(true)
      if (!projected.length) return
      context.save()
      context.lineCap = 'round'
      context.lineJoin = 'round'
      for (const drawing of projected) drawProjected(context, mediaSize, drawing, this.source)
      context.restore()
    })
  }
}

function projectDrawing(drawing, chart, series, width) {
  if (!drawing || typeof drawing !== 'object') return null
  if (drawing.type === 'horizontal') {
    const y = series.priceToCoordinate(drawing.price)
    return Number.isFinite(y) ? { ...drawing, x1: 0, y1: y, x2: width, y2: y } : null
  }
  const x1 = chart.timeScale().timeToCoordinate(drawing.start?.time)
  const y1 = series.priceToCoordinate(drawing.start?.price)
  const x2 = chart.timeScale().timeToCoordinate(drawing.end?.time)
  const y2 = series.priceToCoordinate(drawing.end?.price)
  return [x1, y1, x2, y2].every(Number.isFinite) ? { ...drawing, x1, y1, x2, y2 } : null
}

function drawProjected(context, mediaSize, drawing, source) {
  const isDraft = drawing.id === '__draft'
  const selected = drawing.id === source.selectedId
  const color = selected ? palette(source.dark).selected : palette(source.dark)[drawing.type]
  context.strokeStyle = color
  context.lineWidth = selected ? 2.4 : 1.7
  context.setLineDash(isDraft ? [6, 5] : [])

  if (drawing.type === 'range') {
    const x = Math.min(drawing.x1, drawing.x2)
    const y = Math.min(drawing.y1, drawing.y2)
    const width = Math.abs(drawing.x2 - drawing.x1)
    const height = Math.abs(drawing.y2 - drawing.y1)
    context.fillStyle = source.dark ? 'rgba(78,201,159,0.09)' : 'rgba(14,117,88,0.08)'
    context.fillRect(x, y, width, height)
    context.strokeRect(x, y, width, height)
  } else {
    context.beginPath()
    context.moveTo(drawing.x1, drawing.y1)
    context.lineTo(drawing.x2, drawing.y2)
    context.stroke()
  }

  if (drawing.type === 'horizontal' && !isDraft) drawPriceLabel(context, drawing, mediaSize.width, source.dark)
  if (selected && drawing.type !== 'horizontal') {
    drawHandle(context, drawing.x1, drawing.y1, color, source.dark)
    drawHandle(context, drawing.x2, drawing.y2, color, source.dark)
  }
  context.setLineDash([])
}

function drawPriceLabel(context, drawing, width, dark) {
  const label = Number(drawing.price).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  context.font = '700 11px ui-sans-serif, system-ui, sans-serif'
  const textWidth = context.measureText(label).width
  const x = Math.max(6, width - textWidth - 10)
  const y = Math.max(14, drawing.y1 - 5)
  context.fillStyle = dark ? 'rgba(26,27,23,0.88)' : 'rgba(251,250,244,0.9)'
  context.fillRect(x - 4, y - 11, textWidth + 8, 15)
  context.fillStyle = palette(dark).horizontal
  context.fillText(label, x, y)
}

function drawHandle(context, x, y, color, dark) {
  context.beginPath()
  context.arc(x, y, 4.5, 0, Math.PI * 2)
  context.fillStyle = dark ? '#22241f' : '#fbfaf4'
  context.fill()
  context.strokeStyle = color
  context.lineWidth = 2
  context.stroke()
}

function palette(dark) {
  return dark
    ? { horizontal: '#7fa6f0', trend: '#e3ad55', range: '#4ec99f', selected: '#f1d36b' }
    : { horizontal: '#274f9f', trend: '#8b5a16', range: '#0e7558', selected: '#a93226' }
}
