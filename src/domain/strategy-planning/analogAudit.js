// 历史相似节点审核：同股历史优先，价格/成本/波动特征匹配。
// 只使用当时可见的前缀数据；未来收益只用于评估匹配结果，不参与特征。

import { buildMarketStatePath } from '../market-data/cost.js'
import { uniswapV3Inventory } from '../formulas/lp.js'

export const ANALOG_FEATURE_SPECS = Object.freeze([
  { key: 'costDistancePct', label: '距成本锚', weight: 1, scale: 5 },
  { key: 'zScore', label: 'z 偏离', weight: 1, scale: 1 },
  { key: 'lpPercentile', label: '合成几何百分位', weight: 1, scale: 25 },
  { key: 'costSlopePct', label: '成本锚斜率', weight: 0.8, scale: 2.5 },
  { key: 'annualVolPct', label: '年化波动', weight: 0.5, scale: 15 },
])

export const ANALOG_DEFAULTS = Object.freeze({
  topK: 20,
  minGap: 20,
  minHistory: 60,
  minForward: 20,
  bandwidth: 0.75,
  rangeWidth: 0.1,
  horizons: [5, 10, 20, 60],
  targetPct: 3,
  stopPct: 1.5,
  minAnalogs: 8,
  useRegime: false,
})

export function buildAnalogFeatureSeries(rows, options = {}) {
  const tdpy = positiveInt(options.tdpy, 242)
  const rangeWidth = positiveNumber(options.rangeWidth, ANALOG_DEFAULTS.rangeWidth)
  const marketPath = buildMarketStatePath(rows, tdpy)
  const lpValues = rows.map((row, index) => lpAt(row.close, marketPath[index]?.costAnchor, rangeWidth))
  const series = rows.map((row, index) => {
    const market = marketPath[index]
    if (!market) return null
    const halfWidth = market.costHigh > market.costAnchor
      ? market.costHigh - market.costAnchor
      : market.costLow < market.costAnchor
        ? market.costAnchor - market.costLow
        : null
    const zScore = halfWidth && halfWidth > 0 ? (row.close - market.costAnchor) / halfWidth : null
    const currentLp = lpValues[index]
    const windowStart = Math.max(0, index - tdpy + 1)
    const lpWindow = lpValues
      .slice(windowStart, index + 1)
      .map((item) => item?.value)
      .filter(Number.isFinite)
    return {
      index,
      date: row.date,
      close: row.close,
      costDistancePct: finite(market.costDistance) ? market.costDistance * 100 : null,
      zScore,
      lpPercentile: lpWindow.length >= 20 && currentLp ? percentileRank(lpWindow, currentLp.value) : null,
      costSlopePct: finite(market.costSlopeRecent) ? market.costSlopeRecent * 100 : null,
      annualVolPct: finite(market.annualVol) ? market.annualVol * 100 : null,
      lpZone: currentLp?.zone ?? null,
      regime: options.regimeByDate?.get(row.date) ?? null,
    }
  })
  return { series, tdpy, rangeWidth, marketPath }
}

export function findAnalogMatches({ rows, series, currentIndex, options = {} }) {
  const config = { ...ANALOG_DEFAULTS, ...options }
  const current = series[currentIndex]
  if (!current) return []
  const minHistory = Math.max(positiveInt(config.minHistory, ANALOG_DEFAULTS.minHistory), 20)
  const minForward = Math.max(1, positiveInt(config.minForward, ANALOG_DEFAULTS.minForward))
  const maxIndex = Number.isFinite(config.maxIndex)
    ? Math.min(config.maxIndex, rows.length - minForward - 1)
    : rows.length - minForward - 1
  const candidates = []
  for (let index = minHistory; index <= maxIndex; index += 1) {
    if (index === currentIndex) continue
    const features = series[index]
    if (!features) continue
    const distance = analogDistance(features, current, ANALOG_FEATURE_SPECS, { useRegime: config.useRegime })
    if (distance === null) continue
    const age = Math.max(0, currentIndex - index)
    const recency = 0.5 ** (age / 252)
    const similarity = Math.exp(-distance / positiveNumber(config.bandwidth, ANALOG_DEFAULTS.bandwidth))
    candidates.push({ index, date: rows[index].date, distance: round(distance, 4), similarity: round(similarity, 4), recency: round(recency, 4), weight: similarity * recency })
  }
  candidates.sort((left, right) => left.distance - right.distance || left.index - right.index)
  const selected = []
  for (const candidate of candidates) {
    if (selected.every((item) => Math.abs(item.index - candidate.index) >= config.minGap)) {
      selected.push(candidate)
      if (selected.length >= config.topK) break
    }
  }
  return selected
}

