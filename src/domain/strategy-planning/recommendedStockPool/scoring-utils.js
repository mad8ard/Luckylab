// 推荐股票池评分工具：纯标量函数，无外部依赖。
// 用于维度评分（forwardLinear / inverseLinear / zoneScore）、分级阈值（classify）、
// 文案格式化（formatHit / formatPct）以及 z 分布概率换算（regressionProbabilityFromZ）。

export function inverseLinear(value, fullPoint, zeroPoint) {
  const v = Number(value)
  if (!Number.isFinite(v)) return null
  if (zeroPoint === fullPoint) return 0
  return clamp01((v - zeroPoint) / (fullPoint - zeroPoint))
}

export function forwardLinear(value, lowPoint, highPoint) {
  const v = Number(value)
  if (!Number.isFinite(v)) return null
  if (highPoint === lowPoint) return 0
  return clamp01((v - lowPoint) / (highPoint - lowPoint))
}

export function zoneScore(zone) {
  if (zone === 'token0') return 1
  if (zone === 'range') return 0.45
  if (zone === 'token1') return 0
  return null
}

export function clamp01(v) {
  if (!Number.isFinite(v)) return 0
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

export function classify(score, maxScore, tiers) {
  if (!Number.isFinite(maxScore) || maxScore <= 0) return 'skip'
  const ratio = score / maxScore
  if (ratio >= tiers.focus) return 'focus'
  if (ratio >= tiers.wait) return 'wait'
  return 'skip'
}

export function round1(v) { return Number.isFinite(v) ? Math.round(v * 10) / 10 : 0 }
export function round2(v) { return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0 }

export function formatPct(v) {
  if (!Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
}

export function formatHit(id, m) {
  switch (id) {
    case 'lpValuePercentile': return `lpValue P${(m.lpValuePercentile * 100).toFixed(1)}%`
    case 'zScore':            return `z=${m.zScore.toFixed(2)}σ`
    case 'lpZone':            return 'token0 折价囤货'
    case 'costSlope':         return '成本锚↑'
    case 'jValue':            return `J=${m.j.toFixed(2)}`
    case 'rsi':               return `RSI=${m.rsi.toFixed(2)}`
    case 'lpRatio3y':         return `LP 3 年 ${m.lpValueRatio3y.toFixed(2)}×`
    case 'halfLife':          return `HL=${Math.round(m.halfLifeDays)}天`
    case 'volConfidence':     return '半衰期可信'
    case 'socialSecurityWhitelist': return '社保 Q1 白名单'
    default: return id
  }
}

// 暴露给外部用：用于在浏览器端动态算回归概率（前端权重调节时不必再去算 z）
export function regressionProbabilityFromZ(z) {
  if (!Number.isFinite(z)) return null
  const abs = Math.abs(z)
  const cdf = standardNormalCdf(abs)
  return Math.max(0, Math.min(1, 2 * cdf - 1))
}

function standardNormalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989422804014337 * Math.exp(-x * x / 2)
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x >= 0 ? 1 - p : p
}
