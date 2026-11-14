// 港股独立研究推荐：只消费日线 OHLCV，不复用 A 股的财报、资金流或消息面假设。

import { buildMarketStatePath } from '../market-data/cost.js'
import { inferTdpy } from '../market-data/tdpy.js'
import { deriveDrawdownFeatures } from '../formulas/shortHold.js'

export const HK_RECOMMENDATION_WEIGHTS = Object.freeze({
  pricePosition: 25,
  costValuation: 20,
  drawdownRepair: 20,
  anchorTrend: 15,
  momentum20: 10,
  volumeConfirmation: 5,
  dataQuality: 5,
})

export const HK_RECOMMENDATION_GATES = Object.freeze({
  minRows: 80,
  maxStaleDays: 45,
  maxAnnualVol: 1,
  minAnchorSlope: -0.04,
  minMomentum20: -0.16,
  maxCostDistance: 0.18,
  minZScore: -4,
  maxZScore: 2.5,
})

export function rankHongKongCandidates(records, options = {}) {
  const limit = positiveInteger(options.limit) ?? 3
  const asOfDate = options.asOfDate ?? new Date().toISOString().slice(0, 10)
  const evaluated = records.map((record) =>
    evaluateHongKongCandidate({ ...record, asOfDate }),
  )
  const eligible = evaluated
    .filter((item) => item.eligible)
    .sort(
      (left, right) =>
        right.score - left.score ||
        String(right.metrics.dataThrough).localeCompare(String(left.metrics.dataThrough)) ||
        left.symbol.localeCompare(right.symbol),
    )
    .slice(0, limit)
    .map((item, index) => ({ ...item, rank: index + 1 }))
  return {
    asOfDate,
    evaluated,
    eligibleCount: evaluated.filter((item) => item.eligible).length,
    items: eligible,
  }
}

