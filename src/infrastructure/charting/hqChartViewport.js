/**
 * HQChart ignores small Mac trackpad wheel deltas. Accumulate only the
 * deltas HQ would discard, then hand the threshold event back to HQ itself.
 */
export function installSmoothWheelBridge(element, chart) {
  const container = chart?.JSChartContainer
  if (!element?.addEventListener || typeof container?.OnWheel !== 'function') return () => {}
  let accumulated = 0
  const onWheel = (event) => {
    const ratio = window.devicePixelRatio || 1
    const scaled = Number(event.deltaY) * ratio
    if (!Number.isFinite(scaled)) return
    if (Math.abs(scaled) >= 90) {
      accumulated = 0
      queueMicrotask(() => syncHostDiagnostics(element, chart))
      return
    }
    event.preventDefault()
    accumulated += scaled
    if (Math.abs(accumulated) < 90) return
    const direction = Math.sign(accumulated)
    accumulated -= direction * 90
    container.OnWheel({
      clientX: event.clientX,
      clientY: event.clientY,
      deltaY: (direction * 100) / ratio,
      ctrlKey: event.ctrlKey,
      preventDefault() {},
    })
    queueMicrotask(() => syncHostDiagnostics(element, chart))
  }
  element.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => element.removeEventListener('wheel', onWheel, { capture: true })
}

export function syncHostDiagnostics(element, chart) {
  if (!element?.dataset) return null
  const container = chart?.JSChartContainer
  const mainData = container?.ChartPaint?.[0]?.Data
  const rightSpace = Number(container?.RightSpaceCount)
  const xPointCount = Number(container?.Frame?.SubFrame?.[0]?.Frame?.XPointCount)
  const diagnostics = {
    dataCount: Number(mainData?.Data?.length),
    dataOffset: Number(mainData?.DataOffset),
    rightSpace,
    visibleKlineCount: xPointCount - rightSpace,
    windowCount: Number(container?.Frame?.SubFrame?.length),
  }
  for (const [key, value] of Object.entries(diagnostics)) {
    if (Number.isFinite(value)) element.dataset[`hq${key[0].toUpperCase()}${key.slice(1)}`] = String(value)
  }
  element.dataset.hqDiagnostics = 'ready'
  return diagnostics
}

export function isFullHqViewport(chart) {
  const container = chart?.JSChartContainer
  const mainData = container?.ChartPaint?.[0]?.Data
  const dataCount = Number(mainData?.Data?.length)
  const dataOffset = Number(mainData?.DataOffset)
  const rightSpace = Number(container?.RightSpaceCount)
  const xPointCount = Number(container?.Frame?.SubFrame?.[0]?.Frame?.XPointCount)
  if (![dataCount, dataOffset, rightSpace, xPointCount].every(Number.isFinite)) return false
  return dataOffset <= 0 && xPointCount - rightSpace >= dataCount
}

/**
 * Project the real HQ main-frame viewport into CSS pixels for the shared
 * volume-by-price overlay. HQ owns the logarithmic coordinate calculation, so
 * consumers must use priceToY instead of rebuilding a linear/log scale.
 */
export function readHqStockChipViewport(chart) {
  const container = chart?.JSChartContainer
  const mainData = container?.ChartPaint?.[0]?.Data
  const mainFrame = container?.Frame?.SubFrame?.[0]?.Frame
  const rows = mainData?.Data
  const dataCount = Number(rows?.length)
  const dataOffset = Number(mainData?.DataOffset)
  const xPointCount = Number(mainFrame?.XPointCount)
  const rightSpace = Number(container?.RightSpaceCount)
  const horizontalMin = Number(mainFrame?.HorizontalMin)
  const horizontalMax = Number(mainFrame?.HorizontalMax)

  if (!Array.isArray(rows) || dataCount <= 0) return null
  if (![dataOffset, xPointCount, rightSpace, horizontalMin, horizontalMax].every(Number.isFinite)) return null
  if (xPointCount <= 0 || rightSpace < 0 || xPointCount - rightSpace <= 0 || horizontalMin === horizontalMax)
    return null
  if (typeof mainFrame?.GetYFromData !== 'function') return null

  const border = readMainFrameBorder(mainFrame)
  const topDevice = Number(border?.TopEx)
  const bottomDevice = Number(border?.BottomEx)
  if (![topDevice, bottomDevice].every(Number.isFinite) || bottomDevice <= topDevice) return null

  const pixelRatio = readDevicePixelRatio()
  const top = topDevice / pixelRatio
  const height = (bottomDevice - topDevice) / pixelRatio
  const priceLower = Math.min(horizontalMin, horizontalMax)
  const priceUpper = Math.max(horizontalMin, horizontalMax)
  const offset = clamp(Math.floor(dataOffset), 0, dataCount - 1)
  const dataCapacity = Math.floor(xPointCount - rightSpace)
  const visibleWindow = Math.min(dataCount - offset, dataCapacity)
  if (visibleWindow <= 0) return null
  const activeIndex = offset + visibleWindow - 1

  // Coordinates are relative to the main frame content box. The overlay sets
  // its own top separately, which avoids double-counting HQ's title height.
  const priceToY = (price) => {
    const value = Number(price)
    if (!Number.isFinite(value)) return null
    const deviceY = Number(mainFrame.GetYFromData(value, true))
    if (!Number.isFinite(deviceY)) return null
    return (deviceY - topDevice) / pixelRatio
  }

  const lowerY = priceToY(priceLower)
  const middleY = priceToY((priceLower + priceUpper) / 2)
  const upperY = priceToY(priceUpper)
  if (![lowerY, middleY, upperY].every(Number.isFinite)) return null

  return {
    top,
    height,
    priceLower,
    priceUpper,
    activeIndex,
    visibleWindow,
    priceToY,
    signature: [top, height, priceLower, priceUpper, activeIndex, visibleWindow, lowerY, middleY, upperY]
      .map(stableNumber)
      .join('|'),
  }
}

function readMainFrameBorder(frame) {
  if (typeof frame?.GetBorder === 'function') return frame.GetBorder()
  return frame?.ChartBorder?.GetBorder?.()
}

function readDevicePixelRatio() {
  const ratio = Number(globalThis.window?.devicePixelRatio)
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}

function stableNumber(value) {
  return Number(value).toPrecision(12)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
