// JS twin of bl-esw-pinbar-market-lab.pine's canonical formula layer.
// This implementation stays independent from domain helpers so the equivalence
// test can detect drift instead of comparing a function with itself.

import { pathToFileURL } from 'node:url'

export const DEFAULTS = {
  trading_sessions_per_year: 365,
  delta_slope: 0.3,
  lp_range_width: 0.1,
  lp_skew: 1,
  profile: 'Balanced',
  auto_adapt: false,
  relax_mode: false,
}

export function derivePineWindows(prefixSize) {
  const prefix_n = Math.max(1, Math.floor(Number(prefixSize) || 1))
  const cost_window = Math.max(5, Math.floor(Math.sqrt(prefix_n)))
  const recent_window = Math.max(3, Math.floor(Math.sqrt(cost_window)))
  return { prefix_n, cost_window, recent_window, vol_window: cost_window }
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function sampleStdev(values) {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1))
}

function vwapTypical(rows) {
  if (!rows.length) return 0
  const totalVolume = rows.reduce((sum, row) => sum + row.volume, 0)
  if (totalVolume <= 0) return mean(rows.map((row) => (row.high + row.low + row.close) / 3))
  return rows.reduce((sum, row) => sum + ((row.high + row.low + row.close) / 3) * row.volume, 0) / totalVolume
}

function returnsThrough(rows, index, window) {
  const start = Math.max(1, index - window + 1)
  const values = []
  for (let i = start; i <= index; i += 1) {
    const previous = rows[i - 1]?.close
    const current = rows[i]?.close
    if (previous > 0 && current > 0) values.push(Math.log(current / previous))
  }
  return values
}

function costAt(rows, index, windows) {
  const end = index + 1
  const anchorRows = rows.slice(Math.max(0, end - windows.cost_window), end)
  const bandRows = rows.slice(Math.max(0, end - windows.cost_window - 1), end)
  const anchor = vwapTypical(anchorRows)
  const returns = bandRows.slice(1).map((row, offset) => Math.log(row.close / bandRows[offset].close))
  const volEstimate = sampleStdev(returns) * Math.sqrt(Math.min(windows.recent_window, returns.length || 1))
  const bandWidth = Math.max(volEstimate, Math.max(volEstimate * 0.25, 0.005))
  return {
    anchor,
    lower: anchor * (1 - bandWidth),
    upper: anchor * (1 + bandWidth),
    bandWidth,
  }
}

function trueRangeAt(rows, index) {
  if (index < 1) return 0
  const row = rows[index]
  const previous = rows[index - 1].close
  return Math.max(row.high - row.low, Math.abs(row.high - previous), Math.abs(row.low - previous))
}

function prefixStates(rows, tradingSessionsPerYear) {
  return rows.map((row, index) => {
    const windows = derivePineWindows(index + 1)
    const cost = costAt(rows, index, windows)
    const returns = returnsThrough(rows, index, windows.vol_window)
    const annual_vol = returns.length >= 5 ? sampleStdev(returns) * Math.sqrt(tradingSessionsPerYear) : 0
    const atrStart = Math.max(1, index - windows.recent_window + 1)
    const atrValues = []
    for (let cursor = atrStart; cursor <= index; cursor += 1) atrValues.push(trueRangeAt(rows, cursor))
    const atr = mean(atrValues)
    const cost_distance = cost.anchor > 0 ? (row.close - cost.anchor) / cost.anchor : NaN
    return {
      ...windows,
      ...cost,
      annual_vol,
      atr_pct: row.close > 0 ? atr / row.close : 0,
      cost_distance,
    }
  })
}

function expandingAr1ThroughOrigin(states) {
  if (states.length < 5) return { rho: NaN, half_life_sessions: NaN, valid: false }
  let sumXY = 0
  let sumX2 = 0
  for (let index = 1; index < states.length; index += 1) {
    const current = states[index].cost_distance
    const previous = states[index - 1].cost_distance
    if (!Number.isFinite(current) || !Number.isFinite(previous)) continue
    sumXY += current * previous
    sumX2 += previous * previous
  }
  const rho = sumX2 > 0 ? sumXY / sumX2 : 0
  const valid = rho > 0 && rho < 1
  const half_life_sessions = valid ? Math.log(2) / -Math.log(rho) : NaN
  return { rho, half_life_sessions, valid }
}