export function analogDistance(left, right, specs = ANALOG_FEATURE_SPECS, options = {}) {
  if (!left || !right) return null
  let total = 0
  let weightSum = 0
  let usable = 0
  for (const spec of specs) {
    const a = left[spec.key]
    const b = right[spec.key]
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    const delta = (a - b) / spec.scale
    total += spec.weight * delta * delta
    weightSum += spec.weight
    usable += 1
  }
  if (usable < 3 || weightSum <= 0) return null
  let distance = Math.sqrt(total / weightSum)
  if (left.lpZone && right.lpZone && left.lpZone !== right.lpZone) distance += 0.35
  if (options.useRegime && left.regime && right.regime) {
    if (left.regime.trend !== right.regime.trend) distance += 0.5
    if (left.regime.volBucket !== right.regime.volBucket) distance += 0.25
  }
  return distance
}

export function computeAnalogOutcomes(rows, index, options = {}) {
  const config = { ...ANALOG_DEFAULTS, ...options }
  const entryRow = rows[index + 1]
  if (!entryRow || !positiveNumber(entryRow.open, 0)) return null
  const entry = entryRow.open
  const outcomes = {}
  for (const horizon of config.horizons) {
    const exitIndex = index + horizon
    const exitRow = rows[exitIndex]
    const forwardReturnPct = exitRow ? round((exitRow.close / entry - 1) * 100, 2) : null
    const path = rows.slice(index + 1, Math.min(index + horizon + 1, rows.length))
    const maePct = path.length ? round((Math.min(...path.map((row) => row.low)) / entry - 1) * 100, 2) : null
    outcomes[`fwd${horizon}Pct`] = forwardReturnPct
    outcomes[`mae${horizon}Pct`] = maePct
  }
  const target = entry * (1 + config.targetPct / 100)
  const stop = entry * (1 - config.stopPct / 100)
  let outcome = 'horizon'
  let targetFirst = false
  let stopFirst = false
  for (let cursor = index + 1; cursor <= index + 20 && cursor < rows.length; cursor += 1) {
    const row = rows[cursor]
    const hitStop = row.low <= stop
    const hitTarget = row.high >= target
    if (hitStop && hitTarget) { stopFirst = true; outcome = 'stop'; break }
    if (hitStop) { stopFirst = true; outcome = 'stop'; break }
    if (hitTarget) { targetFirst = true; outcome = 'target'; break }
  }
  return {
    entryDate: entryRow.date,
    entryPrice: round(entry, 3),
    outcomes,
    outcome,
    targetFirst,
    stopFirst,
    targetFirst20: targetFirst ? 1 : 0,
  }
}

export function summarizeAnalogs(analogs, rows) {
  const enriched = analogs.map((analog) => {
    const outcome = computeAnalogOutcomes(analog.sourceRows ?? rows, analog.index)
    return {
      ...analog,
      ...(outcome ?? {}),
      ...(outcome?.outcomes ?? {}),
    }
  }).filter((item) => Number.isFinite(item.fwd20Pct))
  if (!enriched.length) {
    return { count: 0, effectiveCount: 0, analogs: [], fwd5: null, fwd10: null, fwd20: null, fwd60: null, mae20: null, targetFirstRate: null, avgSimilarity: null, sampleConfidence: 0, fwd10MedianPct: null, fwd20MedianPct: null, winRate20Pct: null, mae20MedianPct: null, mae20TailPct: null }
  }
  const weights = enriched.map((item) => item.weight)
  const fwd10 = finiteValues(enriched.map((item) => item.fwd10Pct), weights)
  const fwd20 = finiteValues(enriched.map((item) => item.fwd20Pct), weights)
  const mae20 = finiteValues(enriched.map((item) => item.mae20Pct), weights)
  return {
    count: enriched.length,
    effectiveCount: round(effectiveSampleSize(weights), 2),
    analogs: enriched,
    fwd5: weightedSummary(enriched, 'fwd5Pct', weights),
    fwd10: weightedSummary(enriched, 'fwd10Pct', weights),
    fwd20: weightedSummary(enriched, 'fwd20Pct', weights),
    fwd60: weightedSummary(enriched, 'fwd60Pct', weights),
    mae20: weightedSummary(enriched, 'mae20Pct', weights),
    targetFirstRate: round(weightedRate(enriched.map((item) => item.targetFirst20), weights) * 100, 2),
    avgSimilarity: round(weightedMean(enriched.map((item) => item.similarity), weights), 4),
    sampleConfidence: round(sampleConfidence(weights, enriched), 4),
    fwd10MedianPct: weightedMedian(fwd10.values, fwd10.weights),
    fwd20MedianPct: weightedMedian(fwd20.values, fwd20.weights),
    winRate20Pct: round(weightedRate(enriched.map((item) => item.fwd20Pct), weights) * 100, 2),
    mae20MedianPct: weightedMedian(mae20.values, mae20.weights),
    mae20TailPct: weightedQuantile(mae20.values, mae20.weights, 0.1),
  }
}

