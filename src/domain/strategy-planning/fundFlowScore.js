// 当前资金流确认分：同花顺全单资金净额（今日/3日/5日）。
// 只做当前确认，不进入历史回测；分数是横截面百分位的加权平均。

export const FUND_FLOW_WEIGHTS = Object.freeze({
  today: 0.25,
  d3: 0.35,
  d5: 0.4,
})

const WINDOW_KEYS = ['today', 'd3', 'd5']

export function percentileRank(values, value) {
  if (!Array.isArray(values) || values.length === 0 || !Number.isFinite(value)) return null
  let count = 0
  for (const item of values) if (Number.isFinite(item) && item <= value) count += 1
  return round(count / values.length * 100, 2)
}

export function computeFundFlowScore(row, weights = FUND_FLOW_WEIGHTS) {
  const components = {}
  const usedWindows = []
  const missingWindows = []
  let weighted = 0
  let weightSum = 0
  for (const key of WINDOW_KEYS) {
    const rawPercentile = row?.[`${key}Pct`]
    const percentile = rawPercentile === null || rawPercentile === undefined || rawPercentile === '' ? Number.NaN : Number(rawPercentile)
    const weight = Number(weights?.[key])
    if (!Number.isFinite(percentile) || !Number.isFinite(weight)) {
      missingWindows.push(key)
      continue
    }
    const contribution = percentile * weight
    components[key] = {
      percentile: round(percentile, 2),
      weight: round(weight, 2),
      contribution: round(contribution, 2),
    }
    weighted += contribution
    weightSum += weight
    usedWindows.push(key)
  }
  return {
    score: weightSum > 0 ? round(weighted / weightSum, 2) : null,
    components,
    usedWindows,
    missingWindows,
    weightSum: round(weightSum, 2),
  }
}

export function fundFlowBand(score) {
  if (!Number.isFinite(score)) return { key: 'missing', label: '缺失' }
  if (score >= 75) return { key: 'strong', label: '强确认' }
  if (score >= 55) return { key: 'positive', label: '偏正' }
  if (score >= 35) return { key: 'neutral', label: '中性' }
  return { key: 'weak', label: '偏弱' }
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
