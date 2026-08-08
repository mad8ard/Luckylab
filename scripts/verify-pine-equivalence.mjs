// JS 双胞胎：逐行镜像 bl-esw-pinbar-market-lab.pine 的计算逻辑
// 任何 Pine 改动必须同步改这里，否则 src/test/pine-equivalence.test.js 会失败

import { pathToFileURL } from 'node:url'

export const DEFAULTS = {
  cost_len: 60,
  recent_len: 20,
  vol_len: 60,
  holding_days: 30,
  trading_days: 365,
  target_return_pct: 30,
  iv_override: 0,
  lp_range_width: 0.1,
  lp_skew: 1.0,
  profile: 'Balanced',
  auto_adapt: false,
  relax_mode: false,
  adaptive_cost: false,
}

function sampleStdev(values) {
  // Pine ta.stdev(..., false) 用 biased=false（除以 n-1，对齐 JS）
  if (values.length < 2) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function simpleMeanAtr(rows, period = 14) {
  // Pine ta.sma(true_range, 14)，对齐 JS average(trueRanges[index-13..index])
  // 注意：Pine 第一根 K 线的 true_range = na（close[1] na），此处用 0 作占位；
  // 在 fixture ≥ 14 行时 slice(-14) 不会包含 index 0，行为等价。
  const trs = rows.map((row, i) => {
    if (i === 0) return 0
    const prevClose = rows[i - 1].close
    return Math.max(row.high - row.low, Math.abs(row.high - prevClose), Math.abs(row.low - prevClose))
  })
  const recent = trs.slice(-period)
  return recent.reduce((s, v) => s + v, 0) / recent.length
}

function vwapTypical(rows) {
  if (!rows.length) return 0
  const totalVol = rows.reduce((s, r) => s + r.volume, 0)
  if (totalVol <= 0) {
    return rows.reduce((s, r) => s + (r.high + r.low + r.close) / 3, 0) / rows.length
  }
  return rows.reduce((s, r) => s + ((r.high + r.low + r.close) / 3) * r.volume, 0) / totalVol
}

export function pineEquivalent(rows, inputs = {}) {
  const opts = { ...DEFAULTS, ...inputs }
  const minRows = Math.max(opts.cost_len, opts.vol_len) + 5
  if (rows.length < minRows) {
    throw new Error(`pineEquivalent 需要至少 ${minRows} 根 K 线`)
  }
  const last = rows.at(-1)

  // cost anchor (VWAP of typical price)
  const anchorRows = rows.slice(-opts.cost_len)
  const cost_anchor = vwapTypical(anchorRows)

  // log returns（最近 cost_len 期，从 cost_len+1 行算 cost_len 个收益）
  // 镜像 Pine: log_ret = close[1] > 0 ? math.log(close / close[1]) : 0.0
  const bandRows = rows.slice(-(opts.cost_len + 1))
  const logRets = bandRows
    .slice(1)
    .map((row, i) => (bandRows[i].close > 0 ? Math.log(row.close / bandRows[i].close) : 0))
  const vol_estimate = sampleStdev(logRets) * Math.sqrt(Math.min(opts.recent_len, logRets.length))
  const min_band = Math.max(vol_estimate * 0.25, 0.005)
  const band_width = Math.max(vol_estimate, min_band)
  const cost_low = cost_anchor * (1 - band_width)
  const cost_high = cost_anchor * (1 + band_width)

  // LP 区间
  const lp_lower = cost_anchor * Math.max(1 - opts.lp_range_width, 0.001)
  const lp_upper = cost_anchor * (1 + opts.lp_range_width * opts.lp_skew)

  // annual vol（用 vol_len 个收益，sample stdev n-1）
  // 镜像 Pine 的零价格保护
  const volRows = rows.slice(-(opts.vol_len + 1))
  const volRets = volRows.slice(1).map((row, i) => (volRows[i].close > 0 ? Math.log(row.close / volRows[i].close) : 0))
  const annual_vol = Math.max(sampleStdev(volRets) * Math.sqrt(opts.trading_days), 0.01)

  // atr_pct（simple mean SMA 14，对齐 Pine ta.sma(true_range, 14)）
  const atr_14 = simpleMeanAtr(rows, 14)
  const atr_pct = last.close > 0 ? atr_14 / last.close : 0

  // GetDelta band
  const target_return = opts.target_return_pct / 100
  // 同步网站 IV 输入框：iv_override > 0 时用用户填值，否则退化到 annual_vol
  const effective_iv = opts.iv_override > 0 ? opts.iv_override : annual_vol
  const wave_raw = effective_iv * Math.sqrt(opts.holding_days / (opts.trading_days * 2 * Math.PI))
  const wave = Math.min(wave_raw, 0.99)
  let long_cost = NaN,
    long_high = NaN,
    long_low = NaN
  let short_cost = NaN,
    short_high = NaN,
    short_low = NaN
  if (wave > 0 && wave < 1 && cost_anchor > 0) {
    const long_ratio = ((1 + wave) / (1 - wave)) ** 2
    // 网站 formulaPath.js: entryPrice = bandAnchor (cost_anchor)，不是 close
    long_cost = (cost_anchor * (target_return * long_ratio - target_return + 1) ** 2) / long_ratio
    long_high = long_cost * long_ratio
    long_low = long_cost / long_ratio
    const short_ratio = 1 / long_ratio
    short_cost = (cost_anchor * (target_return * short_ratio - target_return + 1) ** 2) / short_ratio
    short_high = short_cost / short_ratio
    short_low = short_cost * short_ratio
  }

  // z score（用 holding 周期化）
  const period_vol = annual_vol > 0 ? annual_vol * Math.sqrt(opts.holding_days / opts.trading_days) : 0.01
  const cost_distance = cost_anchor > 0 ? last.close / cost_anchor - 1 : 0
  const z_score = period_vol > 0 ? cost_distance / period_vol : 0

  // Abramowitz 7.1.26 erf 近似（Pine 用同一套常数）
  const normCdfAbs = (x) => {
    const a1 = 0.254829592,
      a2 = -0.284496736,
      a3 = 1.421413741
    const a4 = -1.453152027,
      a5 = 1.061405429,
      p = 0.3275911
    const signX = x >= 0 ? 1 : -1
    const absX = Math.abs(x)
    const t = 1 / (1 + p * absX)
    const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX)
    return 0.5 * (1 + signX * y)
  }
  const z_abs = Math.abs(z_score)
  const phi_z = normCdfAbs(z_abs / Math.sqrt(2))
  const match_pct = z_abs >= 8 ? 1 : Math.max(0, Math.min(1, 2 * phi_z - 1))

  return {
    cost_anchor,
    cost_low,
    cost_high,
    lp_lower,
    lp_upper,
    annual_vol,
    atr_pct,
    long_cost,
    long_high,
    long_low,
    short_cost,
    short_high,
    short_low,
    z_score,
    cost_distance,
    period_vol,
    match_pct,
    band_width,
    last_close: last.close,
  }
}

// CLI 用法：node scripts/verify-pine-equivalence.mjs public/data/GOOG-1d.csv
// pathToFileURL 处理 Windows 三斜杠（file:///F:/...）和 Unix 差异
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const { parseCsvText } = await import('../src/domain/market-data/ohlcv.js')
  const path = process.argv[2] || 'public/data/GOOG-1d.csv'
  const text = readFileSync(resolve(process.cwd(), path), 'utf8')
  const rows = parseCsvText(text)
  console.log(JSON.stringify(pineEquivalent(rows), null, 2))
}