export function scorePathStats(stats) {
  if (!stats || stats.count < ANALOG_DEFAULTS.minAnalogs) return null
  const targetScore = clamp01((stats.targetFirstRate ?? 0) / 100) * 100
  const maeScore = clamp01(((stats.mae20MedianPct ?? -15) + 15) / 15) * 100
  const returnScore = clamp01(((stats.fwd10MedianPct ?? -4) + 4) / 10) * 100
  return round((targetScore * 0.1 + maeScore * 0.4 + returnScore * 0.1) / 0.6, 2)
}

export function scoreAnalogAudit({ stats, sampleConfidence }) {
  if (!stats || stats.count < ANALOG_DEFAULTS.minAnalogs) {
    return { auditScore: null, status: 'insufficient-analogs', components: {}, availableWeight: 0 }
  }
  const returnScore = clamp01((stats.fwd10MedianPct + 4) / 10) * 100
  const maeScore = clamp01((stats.mae20MedianPct + 15) / 15) * 100
  const targetScore = clamp01(stats.targetFirstRate / 100) * 100
  const pathScore = round((returnScore * 0.1 + maeScore * 0.4 + targetScore * 0.1) / 0.6, 1)
  const confidence = Number.isFinite(sampleConfidence) ? sampleConfidence : stats.sampleConfidence
  const confidencePoints = clamp01(confidence) * 10
  return {
    auditScore: round(pathScore * 0.9 + confidencePoints, 1),
    status: 'ok',
    availableWeight: 1,
    components: {
      path: { raw: pathScore, score: pathScore, points: round(pathScore * 0.9, 1), max: 90 },
      confidence: { raw: round(confidence, 3), points: round(confidencePoints, 1), max: 10 },
    },
  }
}

export function pathScoreFromPredicted({ predictedTargetRatePct, predictedMaePct, predicted10MedianPct }) {
  const target = clamp01(predictedTargetRatePct / 100) * 100
  const mae = clamp01((predictedMaePct + 15) / 15) * 100
  const ret = clamp01((predicted10MedianPct + 4) / 10) * 100
  return round((target * 0.1 + mae * 0.4 + ret * 0.1) / 0.6, 4)
}

export function spearmanRankCorrelation(xs, ys) {
  const pairs = xs.map((x, index) => ({ x, y: ys[index] })).filter((pair) => Number.isFinite(pair.x) && Number.isFinite(pair.y))
  if (pairs.length < 3) return null
  const rx = averageRanks(pairs.map((pair) => pair.x))
  const ry = averageRanks(pairs.map((pair) => pair.y))
  return pearson(rx, ry)
}

