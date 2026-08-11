import { formatFormulaInputToken } from '../formula-research/formulaInputLabels.js'

export function buildWorkbenchSummary({ source, rows = [], graph }) {
  const decision = graph?.decision
  const dataThrough = rows.at(-1)?.date ?? source?.dataThrough ?? ''
  const dataState = resolveDataState(source, rows)
  const missingInput = currentGateMissingInput(decision)
  const blockedReason = decision?.blockedReasons?.[0] ?? null
  const positionGateReason =
    decision?.timing?.side && decision?.position?.missingInputs?.length
      ? (decision.position.rule ?? `缺少${humanizeMissingInput(decision.position.missingInputs[0])}，模拟挂单未生成。`)
      : null
  const reason = positionGateReason ?? decision?.timing?.reason ?? blockedReason ?? '等待市场样本形成明确条件。'
  const invalidation = decision?.invalidations?.[0] ?? null
  const reviewTrigger = decision?.reviewConditions?.[0] ?? null
  const review = invalidation
    ? { kind: 'invalidation', label: '何时失效', value: invalidation }
    : reviewTrigger
      ? { kind: 'review', label: '何时复核', value: reviewTrigger }
      : { kind: 'review', label: '何时复核', value: '尚未形成策略失效线；下一交易会话复核结构。' }
  const nextCheck = missingInput
    ? nextCheckForMissingInput(missingInput)
    : decision?.timing?.side && blockedReason
      ? `下一根 K 线后复核：${blockedReason}。`
      : '下一交易会话更新成本锚、上下沿与结构门禁；研究周期仍由公式动态推导，无执行方向或账户输入时不生成订单。'

  return {
    data: {
      state: dataState,
      label: dataStateLabel(dataState),
      detail: buildDataDetail(source, rows, dataThrough),
      dataThrough,
      rows: rows.length,
      source: source?.source ?? '本地数据源未标注',
      modelVersion: graph?.inputs?.modelVersion ?? null,
      modelLabel: modelVersionLabel(graph?.inputs?.modelVersion),
      claimClass: rows.length ? 'sample-estimate' : 'missing-input',
      claimLabel: rows.length ? '样本估计' : '缺少输入',
    },
    gate: {
      marketState: decision?.state ?? '等待载入',
      candidateStatus: decision?.candidateStatus ?? '等待',
      candidateLabel: `候选${decision?.candidateStatus ?? '等待'}`,
      executionStatus: decision?.executionStatus ?? 'blocked',
      executionLabel: executionStatusLabel(decision?.executionStatus),
    },
    reason,
    review,
    nextCheck,
    disclosure: '本地日线样本只用于研究；偏离度不是胜率，手绘标注不进入公式或模拟挂单。',
  }
}

function currentGateMissingInput(decision) {
  const timingMissing = decision?.timing?.missingInputs?.[0]
  if (timingMissing) return timingMissing
  if (!decision?.timing?.side) return null
  return decision?.position?.missingInputs?.[0] ?? decision?.missingInputs?.[0] ?? null
}

function resolveDataState(source, rows) {
  if (!rows.length) return 'invalid'
  if (source?.isStale) return 'stale'
  return 'provisional'
}

function dataStateLabel(state) {
  if (state === 'invalid') return '不可用'
  if (state === 'stale') return '需刷新'
  return '本地样本可研究'
}

function executionStatusLabel(status) {
  if (status === 'simulation-only') return '仅模拟'
  if (status === 'executable') return '可执行'
  return '不可执行'
}

function buildDataDetail(source, rows, dataThrough) {
  if (!rows.length) return '尚未载入 K 线。'
  const interval = source?.interval ?? '周期未标注'
  const date = dataThrough || '截止日未知'
  return `${rows.length} 根 ${interval} K 线 · 截至 ${date}`
}

function modelVersionLabel(version) {
  if (version === 'adaptive-prefix-ar-cycle-recovery-v2') return '前缀因果 · AR 动态周期 v2'
  if (version === 'adaptive-prefix-ar-recovery-v1') return '前缀因果 · AR 修复 v1'
  return version ? String(version) : '模型版本未标注'
}

function humanizeMissingInput(value) {
  const labels = {
    'account.capital': '账户资金',
    'account.basePosition': '底仓名义',
    'verified-market-iv-source': '可验证的市场波动率来源',
    'option-leg-premium': '期权腿报价',
    'formula-derived-horizon': '方向与结构目标绑定的有限公式周期',
    'side-target-horizon-binding': '方向、结构目标、成本锚与半衰期的周期绑定',
    'short-side-target-horizon-binding': '上沿减仓方向的独立结构目标与周期',
    'long-side-target-horizon-binding': '下沿修复方向的结构目标与周期',
    'delta-band': '与公式周期对应的 GetDelta 价格带',
    'dynamic-holding-state': '当前行情前缀生成的动态持仓门禁',
    volatility: '有效波动率口径',
    'trading-days-per-year': '市场年交易会话基准',
  }
  return labels[value] ?? formatFormulaInputToken(value)
}

function nextCheckForMissingInput(value) {
  const actions = {
    'formula-derived-horizon': '等待方向、前向结构目标与 AR 单调衰减门禁同时成立，周期由公式自动推导。',
    'side-target-horizon-binding': '先让方向、结构目标、冻结成本锚与半衰期形成同一绑定。',
    'short-side-target-horizon-binding': '先独立定义并验证上沿减仓目标；不得复用长侧修复周期。',
    'long-side-target-horizon-binding': '先验证成本下沿仍是观察价前方的长侧修复目标。',
    'delta-band': '公式周期成立后，再生成同周期 GetDelta 价格带。',
    'dynamic-holding-state': '等待当前行情前缀同时形成结构周期、回撤阶段与动态持仓候选状态。',
  }
  return actions[value] ?? `如需生成模拟订单，先补充${humanizeMissingInput(value)}。`
}
