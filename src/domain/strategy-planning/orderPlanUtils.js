export function erfApprox(x) {
  const sign = x < 0 ? -1 : 1
  const z = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * z)
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429]
  const poly = ((((a[4] * t + a[3]) * t + a[2]) * t + a[1]) * t + a[0]) * t
  return sign * (1 - poly * Math.exp(-z * z))
}

export function pctFmt(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
}

export function fmt(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('zh-CN') : '—'
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

export function formatPrice(value) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
    : '未知'
}
