export function resolveDeltaSlope(input = {}) {
  return nonNegative(input.deltaSlope, null)
}

export function resolveExitTargetReturn(input = {}) {
  return nonNegative(input.exitTargetReturn, 0)
}

function nonNegative(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}
