import { deriveRecoveryHorizon } from '../formulas/core.js'
import { positive } from './orderPlanUtils.js'

export function bindPositionHorizon({ side, targetPrice, market, inputs }) {
  const sessions = positive(inputs.formulaHorizonSessions)
  const horizonSide = horizonSideForAction(side)
  if (!sessions) return { eligible: false, reason: 'formula-derived-horizon' }
  if (!horizonSide) return { eligible: false, reason: 'unsupported-position-side' }
  if (inputs.horizonMode === 'explicit-scenario') {
    return {
      status: 'eligible',
      eligible: true,
      mode: 'explicit-scenario',
      side: horizonSide,
      actionSide: side,
      targetPrice,
      targetSource: 'explicit-scenario-exit-target',
      modelHorizonRaw: sessions,
      modelHorizonSessions: Math.max(1, Math.ceil(sessions)),
      resultClaimClass: 'scenario-proxy',
      executionAuthority: 'none',
      availableAt: inputs.horizonAvailableAt,
    }
  }
  if (inputs.formulaHorizonSide !== horizonSide) {
    return { eligible: false, reason: `${horizonSide}-side-target-horizon-binding` }
  }
  const recovery = deriveRecoveryHorizon({
    cycleStartPrice: market.markPrice,
    anchorPrice: inputs.horizonAnchorPrice,
    targetPrice,
    halfLifeSessions: inputs.horizonHalfLifeSessions,
    side: horizonSide,
    availableAt: inputs.horizonAvailableAt,
  })
  return recovery.eligible
    ? {
        ...recovery,
        mode: 'formula-derived',
        targetSource:
          Math.abs(targetPrice - inputs.horizonTargetPrice) <= Math.max(targetPrice, 1) * 1e-12
            ? inputs.horizonTargetSource
            : 'exit-target-return-within-frozen-anchor',
        meanReversionClaimClass: 'sample-estimate',
        executionAuthority: 'none',
      }
    : recovery
}

function horizonSideForAction(side) {
  if (side === 'buy') return 'long'
  if (side === 'sell') return 'short'
  return null
}