export function evaluateHongKongCandidate({ entry, rows, asOfDate }) {
  const symbol = String(entry?.symbol ?? '')
  const label = String(entry?.label ?? symbol)
  if (entry?.market !== '港股') {
    return ineligible(symbol, label, ['not-hong-kong'])
  }
  if (!Array.isArray(rows) || rows.length < HK_RECOMMENDATION_GATES.minRows) {
    return ineligible(symbol, label, ['insufficient-history'], {
      rows: Array.isArray(rows) ? rows.length : 0,
    })
  }

  const tdpy = inferTdpy(entry).value
  if (!Number.isFinite(tdpy) || tdpy <= 0) {
    return ineligible(symbol, label, ['missing-trading-days'])
  }
  const path = buildMarketStatePath(rows, tdpy)
  const market = path.at(-1)
  if (!market || !positive(market.costAnchor)) {
    return ineligible(symbol, label, ['missing-cost-anchor'])
  }

  const last = rows.at(-1)
  const dataThrough = String(last.date)
  const staleDays = daysBetween(dataThrough, asOfDate)
  const priceWindow = rows.slice(-Math.min(tdpy, rows.length)).map((row) => row.close)
  const pricePercentile = percentileRank(priceWindow, last.close)
  const momentum20 = trailingReturn(rows, 20)
  const volumeShort = average(rows.slice(-5).map((row) => row.volume))
  const volumeLong = average(rows.slice(-20).map((row) => row.volume))
  const volumeRatio = volumeLong > 0 ? volumeShort / volumeLong : null
  const halfBand = Math.max(
    Math.abs(market.costHigh - market.costAnchor),
    Math.abs(market.costAnchor - market.costLow),
  )
  const zScore = halfBand > 0 ? (last.close - market.costAnchor) / halfBand : null
  const drawdown = deriveDrawdownFeatures({
    rows,
    lookback: Math.min(tdpy, rows.length),
  })
  const repair =
    drawdown.status === 'ok' ? drawdown.drawdownRepair : null
  const historyAdequacy = clamp01(rows.length / (tdpy * 2))
  const freshness = clamp01(1 - staleDays / HK_RECOMMENDATION_GATES.maxStaleDays)

  const dimensions = {
    pricePosition: scoreDimension(
      '一年价格位置',
      HK_RECOMMENDATION_WEIGHTS.pricePosition,
      1 - pricePercentile,
      { pricePercentile },
    ),
    costValuation: scoreDimension(
      '成本锚估值偏离',
      HK_RECOMMENDATION_WEIGHTS.costValuation,
      Number.isFinite(zScore) ? linear(zScore, -2.8, 0.6) : 0,
      { zScore },
    ),
    drawdownRepair: scoreDimension(
      '一年回撤修复',
      HK_RECOMMENDATION_WEIGHTS.drawdownRepair,
      repair ?? 0,
      { drawdownRepair: repair },
    ),
    anchorTrend: scoreDimension(
      '成本锚近期趋势',
      HK_RECOMMENDATION_WEIGHTS.anchorTrend,
      linear(market.costSlopeRecent, -0.025, 0.01),
      { costSlopeRecent: market.costSlopeRecent },
    ),
    momentum20: scoreDimension(
      '20日价格动量',
      HK_RECOMMENDATION_WEIGHTS.momentum20,
      linear(momentum20, -0.12, 0.12),
      { return20: momentum20 },
    ),
    volumeConfirmation: scoreDimension(
      '短期量能确认',
      HK_RECOMMENDATION_WEIGHTS.volumeConfirmation,
      volumeRatio === null ? 0 : volumeScore(volumeRatio, momentum20),
      { volumeRatio },
    ),
    dataQuality: scoreDimension(
      '数据质量与新鲜度',
      HK_RECOMMENDATION_WEIGHTS.dataQuality,
      historyAdequacy * 0.6 + freshness * 0.4,
      { historyAdequacy, freshness },
    ),
  }
  const score = round2(
    Object.values(dimensions).reduce((total, item) => total + item.points, 0),
  )
  const gateReasons = []
  if (staleDays > HK_RECOMMENDATION_GATES.maxStaleDays) gateReasons.push('stale-data')
  if (market.annualVol > HK_RECOMMENDATION_GATES.maxAnnualVol) gateReasons.push('volatility-too-high')
  if (market.costSlopeRecent < HK_RECOMMENDATION_GATES.minAnchorSlope) gateReasons.push('anchor-still-falling')
  if (momentum20 < HK_RECOMMENDATION_GATES.minMomentum20) gateReasons.push('momentum-too-weak')
  if (market.costDistance > HK_RECOMMENDATION_GATES.maxCostDistance) gateReasons.push('too-far-above-anchor')
  if (Number.isFinite(zScore) && zScore < HK_RECOMMENDATION_GATES.minZScore) gateReasons.push('falling-knife')
  if (Number.isFinite(zScore) && zScore > HK_RECOMMENDATION_GATES.maxZScore) gateReasons.push('overextended')

  return {
    symbol,
    label,
    market: '港股',
    eligible: gateReasons.length === 0,
    gateReasons,
    score: gateReasons.length === 0 ? score : null,
    hits: Object.values(dimensions)
      .filter((item) => item.ratio >= 0.8)
      .map((item) => item.label),
    dimensions,
    metrics: {
      close: last.close,
      pricePercentile: round4(pricePercentile),
      costAnchor: round4(market.costAnchor),
      costDistance: round4(market.costDistance),
      zScore: nullableRound(zScore),
      costSlopeRecent: round4(market.costSlopeRecent),
      drawdownRepair: nullableRound(repair),
      drawdownDepth: drawdown.status === 'ok' ? round4(drawdown.drawdownDepth) : null,
      return20: round4(momentum20),
      volumeRatio: nullableRound(volumeRatio),
      annualVol: round4(market.annualVol),
      rows: rows.length,
      dataFrom: String(rows[0].date),
      dataThrough,
      staleDays,
    },
  }
}

function scoreDimension(label, weight, rawRatio, evidence) {
  const ratio = clamp01(rawRatio)
  return {
    label,
    weight,
    ratio: round4(ratio),
    points: round2(ratio * weight),
    evidence,
  }
}

function ineligible(symbol, label, gateReasons, metrics = {}) {
  return {
    symbol,
    label,
    market: '港股',
    eligible: false,
    gateReasons,
    score: null,
    hits: [],
    dimensions: {},
    metrics,
  }
}

function volumeScore(ratio, momentum20) {
  const expansion = linear(ratio, 0.65, 1.45)
  return momentum20 > 0 ? 0.35 + expansion * 0.65 : expansion * 0.5
}

function trailingReturn(rows, sessions) {
  const previous = rows[rows.length - 1 - sessions]
  const current = rows.at(-1)
  return previous?.close > 0 ? current.close / previous.close - 1 : 0
}

function percentileRank(values, target) {
  if (!values.length) return 0.5
  const below = values.filter((value) => value < target).length
  const equal = values.filter((value) => value === target).length
  return (below + Math.max(0, equal - 1) / 2) / Math.max(1, values.length - 1)
}

function daysBetween(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Infinity
  return Math.max(0, Math.floor((end - start) / 86400000))
}

function average(values) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0
}

function linear(value, minimum, maximum) {
  if (!Number.isFinite(value) || maximum <= minimum) return 0
  return clamp01((value - minimum) / (maximum - minimum))
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}

function positive(value) {
  return Number.isFinite(value) && value > 0
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null
}

function round2(value) {
  return Math.round(value * 100) / 100
}

function round4(value) {
  return Math.round(value * 10000) / 10000
}

function nullableRound(value) {
  return Number.isFinite(value) ? round4(value) : null
}
