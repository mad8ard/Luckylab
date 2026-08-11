import { meanReversionHalfLife } from '../../../src/domain/formulas/core.js'
import { estimateCkSkewAt } from './ckGeometry.js'
import { deriveRecurrenceCycleAt } from './recurrenceCycle.js'
import { requireTradingDaysPerYear } from './tradingTime.js'

/**
 * Holding time is always an event-specific formula output.  The estimator uses
 * the expanding, point-in-time history available at T; it has no calendar-day
 * lookback, holding floor, holding cap, or calendar-period fallback.
 */
export const DEFAULT_CYCLE_HORIZON_CONFIG = Object.freeze({
  targetId: 'costLower',
  formulaVersion: 'ar1-through-origin-dynamic-structural-target-v4-sessions',
})

/**
 * T freezes the anchor, target and AR estimate.  The cycle start is the first
 * observable T+1 open, so recoveryFraction and H become available only then.
 */
export function deriveCycleHorizonAt({ rows, statePath, index, input = {} } = {}) {
  const config = normalizeCycleConfig(input)
  const state = statePath?.[index]
  const signalRow = rows?.[index]
  if (!state || state.status !== 'ok' || !signalRow) {
    return unavailable('invalid-signal-state', config)
  }

  const costDistanceSeries = statePath
    .slice(0, index + 1)
    .map((item) => item?.costDistance)
    .filter(Number.isFinite)
  const meanReversion = meanReversionHalfLife({
    costDistanceSeries,
    tradingDaysPerYear: config.tradingDaysPerYear,
  })
  const monotonic =
    meanReversion?.isMeanReverting === true &&
    meanReversion?.decayMode === 'monotonic-decay' &&
    Number.isFinite(meanReversion?.arCoefficient) &&
    meanReversion.arCoefficient > 0 &&
    meanReversion.arCoefficient < 1 &&
    Number.isFinite(meanReversion?.halfLifeSessions) &&
    meanReversion.halfLifeSessions > 0
  if (!monotonic) {
    return unavailable('non-monotonic-or-non-stationary-cycle', config, {
      sampleSize: costDistanceSeries.length,
      meanReversion: canonicalMeanReversion(meanReversion),
    })
  }

  const entryRow = rows[index + 1]
  if (!entryRow || !Number.isFinite(entryRow.open) || entryRow.open <= 0) {
    return unavailable('missing-next-session-open', config, {
      sampleSize: costDistanceSeries.length,
    })
  }

  const targetPrice = resolveTargetPrice(state, config.targetId)
  const recurrence = deriveRecurrenceCycleAt({
    statePath,
    index,
  })
  const recovery = deriveRecoveryCycle({
    cycleStartPrice: entryRow.open,
    anchorPrice: state.costAnchor,
    targetPrice,
    targetSource: config.targetId,
    side: 'long',
    arCoefficient: meanReversion.arCoefficient,
    halfLifeSessions: meanReversion.halfLifeSessions,
    availableAt: `${entryRow.date}:open`,
    arCoefficientClaimClass: 'sample-estimate',
    targetClaimClass: 'scenario-proxy',
  })
  if (!recovery.eligible) {
    return unavailable(recovery.reason, config, {
      signalDate: signalRow.date,
      entryDate: entryRow.date,
      entryPrice: entryRow.open,
      costAnchor: state.costAnchor,
      targetPrice,
      recovery,
      sampleSize: costDistanceSeries.length,
      meanReversion,
    })
  }
  const ckGeometry = estimateCkSkewAt({
    rows,
    index,
    referencePrice: state.costAnchor,
    cycleHalfLifeSessions: recovery.modelHorizonRawSessions,
    availableAt: recovery.availableAt,
  })

  const cycleStartDistance = (entryRow.open - state.costAnchor) / state.costAnchor
  const zScore =
    state.annualVol > 0
      ? cycleStartDistance / (state.annualVol * Math.sqrt(recovery.modelHorizonSessions / config.tradingDaysPerYear))
      : null

  return {
    status: 'eligible',
    eligible: true,
    reasons: [],
    claimClass: 'scenario-proxy',
    arCoefficientClaimClass: 'sample-estimate',
    recoveryAlgebraClaimClass: 'exact-identity',
    horizonClaimClass: 'scenario-proxy',
    targetClaimClass: 'scenario-proxy',
    claimLayers: {
      arCoefficientEstimate: 'sample-estimate',
      conditionalRecoveryAlgebra: 'exact-identity',
      selectedTargetHorizon: 'scenario-proxy',
    },
    formulaVersion: config.formulaVersion,
    formula: 'H_t=HL_t*log2(1/(1-recoveryFraction_t))',
    signalDate: signalRow.date,
    signalIndex: index,
    frozenAt: `${signalRow.date}:close`,
    availableAt: recovery.availableAt,
    entryDate: entryRow.date,
    cycleStartPrice: entryRow.open,
    positionEntryPrice: null,
    costAnchor: state.costAnchor,
    costLow: state.costLow,
    signalClose: signalRow.close,
    targetId: config.targetId,
    targetPrice,
    recoveryFraction: recovery.recoveryFraction,
    halfLifeSessions: meanReversion.halfLifeSessions,
    arCoefficientEstimate: meanReversion.arCoefficient,
    arCoefficient: meanReversion.arCoefficient,
    decayMode: meanReversion.decayMode,
    sampleSize: costDistanceSeries.length,
    estimationWindow: 'expanding-causal-history',
    modelHorizonRawSessions: recovery.modelHorizonRawSessions,
    modelHorizonSessions: recovery.modelHorizonSessions,
    executionHorizonSessions: recovery.modelHorizonSessions,
    fixedHorizonApplied: false,
    zScore,
    recovery,
    recurrence,
    recurrenceComparison: compareRecoveryWithRecurrence(recovery, recurrence),
    ckGeometry,
    config,
  }
}