function resolveCycleStart(rows, states) {
  const pointIndex = rows.length - 1
  const row = rows[pointIndex]
  const state = states[pointIndex]
  const side = row.close > state.anchor ? 'short' : 'long'
  const target_price = side === 'short' ? state.upper : state.lower
  const target_source = side === 'short' ? 'adaptive-cost-upper' : 'adaptive-cost-lower'
  const windowStart = Math.max(0, pointIndex - state.cost_window + 1)
  let windowExtreme = null

  for (let cursor = windowStart; cursor <= pointIndex; cursor += 1) {
    const candidate = candleExtreme(rows[cursor], cursor, side)
    if (!candidate) continue
    if (
      !windowExtreme ||
      (side === 'long' ? candidate.price <= windowExtreme.price : candidate.price >= windowExtreme.price)
    ) {
      windowExtreme = candidate
    }
  }

  if (validStructure(windowExtreme?.price, target_price, state.anchor, side)) {
    return {
      ...windowExtreme,
      side,
      target_price,
      target_source,
      source: side === 'long' ? 'adaptive-cost-window-low-extreme' : 'adaptive-cost-window-high-extreme',
    }
  }

  for (let cursor = pointIndex; cursor >= 0; cursor -= 1) {
    const candidate = candleExtreme(rows[cursor], cursor, side)
    const boundary = positive(side === 'long' ? states[cursor]?.lower : states[cursor]?.upper)
    if (!candidate || !crossesBoundary(candidate.price, boundary, side)) continue
    if (!validStructure(candidate.price, target_price, state.anchor, side)) continue
    return {
      ...candidate,
      side,
      target_price,
      target_source,
      source: side === 'long' ? 'recent-dynamic-lower-crossing' : 'recent-dynamic-upper-crossing',
    }
  }

  return {
    ...windowExtreme,
    side,
    target_price,
    target_source,
    source: side === 'long' ? 'adaptive-cost-window-low-extreme' : 'adaptive-cost-window-high-extreme',
  }
}

function candleExtreme(row, index, side) {
  const price = positive(side === 'long' ? row?.low : row?.high)
  return price === null ? null : { price, date: row?.date ?? null, index }
}

function validStructure(cycleStartPrice, targetPrice, anchorPrice, side) {
  if (![cycleStartPrice, targetPrice, anchorPrice].every(Number.isFinite)) return false
  return side === 'short'
    ? cycleStartPrice > targetPrice && targetPrice > anchorPrice
    : cycleStartPrice < targetPrice && targetPrice < anchorPrice
}

function crossesBoundary(price, boundary, side) {
  if (![price, boundary].every(Number.isFinite)) return false
  return side === 'short' ? price > boundary : price < boundary
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function getDeltaBand({ entryPrice, horizonSessions, iv, deltaSlope, tradingSessionsPerYear }) {
  const wave = iv * Math.sqrt(horizonSessions / (tradingSessionsPerYear * 2 * Math.PI))
  if (!(entryPrice > 0 && horizonSessions > 0 && iv > 0 && wave > 0 && wave < 1)) return null
  const longRatio = ((1 + wave) / (1 - wave)) ** 2
  const longCost = (entryPrice * (deltaSlope * longRatio - deltaSlope + 1) ** 2) / longRatio
  const shortRatio = 1 / longRatio
  const shortCost = (entryPrice * (deltaSlope * shortRatio - deltaSlope + 1) ** 2) / shortRatio
  return {
    wave,
    long_cost: longCost,
    long_high: longCost * longRatio,
    long_low: longCost / longRatio,
    short_cost: shortCost,
    short_high: shortCost / shortRatio,
    short_low: shortCost * shortRatio,
  }
}

function normCdfAbs(x) {
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const sign = x >= 0 ? 1 : -1
  const abs = Math.abs(x)
  const t = 1 / (1 + p * abs)
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-abs * abs)
  return 0.5 * (1 + sign * y)
}

