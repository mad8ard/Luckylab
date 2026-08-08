import { ref } from 'vue'

export function useStockChipViewport({ getChart, getSeries, getRows, getPaneIndex, isEnabled }) {
  const viewport = ref(null)
  let frame = 0
  let monitorFrame = 0
  let signature = ''

  function queue() {
    if (frame) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = 0
      update()
    })
  }

  function startMonitor() {
    if (monitorFrame || !enabled()) return
    const tick = () => {
      monitorFrame = 0
      if (!enabled()) {
        signature = ''
        return
      }
      update()
      monitorFrame = requestAnimationFrame(tick)
    }
    monitorFrame = requestAnimationFrame(tick)
  }

  function stopMonitor() {
    if (monitorFrame) cancelAnimationFrame(monitorFrame)
    monitorFrame = 0
    signature = ''
  }

  function dispose() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    stopMonitor()
  }

  function update() {
    const chart = getChart()
    const candle = getSeries()?.candle
    const rows = getRows()
    if (!enabled() || !chart || !candle || !rows.length) return setNull()

    const height = chart.panes()[getPaneIndex()]?.getHeight?.() ?? 0
    const top = Number(candle.coordinateToPrice(0))
    const bottom = Number(candle.coordinateToPrice(height))
    if (!height || !Number.isFinite(top) || !Number.isFinite(bottom) || top === bottom) return setNull()

    const logicalRange = chart.timeScale().getVisibleLogicalRange()
    const last = rows.length - 1
    const from = Number.isFinite(logicalRange?.from) ? clamp(Math.floor(logicalRange.from), 0, last) : 0
    const to = Number.isFinite(logicalRange?.to) ? clamp(Math.ceil(logicalRange.to), 0, last) : last
    const visibleFrom = Math.min(from, to)
    const visibleTo = Math.max(from, to)
    const next = {
      height,
      priceLower: Math.min(top, bottom),
      priceUpper: Math.max(top, bottom),
      activeIndex: visibleTo,
      visibleWindow: Math.max(1, visibleTo - visibleFrom + 1),
    }
    const nextSignature = [
      next.height,
      next.priceLower.toPrecision(12),
      next.priceUpper.toPrecision(12),
      next.activeIndex,
      next.visibleWindow,
    ].join('|')
    if (nextSignature === signature) return false
    signature = nextSignature
    viewport.value = next
    return true
  }

  function setNull() {
    if (signature === 'null') return false
    signature = 'null'
    viewport.value = null
    return true
  }

  function enabled() {
    return isEnabled?.() !== false
  }

  return { viewport, queue, startMonitor, stopMonitor, dispose }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