/**
 * Pure target-specific recovery identity.  CK endpoint roots/range widths are
 * deliberately absent: they are different variables with different units.
 */
export function deriveRecoveryCycle({
  cycleStartPrice,
  anchorPrice,
  targetPrice,
  targetSource,
  side = 'long',
  arCoefficient,
  halfLifeSessions,
  availableAt = null,
  arCoefficientClaimClass = 'unspecified-input',
  targetClaimClass = 'unspecified-input',
} = {}) {
  const inputs = [cycleStartPrice, anchorPrice, targetPrice, arCoefficient, halfLifeSessions]
  if (!inputs.every(Number.isFinite) || cycleStartPrice <= 0 || anchorPrice <= 0 || targetPrice <= 0) {
    return ineligibleRecovery('invalid-recovery-input')
  }
  if (!(arCoefficient > 0 && arCoefficient < 1) || halfLifeSessions <= 0) {
    return ineligibleRecovery('invalid-monotonic-decay')
  }

  const direction = side === 'short' ? -1 : 1
  const anchorGap = (anchorPrice - cycleStartPrice) * direction
  const targetGap = (targetPrice - cycleStartPrice) * direction
  if (!(anchorGap > 0)) return ineligibleRecovery('cycle-start-at-or-beyond-anchor')
  if (!(targetGap > 0)) return ineligibleRecovery('target-already-crossed-at-cycle-start')

  const recoveryFraction = targetGap / anchorGap
  if (!(recoveryFraction > 0 && recoveryFraction < 1)) {
    return ineligibleRecovery('target-not-strictly-between-cycle-start-and-anchor', {
      recoveryFraction,
    })
  }

  const modelHorizonRawSessions = recoverySessions(halfLifeSessions, recoveryFraction)
  if (!Number.isFinite(modelHorizonRawSessions) || modelHorizonRawSessions <= 0) {
    return ineligibleRecovery('non-finite-recovery-cycle', { recoveryFraction })
  }

  return {
    status: 'eligible',
    eligible: true,
    side,
    cycleStartPrice,
    anchorPrice,
    targetPrice,
    targetSource: targetSource ?? 'unspecified',
    recoveryFraction,
    arCoefficient,
    halfLifeSessions,
    modelHorizonRawSessions,
    modelHorizonSessions: Math.ceil(modelHorizonRawSessions),
    availableAt,
    claimClass: 'exact-identity',
    calculationClaimClass: 'exact-identity',
    arCoefficientClaimClass,
    targetClaimClass,
    horizonClaimClass:
      arCoefficientClaimClass === 'sample-estimate' || targetClaimClass === 'scenario-proxy'
        ? 'scenario-proxy'
        : 'conditional-on-inputs',
    condition: 'given-valid-ar-coefficient-and-frozen-target',
  }
}

export function buildDynamicCycleOutcome(rows, state, cycle) {
  if (!Array.isArray(rows) || !state || !cycle?.eligible) return null
  const entryIndex = state.signalIndex + 1
  const entryRow = rows[entryIndex]
  const terminalIndex = entryIndex + cycle.executionHorizonSessions - 1
  const terminal = rows[terminalIndex]
  if (!entryRow || !validRow(entryRow) || entryRow.open <= 0) {
    return { status: 'not-entered', reason: 'missing-or-invalid-next-session-open' }
  }
  if (!terminal || !validRow(terminal)) {
    return {
      status: 'right-censored',
      reason: 'cycle-not-mature-at-data-boundary',
      entryDate: entryRow.date,
      plannedResolutionIndex: terminalIndex,
      availableThrough: rows.at(-1)?.date ?? null,
    }
  }

  const entryPrice = entryRow.open
  const anchorGap = cycle.costAnchor - entryPrice
  if (!Number.isFinite(anchorGap) || anchorGap <= 0) {
    return {
      status: 'not-entered',
      reason: 'next-open-at-or-above-frozen-anchor',
      entryDate: entryRow.date,
      entryPrice,
    }
  }
  const targetPrice = cycle.targetPrice
  const path = rows.slice(entryIndex, terminalIndex + 1)
  const firstHitOffset = path.findIndex((row) => row.high >= targetPrice)
  const terminalReturn = terminal.close / entryPrice - 1
  const maxFavorableReturn = Math.max(...path.map((row) => row.high / entryPrice - 1))
  const maxAdverseReturn = Math.min(...path.map((row) => row.low / entryPrice - 1))
  const realisedRecoveryFraction = (terminal.close - entryPrice) / anchorGap
  const firstHitHoldingSessions = firstHitOffset >= 0 ? firstHitOffset + 1 : null
  return {
    status: 'mature',
    entryDate: entryRow.date,
    entryPrice,
    terminalDate: terminal.date,
    terminalIndex,
    resolutionDate: terminal.date,
    targetPrice,
    targetHit: firstHitOffset >= 0,
    success: firstHitOffset >= 0,
    firstHitHoldingSessions,
    firstHitFractionOfCycle:
      firstHitHoldingSessions !== null && cycle.executionHorizonSessions > 0
        ? firstHitHoldingSessions / cycle.executionHorizonSessions
        : null,
    firstHitDate: firstHitOffset >= 0 ? path[firstHitOffset].date : null,
    terminalReturn,
    directionalReturn: terminalReturn,
    maxFavorableReturn,
    maxAdverseReturn,
    realisedRecoveryFraction,
    recoveryFractionError: realisedRecoveryFraction - cycle.recoveryFraction,
    modelHorizonSessions: cycle.modelHorizonSessions,
    modelHorizonRawSessions: cycle.modelHorizonRawSessions,
  }
}

