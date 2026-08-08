export function resolveDeltaSlope(input = {}) {
  return nonNegative(input.deltaSlope, nonNegative(input.targetReturn, 0))
}

export function resolveExitTargetReturn(input = {}) {
  return nonNegative(input.exitTargetReturn, 0)
}

function nonNegative(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}
