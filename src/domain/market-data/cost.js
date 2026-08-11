// 成本与市场态计算：每个历史点的窗口只由当时可见前缀自适应推导，
// 不使用模块级可变状态，确保不同样本/不同入口调用之间不会互相污染。

import { buildMarketModelContext, DELTA_ANCHOR_SOURCES, MARKET_MODEL_VERSION } from './modelVersion.js'

const PREFIX_CAUSAL_PATH = Symbol('market-lab-prefix-causal-state-path')

function adaptiveWindow(sampleSize) {
  const n = Math.max(1, Math.floor(Number(sampleSize) || 1))
  return Math.max(5, Math.floor(Math.sqrt(n)))
}

// 由当前可见前缀推导窗口；外部覆盖只用于显式研究情景。
// 默认窗口不能依赖完整数据长度，否则追加未来数据会改写历史状态。
export function deriveWindows(n, override = {}) {
  const cost = override.cost ?? adaptiveWindow(n)
  const recent = override.recent ?? Math.max(3, Math.floor(Math.sqrt(cost)))
  const vol = override.vol ?? cost
  return { cost, recent, vol }
}

export function buildMarketState(rows, tradingDaysPerYear) {
  if (!Array.isArray(rows) || rows.length < 2 || !validTdpy(tradingDaysPerYear)) return null
  return buildMarketStatePath(rows, tradingDaysPerYear).at(-1)
}

