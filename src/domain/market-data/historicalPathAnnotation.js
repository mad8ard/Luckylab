// 第四步结论后的历史路径旁注：只读计算，不参与推荐、排序或资金流评分。

import { buildCostPath } from './cost.js'

export const HISTORICAL_PATH_THRESHOLDS = Object.freeze({
  belowAnchorWatch: 0.55,
  belowAnchorHigh: 0.65,
  annualSlopeWatch: -0.1,
  annualSlopeHigh: -0.2,
  maxDrawdownWatch: -0.5,
  maxDrawdownHigh: -0.7,
})

export function deriveHistoricalPathAnnotation(rows, options = {}) {
  if (!Array.isArray(rows) || rows.length < 2) {
    return {
      status: 'insufficient-history',
      rows: Array.isArray(rows) ? rows.length : 0,
    }
  }
  const tradingDaysPerYear = positiveNumber(options.tradingDaysPerYear) ?? 252
  const costPath = buildCostPath(rows)
  let belowAnchorCount = 0
  let peak = -Infinity
  let maxCloseDrawdown = 0
  const logCloses = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const anchor = costPath[index]?.anchor
    if (finitePositive(row?.close) && finitePositive(anchor) && row.close < anchor) {
      belowAnchorCount += 1
    }
    if (finitePositive(row?.close)) {
      peak = Math.max(peak, row.close)
      maxCloseDrawdown = Math.min(maxCloseDrawdown, row.close / peak - 1)
      logCloses.push(Math.log(row.close))
    }
  }
  const sampleCount = rows.length
  const annualizedLogSlope = ordinaryLeastSquaresSlope(logCloses) * tradingDaysPerYear
  const belowAnchorRatio = belowAnchorCount / sampleCount
  return {
    status: 'ok',
    dataFrom: String(rows[0].date),
    dataThrough: String(rows.at(-1).date),
    rows: sampleCount,
    belowAnchorRatio,
    annualizedLogSlope,
    maxCloseDrawdown,
    marks: {
      belowAnchorRatio: highIsWorse(
        belowAnchorRatio,
        HISTORICAL_PATH_THRESHOLDS.belowAnchorWatch,
        HISTORICAL_PATH_THRESHOLDS.belowAnchorHigh,
      ),
      annualizedLogSlope: lowIsWorse(
        annualizedLogSlope,
        HISTORICAL_PATH_THRESHOLDS.annualSlopeWatch,
        HISTORICAL_PATH_THRESHOLDS.annualSlopeHigh,
      ),
      maxCloseDrawdown: lowIsWorse(
        maxCloseDrawdown,
        HISTORICAL_PATH_THRESHOLDS.maxDrawdownWatch,
        HISTORICAL_PATH_THRESHOLDS.maxDrawdownHigh,
      ),
    },
  }
}

function ordinaryLeastSquaresSlope(values) {
  const count = values.length
  if (count < 2) return 0
  const xMean = (count - 1) / 2
  const yMean = values.reduce((sum, value) => sum + value, 0) / count
  let numerator = 0
  let denominator = 0
  for (let index = 0; index < count; index += 1) {
    const xDelta = index - xMean
    numerator += xDelta * (values[index] - yMean)
    denominator += xDelta * xDelta
  }
  return denominator > 0 ? numerator / denominator : 0
}

function highIsWorse(value, watch, high) {
  if (value >= high) return 'high'
  if (value >= watch) return 'watch'
  return 'normal'
}

function lowIsWorse(value, watch, high) {
  if (value <= high) return 'high'
  if (value <= watch) return 'watch'
  return 'normal'
}

function positiveNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : null
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0
}