export function recoverySessions(halfLifeSessions, recoveryFraction) {
  if (!Number.isFinite(halfLifeSessions) || halfLifeSessions <= 0) return null
  if (!Number.isFinite(recoveryFraction) || recoveryFraction <= 0 || recoveryFraction >= 1) return null
  return halfLifeSessions * (Math.log(1 / (1 - recoveryFraction)) / Math.log(2))
}

export function recoveryFractionAtSessions(sessions, halfLifeSessions) {
  if (!Number.isFinite(sessions) || sessions < 0 || !Number.isFinite(halfLifeSessions) || halfLifeSessions <= 0)
    return null
  return 1 - Math.pow(2, -sessions / halfLifeSessions)
}

function resolveTargetPrice(state, targetId) {
  if (targetId === 'costLower') return state.costLow
  if (targetId === 'costAnchor') return state.costAnchor
  return Number(state[targetId])
}

function compareRecoveryWithRecurrence(recovery, recurrence) {
  if (recurrence?.status !== 'ok') {
    return {
      status: 'unavailable',
      reason: recurrence?.reason ?? 'missing-recurrence-estimate',
      claimClass: 'missing-input',
    }
  }
  const structuralHorizon = recovery.modelHorizonRawSessions
  const recurrencePeriod = recurrence.recurrencePeriodSessions
  return {
    status: Number.isFinite(recurrencePeriod) ? 'ok' : 'recurrence-period-unavailable',
    claimClass: 'scenario-proxy',
    structuralRecoveryFraction: recovery.recoveryFraction,
    structuralHorizonRawSessions: structuralHorizon,
    recurrencePeriodSessions: recurrencePeriod,
    horizonRatio:
      Number.isFinite(recurrencePeriod) && recurrencePeriod > 0 ? structuralHorizon / recurrencePeriod : null,
    empiricalRadiusRank: recurrence.empiricalRadiusRank,
    outOfDistributionRank: recurrence.empiricalRadiusRank,
    sameQuantity: false,
    interpretation:
      'H_t estimates time to a frozen costLower target; recurrencePeriod estimates leave-then-return time to the current state. Their ratio is diagnostic only because the endpoints differ.',
  }
}

function unavailable(reason, config, extra = {}) {
  return {
    status: 'waiting',
    eligible: false,
    reasons: [reason],
    claimClass: 'missing-input',
    targetClaimClass: 'scenario-proxy',
    executionHorizonSessions: null,
    fixedHorizonApplied: false,
    config,
    ...extra,
  }
}

function ineligibleRecovery(reason, extra = {}) {
  return { status: 'waiting', eligible: false, reason, ...extra }
}

function normalizeCycleConfig(input) {
  const merged = { ...DEFAULT_CYCLE_HORIZON_CONFIG, ...input }
  return {
    ...merged,
    tradingDaysPerYear: requireTradingDaysPerYear(merged.tradingDaysPerYear, 'cycle-horizon query'),
  }
}

function canonicalMeanReversion(meanReversion) {
  if (!meanReversion) return null
  return {
    arCoefficient: meanReversion.arCoefficient,
    arDecayRatePerStep: meanReversion.arDecayRatePerStep,
    halfLifeSessions: meanReversion.halfLifeSessions,
    evidenceScale: meanReversion.evidenceScale,
    halfLifeToEvidenceScale: meanReversion.halfLifeToEvidenceScale,
    speed: meanReversion.speed,
    isMeanReverting: meanReversion.isMeanReverting,
    decayMode: meanReversion.decayMode,
    sampleSize: meanReversion.sampleSize,
    periodNote: meanReversion.periodNote,
  }
}

function validRow(row) {
  return [row?.open, row?.high, row?.low, row?.close, row?.volume].every(Number.isFinite)
}
