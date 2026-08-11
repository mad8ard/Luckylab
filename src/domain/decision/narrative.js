function pct(value, digits = 1) {
  if (!Number.isFinite(value)) return ''
  return `${(Math.abs(value) * 100).toFixed(digits)}%`
}

export function summarizeRegime(payload) {
  if (!payload || typeof payload !== 'object') return '载入 K 线后判断'

  const { costDistance, costWindow } = payload
  if (!Number.isFinite(costDistance)) return '载入 K 线后判断'

  const baseline =
    Number.isFinite(costWindow) && costWindow > 0 ? `近 ${Math.round(costWindow)} 个交易会话均价` : '自适应前缀成本均价'
  const distance = pct(costDistance)

  if (costDistance < -0.05) return `低于${baseline} ${distance}，处于成本带下方`
  if (costDistance < -0.01) return `低于${baseline} ${distance}，接近成本带下沿`
  if (costDistance > 0.05) return `高于${baseline} ${distance}，处于成本带上方`
  if (costDistance > 0.01) return `回归区上沿 ${distance}，略高于${baseline}，观察方向`
  return '贴近均价，未出现明显成本偏离'
}

export function summarizeDeviation(payload) {
  if (!payload || typeof payload !== 'object') return null
  const { deviationPercentile, twoSidedTailProbability } = payload
  if (!Number.isFinite(deviationPercentile)) return null
  const tail = Number.isFinite(twoSidedTailProbability)
    ? `，双尾参考质量 ${Math.round(twoSidedTailProbability * 100)}%`
    : ''
  return `正态参考偏离百分位 ${Math.round(deviationPercentile * 100)}%${tail}；这不是未来回归概率`
}

export const summarizeRegression = summarizeDeviation

export function summarizeReason(payload) {
  if (!payload || typeof payload !== 'object') return '等待 K 线数据'

  const { costDistance, side } = payload
  if (!Number.isFinite(costDistance)) return '等待 K 线数据'

  const distance = pct(costDistance)

  if (side === 'sell') {
    if (costDistance > 0.05) return `高于均价 ${distance}，处于成本带上方`
    return `高于均价 ${distance}，记录为上方偏离`
  }

  if (side === 'buy') {
    if (costDistance < -0.05) return `低于均价 ${distance}，处于成本带下方`
    if (costDistance < -0.01) return `低于均价 ${distance}，记录为下方偏离`
    return '接近均价'
  }

  if (Math.abs(costDistance) < 0.01) return '价格贴近均价'
  return costDistance < 0 ? `低于均价 ${distance}` : `高于均价 ${distance}`
}
