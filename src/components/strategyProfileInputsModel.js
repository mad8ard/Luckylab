export const STRATEGY_FIELD_GROUPS = [
  {
    title: '入场过滤',
    fields: [
      { key: 'strategyEdgeSigma', label: '入场偏离σ', min: 0.1, max: 3, step: 0.05, hint: '成本偏离 / ATR' },
      { key: 'strategyMomentumSigma', label: '动量阈值σ', min: -2, max: 2, step: 0.05, hint: '自适应快动量 / 日波动' },
      { key: 'strategyCostSlopeSigma', label: '成本止跌σ', min: 0, max: 3, step: 0.05, hint: '成本斜率 / ATR' },
    ],
  },
  {
    title: '情景仓位',
    fields: [
      {
        key: 'strategyRiskPct',
        label: '模拟风险预算%',
        min: 0.1,
        max: 8,
        step: 0.1,
        pct: true,
        hint: '情景权益 × 模拟预算',
      },
      {
        key: 'strategyExposurePct',
        label: '模拟仓位上限%',
        min: 1,
        max: 100,
        step: 1,
        pct: true,
        hint: '情景权益 × 上限',
      },
      {
        key: 'strategyFirstWeight',
        label: '模拟首笔比例%',
        min: 5,
        max: 100,
        step: 1,
        pct: true,
        hint: '最大模拟名义 × 首笔',
      },
    ],
  },
  {
    title: '节奏 / 风控',
    fields: [
      { key: 'strategyCooldownFactor', label: '冷却系数', min: 0.25, max: 8, step: 0.25, hint: '买/卖冷却天数' },
      { key: 'strategyCutLossSigma', label: '风控动量σ', min: 0.1, max: 5, step: 0.1, hint: '动量破坏阈值' },
    ],
  },
]

export function strategyFieldValue(input, field) {
  const value = Number(input[field.key])
  if (!Number.isFinite(value)) return ''
  return field.pct ? Number((value * 100).toFixed(2)) : value
}

export function setStrategyFieldValue(input, field, raw) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  const normalized = field.pct ? value / 100 : value
  input[field.key] = Math.min(
    field.max / (field.pct ? 100 : 1),
    Math.max(field.min / (field.pct ? 100 : 1), normalized),
  )
}

export function formatStrategyNumber(value) {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

export function formatStrategyPct(value) {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(2)}%`
}

export function formatStrategyFactor(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : '—'
}
