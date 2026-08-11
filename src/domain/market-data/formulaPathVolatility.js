export function resolveFormulaPathVolatility({ rows, index, tradingDaysPerYear, volWindow, scenarioIv } = {}) {
  const observedValue = rollingAnnualVol(rows, index, tradingDaysPerYear, volWindow)
  if (Number.isFinite(observedValue) && observedValue > 0) {
    return availableVolatility(observedValue, 'rolling-log-return-volatility', 'real', false)
  }
  if (observedValue === 0) {
    return {
      value: null,
      observedValue,
      source: 'rolling-log-return-volatility',
      status: 'model-gate-failed',
      inputMode: 'real',
      isSynthetic: false,
      missingInputs: [],
      blockedReasons: ['degenerate-volatility'],
    }
  }

  const fallback = positive(scenarioIv)
  if (fallback !== null) return availableVolatility(fallback, 'explicit-scenario-fallback', 'scenario', true)
  return {
    value: null,
    observedValue: null,
    source: 'missing',
    status: 'missing-input',
    inputMode: 'missing-input',
    isSynthetic: true,
    missingInputs: ['realized-volatility'],
    blockedReasons: [],
  }
}

export function rollingAnnualVol(rows, index, tradingDaysPerYear, volWindow) {
  if (!Number.isFinite(tradingDaysPerYear) || tradingDaysPerYear <= 0) return null
  if (!Number.isFinite(volWindow) || volWindow <= 0) return null
  if (index < 2) return null
  const start = Math.max(1, index - volWindow + 1)
  const returns = []
  for (let i = start; i <= index; i += 1) {
    const previous = rows[i - 1]?.close
    const current = rows[i]?.close
    if (previous > 0 && current > 0) returns.push(Math.log(current / previous))
  }
  if (returns.length < 5) return null
  return standardDeviation(returns) * Math.sqrt(tradingDaysPerYear)
}

function availableVolatility(value, source, inputMode, isSynthetic) {
  return {
    value,
    observedValue: source === 'rolling-log-return-volatility' ? value : null,
    source,
    status: 'implemented',
    inputMode,
    isSynthetic,
    missingInputs: [],
    blockedReasons: [],
  }
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function standardDeviation(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(values.length - 1, 1)
  return Math.sqrt(variance)
}
