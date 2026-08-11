export function classifyFormulaHorizonAvailability(horizon) {
  if (horizon?.eligible) return available('research-only')
  const reason = horizon?.reason ?? 'formula-derived-horizon'
  const status = ['missing-input', 'not-applicable', 'model-gate-failed'].includes(horizon?.status)
    ? horizon.status
    : classifyLegacyHorizonReason(reason)
  if (status === 'missing-input') {
    return unavailable(status, ['formula-horizon-inputs'], [reason])
  }
  return unavailable(status, [], [reason])
}

export function classifyFormulaDeltaAvailability({
  deltaBands,
  horizonAvailability,
  volatilityAvailability,
  tradingDaysPerYear,
  deltaSlope,
}) {
  if (deltaBands) return available('implemented')

  const missingInputs = unique([
    ...(horizonAvailability?.status === 'missing-input' ? horizonAvailability.missingInputs : []),
    ...(volatilityAvailability?.status === 'missing-input' ? volatilityAvailability.missingInputs : []),
    positive(tradingDaysPerYear) ? null : 'trading-days-per-year',
    Number.isFinite(deltaSlope) ? null : 'delta-slope',
  ])
  const blockedReasons = unique([
    ...(horizonAvailability?.blockedReasons ?? []),
    ...(volatilityAvailability?.blockedReasons ?? []),
  ])

  if (['not-applicable', 'model-gate-failed'].includes(horizonAvailability?.status)) {
    return unavailable(horizonAvailability.status, missingInputs, blockedReasons)
  }
  if (missingInputs.length) return unavailable('missing-input', missingInputs, blockedReasons)
  if (volatilityAvailability?.status === 'model-gate-failed') {
    return unavailable('model-gate-failed', [], blockedReasons)
  }
  return unavailable('model-gate-failed', [], [...blockedReasons, 'delta-band-model-domain'])
}

function classifyLegacyHorizonReason(reason) {
  if (reason === 'invalid-recovery-input') return 'missing-input'
  if (['cycle-start-at-or-beyond-anchor', 'target-already-crossed-at-cycle-start'].includes(reason)) {
    return 'not-applicable'
  }
  return 'model-gate-failed'
}

function available(status) {
  return { status, missingInputs: [], blockedReasons: [] }
}

function unavailable(status, missingInputs, blockedReasons) {
  return { status, missingInputs: unique(missingInputs), blockedReasons: unique(blockedReasons) }
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}
