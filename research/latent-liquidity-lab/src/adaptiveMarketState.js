import { requireTradingDaysPerYear } from './tradingTime.js'

/**
 * Point-in-time market-state proxy with no calendar lookback constants.  For a
 * prefix of n observations, w=floor(sqrt(n)); therefore w grows with available
 * evidence while w/n tends to zero.  The rule is statistical, not a holding
 * period, and is frozen independently at every historical date.
 */
export function deriveAdaptiveWindows(sampleSize) {
  const n = Math.max(0, Math.floor(Number(sampleSize) || 0))
  const localWindowSamples = Math.floor(Math.sqrt(n))
  const recentWindowSamples = Math.floor(Math.sqrt(localWindowSamples))
  return {
    sampleSize: n,
    localWindowSamples,
    recentWindowSamples,
    slopeLagSamples: recentWindowSamples,
    rule: 'localWindowSamples=floor(sqrt(prefixSamples)); recentWindowSamples=floor(sqrt(localWindowSamples))',
  }
}

export function buildAdaptiveMarketStatePath(rows, tradingDaysPerYear) {
  const tdpy = requireTradingDaysPerYear(tradingDaysPerYear, 'buildAdaptiveMarketStatePath')
  if (!Array.isArray(rows) || !rows.length) return []
  const returns = rows.map((row, index) =>
    index > 0 && validPrice(row?.close) && validPrice(rows[index - 1]?.close)
      ? Math.log(row.close / rows[index - 1].close)
      : 0,
  )
  const trueRanges = rows.map((row, index) => (index > 0 ? trueRange(row, rows[index - 1]) : Number.NaN))
  const states = []
  let peak = validPrice(rows[0]?.close) ? rows[0].close : 0
  let peakDrawdown = 0

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const windows = deriveAdaptiveWindows(index + 1)
    if (validPrice(row?.close)) {
      peak = Math.max(peak, row.close)
      peakDrawdown = Math.min(peakDrawdown, peak > 0 ? row.close / peak - 1 : 0)
    }
    if (windows.localWindowSamples < 5 || !validRow(row)) {
      states.push({
        status: 'insufficient-history',
        rows: index + 1,
        requiredCondition: 'floor(sqrt(prefixSamples)) >= 5',
        windows,
      })
      continue
    }

    const cost = rollingCost(rows, returns, index, windows)
    const returnBasis = returns.slice(Math.max(1, index - windows.localWindowSamples + 1), index + 1)
    const annualVol = standardDeviation(returnBasis) * Math.sqrt(tdpy)
    const atr = average(
      trueRanges.slice(Math.max(1, index - windows.recentWindowSamples + 1), index + 1).filter(Number.isFinite),
    )
    const previousState = states[index - windows.slopeLagSamples]
    const previousAnchor = previousState?.status === 'ok' ? previousState.costAnchor : cost.anchor
    states.push({
      status: 'ok',
      markPrice: row.close,
      annualVol,
      atr,
      atrPercent: row.close > 0 ? atr / row.close : 0,
      costAnchor: cost.anchor,
      costRecent: cost.recent,
      costLow: cost.lower,
      costHigh: cost.upper,
      costDistance: cost.anchor > 0 ? (row.close - cost.anchor) / cost.anchor : 0,
      costSlope: previousAnchor > 0 ? (cost.anchor - previousAnchor) / previousAnchor : 0,
      maxDrawdown: peakDrawdown,
      rows: index + 1,
      tradingDaysPerYear: tdpy,
      windows,
      estimator: 'causal-sqrt-prefix-window-v1',
    })
  }
  return states
}

function rollingCost(rows, returns, index, windows) {
  const end = index + 1
  const anchorRows = rows.slice(Math.max(0, end - windows.localWindowSamples), end)
  const recentRows = rows.slice(Math.max(0, end - windows.recentWindowSamples), end)
  const bandReturns = returns.slice(Math.max(1, index - windows.localWindowSamples + 1), index + 1)
  const anchor = weightedTypicalCost(anchorRows)
  const recent = weightedTypicalCost(recentRows)
  const bandWidth = standardDeviation(bandReturns) * Math.sqrt(windows.recentWindowSamples)
  return {
    anchor,
    recent,
    lower: anchor * (1 - bandWidth),
    upper: anchor * (1 + bandWidth),
  }
}

function weightedTypicalCost(rows) {
  if (!rows.length) return 0
  const rawVolume = rows.reduce(
    (sum, row) => sum + (Number.isFinite(row?.volume) && row.volume > 0 ? row.volume : 0),
    0,
  )
  const equalWeight = rawVolume <= 0
  const denominator = equalWeight ? rows.length : rawVolume
  return (
    rows.reduce((sum, row) => {
      const typical = (row.high + row.low + row.close) / 3
      return sum + typical * (equalWeight ? 1 : row.volume)
    }, 0) / denominator
  )
}

function trueRange(row, previous) {
  if (!validRow(row) || !validRow(previous)) return Number.NaN
  return Math.max(row.high - row.low, Math.abs(row.high - previous.close), Math.abs(row.low - previous.close))
}

function standardDeviation(values) {
  if (values.length < 2) return 0
  const center = average(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / Math.max(1, values.length - 1))
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function validPrice(value) {
  return Number.isFinite(value) && value > 0
}

function validRow(row) {
  return (
    [row?.open, row?.high, row?.low, row?.close, row?.volume].every(Number.isFinite) &&
    row.open > 0 &&
    row.high > 0 &&
    row.low > 0 &&
    row.close > 0
  )
}
