import {
  DEFAULT_DYNAMIC_HOLDING_PROFILES,
  deviationScore,
  deriveDrawdownFeatures,
  deriveDynamicHoldingState,
} from '../formulas/core.js'

export const DYNAMIC_HOLDING_GATE_VERSION = 'dynamic-holding-candidate-v1'

export function buildDynamicHoldingGate({ market, rows = [], formulaPoint, tradingDaysPerYear, profiles } = {}) {
  const candidateProfiles = profiles ?? DEFAULT_DYNAMIC_HOLDING_PROFILES
  const formulaState = formulaPoint?.fieldStates?.formulaHorizonSessions
  const horizon = formulaPoint?.fieldStates?.formulaHorizonSessions?.context
  const formulaHorizonSessions = positive(formulaPoint?.formulaHorizonSessions)
  const halfLifeSessions = positive(horizon?.halfLifeSessions ?? horizon?.meanReversion?.halfLifeSessions)
  const cycleStartPrice = positive(horizon?.cycleStartPrice)
  const deviation = deviationScore({
    costDistance: market?.costDistance,
    annualVol: market?.annualVol,
    formulaHorizonSessions,
    tradingDaysPerYear: positive(tradingDaysPerYear),
  })

  if (![deviation?.z, halfLifeSessions, cycleStartPrice, market?.costAnchor, market?.costLow].every(Number.isFinite)) {
    return unavailableGate(formulaState, { formulaHorizonSessions, cycleStartPrice, profiles: candidateProfiles })
  }

  const gate = deriveDynamicHoldingState({
    zScore: deviation.z,
    halfLifeSessions,
    entryPrice: cycleStartPrice,
    anchorPrice: market.costAnchor,
    targetPrices: { costLower: market.costLow, anchor: market.costAnchor },
    drawdown: deriveDrawdownFeatures({ rows, index: rows.length - 1 }),
    costSlopePct: Number.isFinite(market.costSlopeRecent) ? market.costSlopeRecent * 100 : 0,
    profiles: candidateProfiles,
  })

  return {
    ...gate,
    candidateStatus: gate.status,
    source: 'current-formula-path-prefix',
    gateVersion: DYNAMIC_HOLDING_GATE_VERSION,
    candidateThresholds: thresholdSnapshot(gate.profiles),
    inputMode: horizon?.mode ?? 'formula-derived',
    formulaHorizonSessions,
    cycleStartPrice,
    executionAuthority: 'none',
  }
}

function unavailableGate(formulaState, { formulaHorizonSessions, cycleStartPrice, profiles }) {
  const fieldStatus = formulaState?.status ?? 'missing-input'
  const status = ['not-applicable', 'model-gate-failed'].includes(fieldStatus) ? '等待' : '需刷新数据'
  const phaseLabel =
    {
      'not-applicable': '当前结构不适用',
      'model-gate-failed': '模型门禁未通过',
      'missing-input': '缺少公式输入',
    }[fieldStatus] ?? '候选输入不完整'
  const missingInputs = [...(formulaState?.missingInputs ?? [])]
  if (status === '需刷新数据' && !missingInputs.length) missingInputs.push('dynamic-holding-state')
  return {
    status,
    candidateStatus: status,
    phase: 'unavailable',
    phaseLabel,
    state: null,
    milestones: [],
    holdingPlan: null,
    source: 'current-formula-path-prefix',
    gateVersion: DYNAMIC_HOLDING_GATE_VERSION,
    candidateThresholds: thresholdSnapshot(profiles),
    inputMode: formulaState?.inputMode ?? 'formula-derived',
    formulaFieldStatus: fieldStatus,
    formulaHorizonSessions,
    cycleStartPrice,
    missingInputs,
    blockedReasons: [...(formulaState?.blockedReasons ?? [])],
    executionAuthority: 'none',
  }
}

function thresholdSnapshot(profiles) {
  return {
    shortTradeMinimumGrossReturn: profiles?.shortTrade?.minimumGrossReturn ?? null,
    fundCycleMinimumGrossReturn: profiles?.fundCycle?.minimumGrossReturn ?? null,
  }
}

function positive(value) {
  return Number.isFinite(value) && value > 0 ? value : null
}
