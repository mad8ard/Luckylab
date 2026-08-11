const CONTROL_KEYS = Object.freeze([
  'priceBands',
  'costBand',
  'volBand',
  'lpBand',
  'entryLine',
  'executionMarkers',
  'greeksPane',
  'lpPane',
  'carryPane',
  'equityPane',
  'kdjPane',
  'rsiPane',
  'volume',
])

export function buildMarketLabChartControls({ candidates, context, overlays, plan }) {
  const controls = {}
  for (const key of CONTROL_KEYS) {
    const active = controlActive(key, overlays, plan)
    const related = candidates.filter((candidate) => candidate.controls.includes(key))
    const available = related.filter((candidate) => candidate.points.length)
    const missing = related.filter((candidate) => !candidate.points.length).map((candidate) => candidate.missingSource)
    if (key === 'volume') {
      const hasVolume = context.rows.some((row) => Number.isFinite(row?.volume))
      controls[key] = controlState({
        active,
        states: hasVolume ? ['ready'] : [],
        missing: hasVolume ? [] : ['rows.volume'],
      })
      continue
    }
    if (key === 'volBand' && overlays?.volBand !== false && !hasCurrentDelta(context.formulaPath)) {
      controls[key] = currentDeltaControl({
        formulaPath: context.formulaPath,
        historicalOutputCount: available.length,
        active: plan.price.deltaBand,
      })
      continue
    }
    controls[key] = controlState({ active, states: available.map((candidate) => candidate.state), missing })
  }
  return controls
}

function currentDeltaControl({ formulaPath, historicalOutputCount, active }) {
  const current = formulaPath.at(-1)
  const fieldState = current?.fieldStates?.deltaUpper ?? current?.fieldStates?.deltaLower
  const state = ['not-applicable', 'model-gate-failed'].includes(fieldState?.status)
    ? fieldState.status
    : 'missing-input'
  return {
    state,
    reason: 'current-formula-output-unavailable',
    missing: [...new Set(fieldState?.missingInputs ?? [])],
    blockedReasons: [...new Set(fieldState?.blockedReasons ?? [])],
    outputCount: historicalOutputCount,
    historicalOutputCount,
    active,
    current: true,
  }
}

function hasCurrentDelta(formulaPath) {
  const current = formulaPath.at(-1)
  return [current?.deltaUpper, current?.deltaLower].every(Number.isFinite)
}

function controlState({ active, states, missing }) {
  const state = aggregateStates(states)
  return {
    state,
    reason: state === 'missing-input' ? 'no-finite-output' : active ? stateReason(state) : 'overlay-disabled',
    missing,
    outputCount: states.length,
    active,
  }
}

function aggregateStates(states) {
  if (!states.length) return 'missing-input'
  return states.includes('estimated') ? 'estimated' : 'ready'
}

function stateReason(state) {
  return state === 'estimated' ? 'research-estimate' : 'finite-output-available'
}

function controlActive(key, overlays, plan) {
  if (key === 'priceBands') return overlays?.priceBands !== false
  if (key === 'costBand') return plan.price.costBand
  if (key === 'volBand') return plan.price.deltaBand
  if (key === 'lpBand') return plan.price.lpBand
  if (key === 'entryLine') return plan.price.entryLine
  if (key === 'executionMarkers') return plan.markers.execution
  if (key === 'greeksPane') return overlays?.greeksPane !== false
  if (key === 'lpPane') return overlays?.lpPane !== false
  if (key === 'carryPane') return overlays?.carryPane !== false
  if (key === 'equityPane') return overlays?.equityPane !== false
  if (key === 'kdjPane') return overlays?.kdjPane !== false
  if (key === 'rsiPane') return overlays?.rsiPane !== false
  if (key === 'volume') return overlays?.volume !== false
  return false
}
