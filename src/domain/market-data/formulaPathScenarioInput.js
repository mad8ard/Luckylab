// Input-only compatibility boundary for explicitly declared research scenarios.
// Deprecated aliases are never serialized into canonical formula-path rows.
export function resolveExplicitScenarioHorizonSessions(input = {}) {
  if (input.pathUsesScenarioInputs !== true) return null
  return positive(input.formulaHorizonSessions) ?? positive(input.formulaHorizonDays) ?? positive(input.holdingDays)
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}
