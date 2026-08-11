export const FORMULA_CHART_LAYOUT = Object.freeze({ W: 520, H: 200, PL: 50, PR: 16, PT: 22, PB: 24 })

export function fmt(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value) : '—'
}

export function f4(value) {
  return Number.isFinite(value) ? value.toFixed(4) : '—'
}

export function pctFmt(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—'
}