export function validateAnalogMethod(stocks, options = {}) {
  const config = { ...ANALOG_DEFAULTS, ...options }
  const fractions = options.fractions ?? [0.6, 0.7, 0.8]
  const samples = []
  for (const stock of stocks) {
    const { rows, tdpy } = stock
    for (const fraction of fractions) {
      const cutoff = Math.floor(rows.length * fraction)
      if (cutoff < Math.max(config.minHistory, tdpy) + config.minForward) continue
      if (cutoff > rows.length - config.minForward - 1) continue
      const matcher = typeof options.matcher === 'function'
        ? options.matcher
        : (target, targetCutoff, targetConfig) => findAnalogMatches({
            rows: target.rows,
            series: target.series,
            currentIndex: targetCutoff,
            options: { ...targetConfig, maxIndex: targetCutoff - targetConfig.minForward },
          })
      const analogs = matcher(stock, cutoff, config)
      const stats = summarizeAnalogs(analogs, rows)
      const actual = computeAnalogOutcomes(rows, cutoff, config)
      if (!stats || stats.count < config.minAnalogs || !Number.isFinite(actual?.outcomes?.[`fwd${config.minForward}Pct`])) continue
      samples.push({
        symbol: stock.symbol,
        cutoffDate: rows[cutoff].date,
        predictedMedianPct: stats.fwd20MedianPct,
        predicted10MedianPct: stats.fwd10MedianPct,
        actual20Pct: actual.outcomes.fwd20Pct,
        actual10Pct: actual.outcomes.fwd10Pct,
        predictedWinRatePct: stats.winRate20Pct,
        actualWin: actual.outcomes.fwd20Pct > 0 ? 1 : 0,
        predictedTargetRatePct: stats.targetFirstRate,
        actualTarget: actual.targetFirst20,
        predictedMaePct: stats.mae20MedianPct,
        actualMaePct: actual.outcomes.mae20Pct,
        actualOutcome: actual.outcome,
        actualOutcomeScore: actual.outcome === 'target' ? 1 : actual.outcome === 'stop' ? -1 : 0,
        analogCount: stats.count,
        effectiveCount: stats.effectiveCount,
      })
    }
  }
  if (samples.length < 20) {
    return { status: 'insufficient', samples: samples.length, samplesList: samples, note: '样本外配对少于 20，暂不给出验证结论。' }
  }
  const predicted = samples.map((sample) => sample.predictedMedianPct)
  const actual = samples.map((sample) => sample.actual20Pct)
  const pathScores = samples.map((sample) => pathScoreFromPredicted(sample))
  const actualPaths = samples.map((sample) => sample.actualOutcomeScore)
  const pathSorted = samples
    .map((sample, index) => ({ ...sample, pathScore: pathScores[index] }))
    .sort((left, right) => right.pathScore - left.pathScore)
  const pathQuartile = Math.max(1, Math.floor(pathSorted.length / 4))
  const sorted = samples.slice().sort((left, right) => right.predictedMedianPct - left.predictedMedianPct)
  const quartile = Math.max(1, Math.floor(sorted.length / 4))
  const top = sorted.slice(0, quartile)
  const bottom = sorted.slice(-quartile)
  return {
    status: 'ok',
    samples: samples.length,
    pathRankCorrelation: round(spearmanRankCorrelation(pathScores, actualPaths) ?? 0, 4),
    pathTopQuartilePct: round(mean(pathSorted.slice(0, pathQuartile).map((sample) => sample.actualOutcomeScore)) * 100, 2),
    pathBottomQuartilePct: round(mean(pathSorted.slice(-pathQuartile).map((sample) => sample.actualOutcomeScore)) * 100, 2),
    rankCorrelation: round(spearmanRankCorrelation(predicted, actual) ?? 0, 4),
    winRankCorrelation: round(spearmanRankCorrelation(samples.map((sample) => sample.predictedWinRatePct), samples.map((sample) => sample.actualWin)) ?? 0, 4),
    fwd10RankCorrelation: round(spearmanRankCorrelation(samples.map((sample) => sample.predicted10MedianPct), samples.map((sample) => sample.actual10Pct)) ?? 0, 4),
    targetRankCorrelation: round(spearmanRankCorrelation(samples.map((sample) => sample.predictedTargetRatePct), samples.map((sample) => sample.actualTarget)) ?? 0, 4),
    maeRankCorrelation: round(spearmanRankCorrelation(samples.map((sample) => sample.predictedMaePct), samples.map((sample) => sample.actualMaePct)) ?? 0, 4),
    topQuartileActualPct: round(mean(top.map((sample) => sample.actual20Pct)), 2),
    bottomQuartileActualPct: round(mean(bottom.map((sample) => sample.actual20Pct)), 2),
    topQuartileWinRatePct: round(mean(top.map((sample) => sample.actualWin)) * 100, 2),
    bottomQuartileWinRatePct: round(mean(bottom.map((sample) => sample.actualWin)) * 100, 2),
    topQuartileTargetRatePct: round(mean(top.map((sample) => sample.actualTarget)) * 100, 2),
    bottomQuartileTargetRatePct: round(mean(bottom.map((sample) => sample.actualTarget)) * 100, 2),
    note: '预测值来自截止日之前相似节点的 20 日统计；实际值为截止日后的 20 日结果。该验证不含当前资金流。',
    samplesList: samples,
  }
}