export function buildMarketStatePath(rows, tradingDaysPerYear, windows = null) {
  if (!Array.isArray(rows) || rows.length < 2 || !validTdpy(tradingDaysPerYear)) return []
  const returns = rows.map((row, index) => (index > 0 ? Math.log(row.close / rows[index - 1].close) : 0))
  const trueRanges = rows.map((row, index) => {
    if (index === 0) return 0
    const prevClose = rows[index - 1].close
    return Math.max(row.high - row.low, Math.abs(row.high - prevClose), Math.abs(row.low - prevClose))
  })
  const first = rows[0]
  let peak = first.close
  let peakDrawdown = 0

  const path = rows.map((last, index) => {
    const w = windows ?? deriveWindows(index + 1)
    const windowSpec = {
      ...w,
      mode: windows ? 'explicit-scenario' : 'adaptive-prefix',
      visiblePrefixRows: index + 1,
      futureRowsUsed: false,
    }
    peak = Math.max(peak, last.close)
    peakDrawdown = Math.min(peakDrawdown, peak > 0 ? (last.close - peak) / peak : 0)
    const returnWindow = windowValues(returns, Math.max(1, index - w.vol + 1), index + 1)
    const returnBasis = returnWindow.length >= 5 ? returnWindow : windowValues(returns, 1, index + 1)
    const annualVol = standardDeviation(returnBasis) * Math.sqrt(tradingDaysPerYear)
    const atr = average(windowValues(trueRanges, Math.max(1, index - w.recent + 1), index + 1))
    const cost = rollingCost(rows, index, w)
    const previousCost = index >= w.recent ? rollingCost(rows, index - w.recent, w) : cost
    const momentumFast = momentumAt(rows, index, w.recent)
    const momentumSlow = momentumAt(rows, index, w.cost)
    const costSlopeRecent = previousCost.anchor > 0 ? (cost.anchor - previousCost.anchor) / previousCost.anchor : 0
    return {
      modelVersion: MARKET_MODEL_VERSION,
      modelContext: buildMarketModelContext({
        windowSpec,
        deltaAnchorSource: DELTA_ANCHOR_SOURCES.adaptiveCostAnchor,
        tradingDaysPerYear,
        observationDate: last.date,
      }),
      markPrice: last.close,
      firstPrice: first.close,
      annualVol,
      atr,
      atrPercent: last.close > 0 ? atr / last.close : 0,
      costAnchor: cost.anchor,
      costRecent: cost.recent,
      costLow: cost.lower,
      costHigh: cost.upper,
      costDistance: cost.anchor > 0 ? (last.close - cost.anchor) / cost.anchor : 0,
      momentumFast,
      momentumSlow,
      costSlopeRecent,
      // Compatibility aliases. Their values now use the declared adaptive
      // windows; new consumers must use the canonical names above.
      momentum5: momentumFast,
      momentum20: momentumSlow,
      costSlope5: costSlopeRecent,
      windowSpec,
      tradingDaysPerYear,
      maxDrawdown: peakDrawdown,
      rows: index + 1,
      asOfDate: last.date,
      range: `${first.date} ~ ${last.date}`,
    }
  })
  Object.defineProperty(path, PREFIX_CAUSAL_PATH, {
    value: statePathFingerprint(path),
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return path
}

export function isPrefixCausalMarketStatePath(states, rows) {
  if (!Array.isArray(states) || !Array.isArray(rows)) return false
  const recordedFingerprint = states[PREFIX_CAUSAL_PATH]
  if (typeof recordedFingerprint !== 'string' || recordedFingerprint !== statePathFingerprint(states)) return false
  if (states.length !== rows.length) return false
  return states.every((state, index) => {
    const windowSpec = state?.windowSpec
    return (
      state?.rows === index + 1 &&
      state?.asOfDate === rows[index]?.date &&
      state?.markPrice === rows[index]?.close &&
      windowSpec?.visiblePrefixRows === index + 1 &&
      windowSpec?.futureRowsUsed === false
    )
  })
}

function statePathFingerprint(states) {
  return states
    .map((state) =>
      [
        state?.asOfDate,
        state?.rows,
        state?.markPrice,
        state?.annualVol,
        state?.atrPercent,
        state?.costAnchor,
        state?.costLow,
        state?.costHigh,
        state?.costDistance,
        state?.momentumFast,
        state?.momentumSlow,
        state?.costSlopeRecent,
        state?.modelVersion,
        state?.modelContext?.deltaAnchorSource,
        state?.modelContext?.tradingDaysPerYear,
        state?.modelContext?.observationDate,
        state?.windowSpec?.mode,
        state?.windowSpec?.visiblePrefixRows,
        state?.windowSpec?.futureRowsUsed,
      ].join(':'),
    )
    .join('|')
}

function momentumAt(rows, index, window) {
  if (index < window) return 0
  const current = rows[index]?.close
  const previous = rows[index - window]?.close
  return previous > 0 ? (current - previous) / previous : 0
}

export function buildCostPath(rows, windows = null, tradingDaysPerYear = null) {
  if (!Array.isArray(rows) || rows.length === 0) return []
  return rows.map((row, index) => {
    const w = windows ?? deriveWindows(index + 1)
    const cost = rollingCost(rows, index, w)
    const windowSpec = {
      ...w,
      mode: windows ? 'explicit-scenario' : 'adaptive-prefix',
      visiblePrefixRows: index + 1,
      futureRowsUsed: false,
    }
    return {
      modelVersion: MARKET_MODEL_VERSION,
      modelContext: buildMarketModelContext({
        windowSpec,
        deltaAnchorSource: DELTA_ANCHOR_SOURCES.adaptiveCostAnchor,
        tradingDaysPerYear,
        observationDate: row.date,
      }),
      date: row.date,
      close: row.close,
      anchor: cost?.anchor ?? null,
      lower: cost?.lower ?? null,
      upper: cost?.upper ?? null,
      windowSpec,
    }
  })
}

function rollingCost(rows, index, w) {
  const end = index + 1
  const anchorRows = rows.slice(Math.max(0, end - w.cost), end)
  const recentRows = rows.slice(Math.max(0, end - w.recent), end)
  const bandRows = rows.slice(Math.max(0, end - w.cost - 1), end)
  const anchor = weightedTypicalCost(anchorRows)
  const recent = weightedTypicalCost(recentRows)
  const returns = bandRows.slice(1).map((row, offset) => Math.log(row.close / bandRows[offset].close))
  const volEstimate = standardDeviation(returns) * Math.sqrt(Math.min(w.recent, returns.length || 1))
  const minBand = Math.max(volEstimate * 0.25, 0.005)
  const bandWidth = Math.max(volEstimate, minBand)
  return {
    anchor,
    recent,
    lower: anchor * (1 - bandWidth),
    upper: anchor * (1 + bandWidth),
  }
}

function weightedTypicalCost(rows) {
  if (!rows.length) return 0
  const rawVolume = rows.reduce((sum, row) => sum + row.volume, 0)
  const usesEqualWeight = rawVolume <= 0
  const denominator = usesEqualWeight ? rows.length : rawVolume
  return (
    rows.reduce((sum, row) => {
      const typical = (row.high + row.low + row.close) / 3
      return sum + typical * (usesEqualWeight ? 1 : row.volume)
    }, 0) / denominator
  )
}

function average(values) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function windowValues(values, start, end) {
  return values.slice(Math.max(0, start), Math.max(0, end))
}

function standardDeviation(values) {
  if (values.length < 2) return 0
  const mean = average(values)
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(values.length - 1, 1)
  return Math.sqrt(variance)
}

function validTdpy(value) {
  return Number.isFinite(value) && value > 0
}
