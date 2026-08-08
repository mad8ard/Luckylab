// 成本与市场态计算：所有窗口大小由 rows.length 自适应推导，
// 不使用模块级可变状态，确保不同样本/不同入口调用之间不会互相污染。

const DEFAULT_COST_WINDOW = 60

function adaptiveWindow(n, fallback = DEFAULT_COST_WINDOW) {
  if (n >= 500) return fallback
  if (n < 30) return Math.max(5, Math.floor(n / 3))
  return Math.max(10, Math.floor(fallback * n / 500))
}

// 由样本量推导出三档窗口；外部可显式覆盖
export function deriveWindows(n, override = {}) {
  const cost = override.cost ?? adaptiveWindow(n, DEFAULT_COST_WINDOW)
  const recent = override.recent ?? Math.max(3, Math.floor(cost / 3))
  const vol = override.vol ?? cost
  return { cost, recent, vol }
}

export function buildMarketState(rows, tradingDaysPerYear = 365) {
  if (!Array.isArray(rows) || rows.length < 2) return null
  return buildMarketStatePath(rows, tradingDaysPerYear).at(-1)
}

export function buildMarketStatePath(rows, tradingDaysPerYear = 365, windows = null) {
  if (!Array.isArray(rows) || rows.length < 2) return []
  const w = windows ?? deriveWindows(rows.length)
  const returns = rows.map((row, index) => index > 0 ? Math.log(row.close / rows[index - 1].close) : 0)
  const trueRanges = rows.map((row, index) => {
    if (index === 0) return 0
    const prevClose = rows[index - 1].close
    return Math.max(row.high - row.low, Math.abs(row.high - prevClose), Math.abs(row.low - prevClose))
  })
  const first = rows[0]
  let peak = first.close
  let peakDrawdown = 0

  return rows.map((last, index) => {
    peak = Math.max(peak, last.close)
    peakDrawdown = Math.min(peakDrawdown, peak > 0 ? (last.close - peak) / peak : 0)
    const returnWindow = windowValues(returns, Math.max(1, index - w.vol + 1), index + 1)
    const returnBasis = returnWindow.length >= 5 ? returnWindow : windowValues(returns, 1, index + 1)
    const annualVol = standardDeviation(returnBasis) * Math.sqrt(tradingDaysPerYear)
    const atr = average(windowValues(trueRanges, Math.max(1, index - 13), index + 1))
    const cost = rollingCost(rows, index, w)
    const previousCost = index > 5 ? rollingCost(rows, index - 5, w) : cost
    return {
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
      momentum5: momentumAt(rows, index, 5),
      momentum20: momentumAt(rows, index, 20),
      costSlope5: previousCost.anchor > 0 ? (cost.anchor - previousCost.anchor) / previousCost.anchor : 0,
      maxDrawdown: peakDrawdown,
      rows: index + 1,
      range: `${first.date} ~ ${last.date}`,
    }
  })
}

function momentumAt(rows, index, window) {
  if (index < window) return 0
  const current = rows[index]?.close
  const previous = rows[index - window]?.close
  return previous > 0 ? (current - previous) / previous : 0
}

export function buildCostPath(rows, windows = null) {
  if (!Array.isArray(rows) || rows.length === 0) return []
  const w = windows ?? deriveWindows(rows.length)
  return rows.map((row, index) => {
    const cost = rollingCost(rows, index, w)
    return {
      date: row.date,
      close: row.close,
      anchor: cost?.anchor ?? null,
      lower: cost?.lower ?? null,
      upper: cost?.upper ?? null,
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
  return rows.reduce((sum, row) => {
    const typical = (row.high + row.low + row.close) / 3
    return sum + typical * (usesEqualWeight ? 1 : row.volume)
  }, 0) / denominator
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
