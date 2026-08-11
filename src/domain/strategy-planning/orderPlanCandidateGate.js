export function applyDynamicHoldingCandidateGate({ timing, gate, inputs = {} } = {}) {
  const diagnosticTiming = timing ?? emptyDiagnosticTiming()
  if (diagnosticTiming.side === 'sell') return applyShortCandidateGate(diagnosticTiming, inputs)
  const candidateStatus = gate?.status ?? fallbackCandidateStatus(inputs, diagnosticTiming)

  if (diagnosticTiming.side !== 'buy' || candidateStatus === '观察') {
    return {
      ...diagnosticTiming,
      missingInputs: unique([...(diagnosticTiming.missingInputs ?? []), ...(gate?.missingInputs ?? [])]),
      candidateStatus,
    }
  }

  const reason = gateReason(gate)
  return {
    ...diagnosticTiming,
    side: null,
    action: '未触发',
    path: '动态持仓候选门禁',
    edge: 0,
    stop: null,
    target: null,
    reason,
    signalSemantics: 'candidate-gate-not-confidence-or-win-probability',
    blockedReasons: unique([reason, ...(gate?.blockedReasons ?? []), ...(diagnosticTiming.blockedReasons ?? [])]),
    missingInputs: unique([
      ...(diagnosticTiming.missingInputs ?? []),
      ...(gate?.missingInputs ?? []),
      gate ? null : 'dynamic-holding-state',
    ]),
    candidateStatus,
  }
}

function applyShortCandidateGate(timing, inputs) {
  if (hasIndependentShortBinding(inputs, timing)) return { ...timing, candidateStatus: '观察' }
  const reason = '缺少独立的 short-side 结构目标、成本锚与周期绑定，减仓模拟保持关闭。'
  return {
    ...timing,
    side: null,
    action: '未触发',
    path: '独立 short-side 候选门禁',
    edge: 0,
    stop: null,
    target: null,
    reason,
    blockedReasons: unique([reason, ...(timing.blockedReasons ?? [])]),
    missingInputs: unique([...(timing.missingInputs ?? []), 'short-side-target-horizon-binding']),
    candidateStatus: '需刷新数据',
  }
}

function hasIndependentShortBinding(inputs, timing) {
  const scenario = inputs?.horizonMode === 'explicit-scenario'
  const formulaBound =
    inputs?.formulaHorizonSide === 'short' &&
    [inputs?.horizonAnchorPrice, inputs?.horizonTargetPrice, inputs?.horizonHalfLifeSessions].every(positive)
  return Boolean(
    positive(inputs?.formulaHorizonSessions) &&
    (scenario || formulaBound) &&
    positive(timing?.stop) &&
    positive(timing?.target),
  )
}

function gateReason(gate) {
  if (!gate) return '缺少由当前行情前缀、结构周期和回撤状态共同生成的动态持仓门禁，模拟挂单保持关闭。'
  const phase = gate.phaseLabel ? `（${gate.phaseLabel}）` : ''
  return `动态持仓门禁为“${gate.status}”${phase}；只有“观察”可继续生成模拟挂单。`
}

function hasMissingFormulaInput(timing) {
  return (timing?.missingInputs ?? []).some((item) =>
    ['formula-derived-horizon', 'side-target-horizon-binding', 'delta-band'].includes(item),
  )
}

function fallbackCandidateStatus(inputs, timing) {
  if (inputs?.horizonStatus === 'missing-input') return '需刷新数据'
  if (['not-applicable', 'model-gate-failed'].includes(inputs?.horizonStatus)) return '等待'
  if (inputs?.horizonStatus === 'eligible') return '需刷新数据'
  return hasMissingFormulaInput(timing) ? '需刷新数据' : '等待'
}

function emptyDiagnosticTiming() {
  return {
    state: '等待',
    side: null,
    action: '未触发',
    path: '信号条件未触发',
    edge: 0,
    stop: null,
    target: null,
    reason: '等待市场状态。',
    triggeredConditions: [],
    blockedReasons: [],
    missingInputs: [],
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function positive(value) {
  return Number.isFinite(value) && value > 0
}