export function pineEquivalent(rows, inputs = {}) {
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('pineEquivalent 需要至少 2 根 K 线')
  const opts = { ...DEFAULTS, ...inputs }
  const states = prefixStates(rows, opts.trading_sessions_per_year)
  const last = rows.at(-1)
  const state = states.at(-1)
  const ar = expandingAr1ThroughOrigin(states)
  const cycleStart = resolveCycleStart(rows, states)
  const direction = cycleStart.side === 'short' ? -1 : 1
  const anchorGap = (state.anchor - cycleStart.price) * direction
  const targetGap = (cycleStart.target_price - cycleStart.price) * direction
  const recovery_fraction = anchorGap !== 0 ? targetGap / anchorGap : NaN
  const recoveryValid = anchorGap > 0 && targetGap > 0 && recovery_fraction > 0 && recovery_fraction < 1
  const formula_horizon_raw_sessions =
    ar.valid && recoveryValid ? ar.half_life_sessions * (Math.log(1 / (1 - recovery_fraction)) / Math.log(2)) : NaN
  const formula_horizon_sessions = formula_horizon_raw_sessions > 0 ? Math.ceil(formula_horizon_raw_sessions) : NaN
  const formula_ready = Number.isFinite(formula_horizon_sessions) && state.annual_vol > 0
  const delta = formula_ready
    ? getDeltaBand({
        entryPrice: state.anchor,
        horizonSessions: formula_horizon_sessions,
        iv: state.annual_vol,
        deltaSlope: opts.delta_slope,
        tradingSessionsPerYear: opts.trading_sessions_per_year,
      })
    : null
  const period_vol = delta
    ? state.annual_vol * Math.sqrt(formula_horizon_sessions / opts.trading_sessions_per_year)
    : NaN
  const z_score = period_vol > 0 ? state.cost_distance / period_vol : NaN
  const zAbs = Math.abs(z_score)
  const match_pct = Number.isFinite(zAbs)
    ? zAbs >= 8
      ? 1
      : Math.max(0, Math.min(1, 2 * normCdfAbs(zAbs / Math.sqrt(2)) - 1))
    : NaN

  return {
    prefix_n: state.prefix_n,
    cost_window: state.cost_window,
    recent_window: state.recent_window,
    vol_window: state.vol_window,
    cost_anchor: state.anchor,
    cost_low: state.lower,
    cost_high: state.upper,
    band_width: state.bandWidth,
    annual_vol: state.annual_vol,
    atr_pct: state.atr_pct,
    cost_distance: state.cost_distance,
    rho: ar.rho,
    half_life_sessions: ar.half_life_sessions,
    side: cycleStart.side,
    target_price: cycleStart.target_price,
    target_source: cycleStart.target_source,
    cycle_start_price: cycleStart.price,
    cycle_start_source: cycleStart.source,
    cycle_start_date: cycleStart.date,
    cycle_start_index: cycleStart.index,
    cycle_start_lookback_sessions: rows.length - 1 - cycleStart.index,
    anchor_gap: anchorGap,
    target_gap: targetGap,
    recovery_fraction,
    formula_horizon_raw_sessions,
    formula_horizon_sessions,
    formula_ready: Boolean(delta),
    signals_enabled: Boolean(delta),
    long_cost: delta?.long_cost ?? NaN,
    long_high: delta?.long_high ?? NaN,
    long_low: delta?.long_low ?? NaN,
    short_cost: delta?.short_cost ?? NaN,
    short_high: delta?.short_high ?? NaN,
    short_low: delta?.short_low ?? NaN,
    z_score,
    period_vol,
    match_pct,
    lp_lower: state.anchor * Math.max(1 - opts.lp_range_width, 0.001),
    lp_upper: state.anchor * (1 + opts.lp_range_width * opts.lp_skew),
    last_close: last.close,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const { parseCsvText } = await import('../src/domain/market-data/ohlcv.js')
  const path = process.argv[2] || 'public/data/600519-1d.csv'
  const text = readFileSync(resolve(process.cwd(), path), 'utf8')
  console.log(JSON.stringify(pineEquivalent(parseCsvText(text)), null, 2))
}
