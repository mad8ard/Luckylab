function pct(value, digits = 1) {
  if (!Number.isFinite(value)) return ''
  return `${(Math.abs(value) * 100).toFixed(digits)}%`
}

export function summarizeRegime(payload) {
  if (!payload || typeof payload !== 'object') return '载入 K 线后判断'

  const { costDistance, costWindow } = payload
  if (!Number.isFinite(costDistance)) return '载入 K 线后判断'

  const window = Number.isFinite(costWindow) && costWindow > 0 ? Math.round(costWindow) : 60
  const baseline = `近 ${window} 日均价`
  const distance = pct(costDistance)

  if (costDistance < -0.05) return `低于${baseline} ${distance}，处于成本带下方`
  if (costDistance < -0.01) return `低于${baseline} ${distance}，接近成本带下沿`
  if (costDistance > 0.05) return `高于${baseline} ${distance}，处于成本带上方`
  if (costDistance > 0.01) return `回归区上沿 ${distance}，略高于${baseline}，观察方向`
  return '贴近均价，未出现明显成本偏离'
}

export function summarizeRegression(payload) {
  if (!payload || typeof payload !== 'object') return null

  const { regressionProb } = payload
  if (!Number.isFinite(regressionProb)) return null

  return `历史上类似偏离，${Math.round(regressionProb * 100)}% 概率回归均价`
}

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
  return costDistance < 0
    ? `低于均价 ${distance}`
    : `高于均价 ${distance}`
}
