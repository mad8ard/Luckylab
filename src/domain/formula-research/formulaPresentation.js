export function buildOrderPlanReviewPresentation(graph = {}) {
  const decision = graph?.decision ?? {}
  if (decision?.timing?.side) {
    return {
      mode: 'invalidation',
      label: '失效条件',
      lower: finiteOrNull(graph?.plan?.invalidation?.lower),
      upper: finiteOrNull(graph?.plan?.invalidation?.upper),
      conditions: strings(decision.invalidations),
    }
  }
  return {
    mode: 'review',
    label: '复核条件',
    lower: null,
    upper: null,
    conditions: strings(decision.reviewConditions),
  }
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null
}

function strings(values) {
  return Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value.trim()) : []
}
