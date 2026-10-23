// 历史相似节点的对照变体：同股、同股+市场 regime、全池+regime。
// 只做历史研究，不产生交易信号。

import {
  ANALOG_DEFAULTS,
  ANALOG_FEATURE_SPECS,
  analogDistance,
  findAnalogMatches,
  validateAnalogMethod,
} from './analogAudit.js'

export function buildRegimeMap(indexRows, options = {}) {
  const lookback = positiveInt(options.lookback, 20)
  const highVolThreshold = Number.isFinite(Number(options.highVolThreshold)) ? Number(options.highVolThreshold) : 0.2
  if (!Array.isArray(indexRows) || indexRows.length <= lookback) return new Map()
  const closes = indexRows.map((row) => Number(row.close))
  const returns = closes.map((close, index) => index > 0 && closes[index - 1] > 0 ? Math.log(close / closes[index - 1]) : 0)
  const map = new Map()
  for (let index = lookback; index < closes.length; index += 1) {
    const ret20 = closes[index - lookback] > 0 ? closes[index] / closes[index - lookback] - 1 : null
    const window = returns.slice(index - lookback + 1, index + 1)
    const vol20 = standardDeviation(window) * Math.sqrt(242)
    map.set(indexRows[index].date, {
      trend: ret20 === null ? null : ret20 >= 0 ? 'up' : 'down',
      volBucket: vol20 >= highVolThreshold ? 'high' : 'low',
      ret20Pct: ret20 === null ? null : round(ret20 * 100, 2),
      vol20Pct: round(vol20 * 100, 2),
    })
  }
  return map
}

export function findPoolAnalogMatches({ target, pool, currentIndex, options = {} }) {
  const config = { ...ANALOG_DEFAULTS, ...options }
  const current = target?.series?.[currentIndex]
  if (!current) return []
  const minHistory = Math.max(positiveInt(config.minHistory, ANALOG_DEFAULTS.minHistory), 20)
  const minForward = positiveInt(config.minForward, ANALOG_DEFAULTS.minForward)
  const maxIndex = Number.isFinite(config.maxIndex) ? config.maxIndex : Infinity
  const maxPerSource = positiveInt(config.maxPerSource, 2)
  const currentDate = Date.parse(target.rows[currentIndex].date)
  const candidates = []
  for (const stock of pool) {
    if (!stock?.rows || !stock?.series) continue
    if (config.excludeSymbol && stock.symbol === config.excludeSymbol) continue
    const end = Math.min(stock.rows.length - minForward - 1, maxIndex)
    for (let index = minHistory; index <= end; index += 1) {
      const features = stock.series[index]
      if (!features) continue
      const distance = analogDistance(features, current, ANALOG_FEATURE_SPECS, { useRegime: config.useRegime })
      if (distance === null) continue
      const date = stock.rows[index].date
      const ageDays = Math.max(0, (currentDate - Date.parse(date)) / 86400000)
      const recency = 0.5 ** (ageDays / 365)
      const similarity = Math.exp(-distance / positiveNumber(config.bandwidth, ANALOG_DEFAULTS.bandwidth))
      candidates.push({
        index,
        date,
        sourceSymbol: stock.symbol,
        sourceRows: stock.rows,
        distance: round(distance, 4),
        similarity: round(similarity, 4),
        recency: round(recency, 4),
        weight: similarity * recency,
      })
    }
  }
  candidates.sort((left, right) => left.distance - right.distance || left.date.localeCompare(right.date))
  const selected = []
  const counts = new Map()
  for (const candidate of candidates) {
    const sourceCount = counts.get(candidate.sourceSymbol) ?? 0
    if (sourceCount >= maxPerSource) continue
    const sameSource = selected.filter((item) => item.sourceSymbol === candidate.sourceSymbol)
    if (sameSource.some((item) => Math.abs(item.index - candidate.index) < config.minGap)) continue
    selected.push(candidate)
    counts.set(candidate.sourceSymbol, sourceCount + 1)
    if (selected.length >= config.topK) break
  }
  return selected
}

export function createVariantMatchers(stocks) {
  const sameStock = (stock, cutoff, config) => findAnalogMatches({
    rows: stock.rows,
    series: stock.series,
    currentIndex: cutoff,
    options: { ...config, maxIndex: cutoff - config.minForward },
  })
  const sameStockRegime = (stock, cutoff, config) => findAnalogMatches({
    rows: stock.rows,
    series: stock.series,
    currentIndex: cutoff,
    options: { ...config, maxIndex: cutoff - config.minForward, useRegime: true },
  })
  const crossSectional = (stock, cutoff, config) => findPoolAnalogMatches({
    target: stock,
    pool: stocks,
    currentIndex: cutoff,
    options: { ...config, maxIndex: cutoff - config.minForward, excludeSymbol: stock.symbol, useRegime: true },
  })
  return { sameStock, sameStockRegime, crossSectional }
}

export function validateVariants(stocks, options = {}) {
  const matchers = options.matchers ?? createVariantMatchers(stocks)
  const validation = {}
  for (const name of Object.keys(matchers)) {
    const base = { ...ANALOG_DEFAULTS, ...options, matcher: matchers[name] }
    const design = validateAnalogMethod(stocks, { ...base, fractions: [0.6, 0.7] })
    const test = validateAnalogMethod(stocks, { ...base, fractions: [0.8] })
    validation[name] = { design, test }
  }
  return validation
}

export function choosePrimaryVariant(validation) {
  const names = Object.keys(validation ?? {})
  const ranked = names
    .filter((name) => validation[name]?.design?.status === 'ok')
    .sort((left, right) => {
      const a = validation[left].design
      const b = validation[right].design
      return (b.targetRankCorrelation ?? -1) - (a.targetRankCorrelation ?? -1)
        || (b.maeRankCorrelation ?? -1) - (a.maeRankCorrelation ?? -1)
        || (b.fwd10RankCorrelation ?? -1) - (a.fwd10RankCorrelation ?? -1)
    })
  return ranked[0] ?? 'sameStock'
}

function standardDeviation(values) {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function positiveInt(value, fallback) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : fallback
}

function positiveNumber(value, fallback) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