function lpAt(price, anchor, rangeWidth) {
  if (![price, anchor].every((value) => Number.isFinite(value) && value > 0)) return null
  const lower = anchor * (1 - rangeWidth)
  const upper = anchor * (1 + rangeWidth)
  if (lower <= 0 || upper <= lower) return null
  return uniswapV3Inventory({ markPrice: price, lowerPrice: lower, upperPrice: upper, liquidity: 1 })
}

function percentileRank(values, value) {
  if (!Array.isArray(values) || !values.length || !Number.isFinite(value)) return null
  let count = 0
  for (const item of values) if (item <= value) count += 1
  return round(count / values.length * 100, 2)
}

function weightedSummary(rows, key, fallbackWeights) {
  const values = []
  const weights = []
  rows.forEach((row, index) => {
    const value = row[key]
    if (Number.isFinite(value)) {
      values.push(value)
      weights.push(fallbackWeights[index])
    }
  })
  if (!values.length) return null
  return {
    median: round(weightedQuantile(values, weights, 0.5), 2),
    mean: round(weightedMean(values, weights), 2),
    p10: round(weightedQuantile(values, weights, 0.1), 2),
    p90: round(weightedQuantile(values, weights, 0.9), 2),
    n: values.length,
  }
}

function finiteValues(values, weights) {
  const outValues = []
  const outWeights = []
  values.forEach((value, index) => {
    if (Number.isFinite(value)) {
      outValues.push(value)
      outWeights.push(weights[index])
    }
  })
  return { values: outValues, weights: outWeights }
}

function weightedMean(values, weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (!total) return 0
  return values.reduce((sum, value, index) => sum + value * weights[index], 0) / total
}

function weightedMedian(values, weights) {
  return weightedQuantile(values, weights, 0.5)
}

function weightedQuantile(values, weights, quantile) {
  if (!values.length) return null
  const pairs = values.map((value, index) => ({ value, weight: weights[index] })).sort((left, right) => left.value - right.value)
  const total = pairs.reduce((sum, pair) => sum + pair.weight, 0)
  if (!total) return pairs[Math.floor((pairs.length - 1) * quantile)].value
  let cumulative = 0
  for (const pair of pairs) {
    cumulative += pair.weight
    if (cumulative >= total * quantile) return pair.value
  }
  return pairs.at(-1).value
}

function weightedRate(values, weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (!total) return 0
  return values.reduce((sum, value, index) => sum + (value > 0 ? weights[index] : 0), 0) / total
}

function effectiveSampleSize(weights) {
  const sum = weights.reduce((total, weight) => total + weight, 0)
  const squares = weights.reduce((total, weight) => total + weight * weight, 0)
  return squares > 0 ? (sum * sum) / squares : 0
}

function sampleConfidence(weights, enriched) {
  const effective = effectiveSampleSize(weights)
  const sample = clamp01(effective / 12)
  const similarity = clamp01(weightedMean(enriched.map((item) => item.similarity), weights))
  return sample * 0.7 + similarity * 0.3
}

function averageRanks(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value)
  const ranks = new Array(values.length).fill(0)
  for (let i = 0; i < sorted.length; i += 1) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1].value === sorted[i].value) j += 1
    const rank = (i + j + 2) / 2
    for (let k = i; k <= j; k += 1) ranks[sorted[k].index] = rank
    i = j
  }
  return ranks
}

function pearson(xs, ys) {
  const n = xs.length
  if (n < 2) return null
  const mx = xs.reduce((sum, value) => sum + value, 0) / n
  const my = ys.reduce((sum, value) => sum + value, 0) / n
  let numerator = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i += 1) {
    const x = xs[i] - mx
    const y = ys[i] - my
    numerator += x * y
    dx += x * x
    dy += y * y
  }
  return dx > 0 && dy > 0 ? numerator / Math.sqrt(dx * dy) : null
}

function positiveInt(value, fallback) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : fallback
}

function positiveNumber(value, fallback) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback
}

function finite(value) {
  return Number.isFinite(value)
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
