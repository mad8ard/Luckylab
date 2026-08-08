// liquidityRackModel 工具集：纯标量函数与文案标签。无外部依赖。

const DEFAULT_BINS = 32

export function priceToY(price, range) {
  if (!Number.isFinite(price) || range.upper <= range.lower) return 50
  return Math.max(1, Math.min(99, ((range.upper - price) / (range.upper - range.lower)) * 100))
}

export function scale(value, max, min, maxOut) {
  if (!Number.isFinite(value) || value <= 0 || max <= 0) return min
  return Math.min(maxOut, Math.max(min, (value / max) * maxOut))
}

export function clampIndex(index, length) {
  if (!Number.isFinite(index)) return Math.max(0, length - 1)
  return Math.max(0, Math.min(length - 1, Math.round(index)))
}

export function normalizeBinCount(binCount) {
  return Math.max(12, Math.min(120, Math.round(Number(binCount) || DEFAULT_BINS)))
}

export function normalizeViewMode(mode) {
  return ['simulate', 'real', 'compare', 'gap'].includes(mode) ? mode : 'compare'
}

export function normalizeGapMode(mode) {
  return ['shortfall', 'signed', 'absolute'].includes(mode) ? mode : 'shortfall'
}

export function binIndex(price, range, count) {
  if (!Number.isFinite(price) || price < range.lower || price > range.upper) return -1
  return Math.min(count - 1, Math.max(0, Math.floor(((price - range.lower) / (range.upper - range.lower)) * count)))
}

export function compactUsd(value) {
  if (!Number.isFinite(value) || value <= 0) return '-'
  if (value >= 100000000) return `$${(value / 100000000).toFixed(1)}亿`
  if (value >= 10000) return `$${(value / 10000).toFixed(0)}万`
  return `$${value.toFixed(0)}`
}

export function gapModeLabel(mode) {
  return { shortfall: '缺口', signed: '偏差', absolute: '反差' }[mode] ?? '缺口'
}

export function viewModeLabel(mode, hasRealSignal = true) {
  if (!hasRealSignal && mode !== 'simulate')
    return `${{ real: '真实', compare: '对照', gap: '缺口' }[mode] ?? '对照'}待接入`
  return { simulate: '模拟', real: '真实', compare: '对照', gap: '缺口' }[mode] ?? '对照'
}

export function shareLabel(mode, hasRealSignal = true, gapMode = 'shortfall') {
  if (!hasRealSignal) return '模型权重'
  return (
    { simulate: '模型权重', real: '池状态信号', compare: '模型 / 真实', gap: gapModeLabel(gapMode) }[mode] ??
    '模型 / 真实'
  )
}
