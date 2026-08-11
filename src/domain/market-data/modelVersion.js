export const MARKET_MODEL_VERSION = 'adaptive-prefix-ar-cycle-recovery-v2'

export const DELTA_ANCHOR_SOURCES = Object.freeze({
  adaptiveCostAnchor: 'adaptive-prefix-cost-anchor',
  observationCloseFallback: 'observation-close-fallback',
})

export function buildMarketModelContext({
  windowSpec,
  deltaAnchorSource = DELTA_ANCHOR_SOURCES.adaptiveCostAnchor,
  tradingDaysPerYear,
  observationDate,
} = {}) {
  return {
    windowSpec: windowSpec ? { ...windowSpec } : null,
    deltaAnchorSource,
    tradingDaysPerYear: positive(tradingDaysPerYear),
    observationDate: nonEmptyString(observationDate),
  }
}

export function buildFormulaPointModelMetadata({ costPoint, row, tradingDaysPerYear } = {}) {
  const hasCostAnchor = positive(costPoint?.anchor) !== null
  const deltaAnchorSource = hasCostAnchor
    ? DELTA_ANCHOR_SOURCES.adaptiveCostAnchor
    : DELTA_ANCHOR_SOURCES.observationCloseFallback
  return {
    modelVersion: MARKET_MODEL_VERSION,
    bandAnchor: hasCostAnchor ? costPoint.anchor : row?.close,
    modelContext: buildMarketModelContext({
      windowSpec: costPoint?.windowSpec,
      deltaAnchorSource,
      tradingDaysPerYear,
      observationDate: row?.date,
    }),
  }
}

export function buildFormulaModelContext(
  metadata,
  { iv, ivSource, deltaSlope, deltaSlopeSource, formulaHorizonSessions, horizon } = {},
) {
  return {
    ...metadata?.modelContext,
    bandAnchor: positive(metadata?.bandAnchor),
    volatility: {
      value: positive(iv),
      source: nonEmptyString(ivSource) ?? 'missing',
    },
    deltaSlope: {
      value: nonNegative(deltaSlope),
      source: nonEmptyString(deltaSlopeSource) ?? 'default',
    },
    formulaHorizon: {
      sessions: positive(formulaHorizonSessions),
      mode: nonEmptyString(horizon?.mode),
      status: nonEmptyString(horizon?.status),
      side: nonEmptyString(horizon?.side),
      cycleStartPrice: positive(horizon?.cycleStartPrice),
      cycleStartSource: nonEmptyString(horizon?.cycleStartSource),
      cycleStartDate: nonEmptyString(horizon?.cycleStartDate),
      targetPrice: positive(horizon?.targetPrice),
      targetSource: nonEmptyString(horizon?.targetSource),
      recoveryFraction: ratio(horizon?.recoveryFraction),
      halfLifeSessions: positive(horizon?.halfLifeSessions ?? horizon?.meanReversion?.halfLifeSessions),
      availableAt: nonEmptyString(horizon?.availableAt),
      executionAuthority: nonEmptyString(horizon?.executionAuthority),
    },
  }
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function nonNegative(value) {
  if (value === null || value === undefined || value === '') return null
  const next = Number(value)
  return Number.isFinite(next) && next >= 0 ? next : null
}

function ratio(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 && next < 1 ? next : null
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length ? value : null
}
