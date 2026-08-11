import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAdaptiveMarketStatePath, deriveAdaptiveWindows } from '../src/adaptiveMarketState.js'
import { blockBootstrapComparison } from '../src/blockBootstrap.js'
import { deriveCkFrontier, estimateCkSkewAt } from '../src/ckGeometry.js'
import { buildDynamicCycleOutcome, deriveCycleHorizonAt, deriveRecoveryCycle } from '../src/cycleHorizon.js'
import { nextNonOverlappingSignalIndex } from '../src/eventScheduling.js'
import { buildForwardOutcome, buildLatentLiquidityPath } from '../src/latentLiquidity.js'
import { deriveRecurrenceCycleAt } from '../src/recurrenceCycle.js'
import { attachPrequentialCalibration, evaluateLatentLiquidityUniverse } from '../src/validation.js'

const FORBIDDEN_OUTPUT_KEYS = new Set(
  'q rho theta delta halfLifeDays modelHorizonDays executionHorizonDays recurrencePeriodDays blockDays cycleHalfLifeDays modelHorizonRaw recurrenceIntervals currentEpisodeAge'.split(
    ' ',
  ),
)

function rows(count = 40) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + ((index % 5) - 2) * 0.1
    return {
      date: `2024-01-${String(index + 1).padStart(2, '0')}`,
      timestamp: index,
      open: close - 0.1,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1000 + index * 5,
    }
  })
}

function allObjectKeys(value, keys = []) {
  if (!value || typeof value !== 'object') return keys
  for (const [key, child] of Object.entries(value)) {
    keys.push(key)
    allObjectKeys(child, keys)
  }
  return keys
}

test('core queries reject an omitted or invalid trading-session year basis', () => {
  const sample = rows()
  assert.throws(() => buildAdaptiveMarketStatePath(sample), /tradingDaysPerYear must be an explicit/)
  assert.throws(() => buildAdaptiveMarketStatePath(sample, 0), /tradingDaysPerYear must be an explicit/)
  assert.throws(() => buildLatentLiquidityPath(sample), /tradingDaysPerYear must be an explicit/)
  assert.throws(
    () => evaluateLatentLiquidityUniverse([{ symbol: 'TEST', rows: sample }]),
    /tradingDaysPerYear must be an explicit/,
  )

  const state = buildAdaptiveMarketStatePath(sample, 242).at(-1)
  assert.equal(state.tradingDaysPerYear, 242)

  const evaluation = evaluateLatentLiquidityUniverse([{ symbol: 'TEST', market: 'A股', rows: sample }], {
    cycle: {
      tradingDaysPerYear: 242,
      tradingDaysPerYearSource: 'test-explicit-source',
    },
  })
  assert.equal(evaluation.protocol.cycle.tradingDaysPerYear, 242)
  assert.equal(evaluation.protocol.cycle.tradingDaysPerYearSource, 'test-explicit-source')
  assert.equal(
    allObjectKeys(evaluation).some((key) => FORBIDDEN_OUTPUT_KEYS.has(key)),
    false,
  )
})

test('LLCB path is invariant when future extreme rows are appended', () => {
  const original = rows()
  const future = Array.from({ length: 5 }, (_, offset) => ({
    date: `2024-03-${String(offset + 1).padStart(2, '0')}`,
    timestamp: 100 + offset,
    open: 1000,
    high: 2000,
    low: 1,
    close: 1500,
    volume: 99999999,
  }))
  const baseline = buildLatentLiquidityPath(original, { tradingDaysPerYear: 242 })
  const appended = buildLatentLiquidityPath([...original, ...future], { tradingDaysPerYear: 242 }).slice(
    0,
    original.length,
  )
  assert.deepEqual(appended, baseline)
})

test('forward target is frozen at T and uses T+1 open as the earliest entry', () => {
  const sample = [
    { date: '2024-01-01', open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { date: '2024-01-02', open: 99, high: 100, low: 95, close: 98, volume: 1 },
    { date: '2024-01-03', open: 100, high: 106, low: 99, close: 105, volume: 1 },
    { date: '2024-01-04', open: 105, high: 107, low: 103, close: 106, volume: 1 },
  ]
  const outcome = buildForwardOutcome(
    sample,
    {
      status: 'ok',
      state: 'absorption-below-band',
      signalIndex: 1,
      costAnchor: 110,
    },
    { horizon: 2 },
  )
  assert.equal(outcome.entryDate, '2024-01-03')
  assert.equal(outcome.entryPrice, 100)
  assert.equal(outcome.halfAnchorTarget, 105)
  assert.equal(outcome.longTargetHit, true)
  assert.equal(outcome.success, true)
})

test('prequential calibration excludes outcomes unresolved on the signal date', () => {
  const calibrated = attachPrequentialCalibration(
    [
      { model: 'latent:x', symbol: 'a', signalDate: '2024-01-01', resolutionDate: '2024-01-02', success: true },
      { model: 'latent:x', symbol: 'b', signalDate: '2024-01-02', resolutionDate: '2024-01-03', success: false },
      { model: 'latent:x', symbol: 'c', signalDate: '2024-01-03', resolutionDate: '2024-01-04', success: true },
    ],
    1,
  )
  assert.equal(calibrated[0].calibration.priorSamples, 0)
  assert.equal(calibrated[1].calibration.priorSamples, 0)
  assert.equal(calibrated[2].calibration.priorSamples, 1)
  assert.equal(calibrated[2].calibration.priorSuccesses, 1)
})

test('the next signal starts strictly after the previous dynamic path terminal session', () => {
  assert.equal(nextNonOverlappingSignalIndex(8), 9)
  assert.throws(() => nextNonOverlappingSignalIndex(-1), /non-negative integer/)
})

test('date-block bootstrap is deterministic and keeps a finite uncertainty interval', () => {
  const candidate = [
    { signalDate: '2024-01-01', directionalReturn: 0.03, success: true },
    { signalDate: '2024-01-02', directionalReturn: 0.02, success: true },
    { signalDate: '2024-01-03', directionalReturn: -0.01, success: false },
  ]
  const baseline = [
    { signalDate: '2024-01-01', directionalReturn: 0.01, success: false },
    { signalDate: '2024-01-02', directionalReturn: 0.0, success: false },
    { signalDate: '2024-01-03', directionalReturn: -0.02, success: false },
  ]
  const first = blockBootstrapComparison(candidate, baseline, 'directionalReturn', true, 'test-seed', [], 2)
  const second = blockBootstrapComparison(candidate, baseline, 'directionalReturn', true, 'test-seed', [], 2)
  assert.throws(
    () => blockBootstrapComparison(candidate, baseline, 'directionalReturn', true, 'test-seed'),
    /requestedBlockSessions must be an explicit positive integer/,
  )
  assert.deepEqual(first, second)
  assert.equal(first.blockSessions, 2)
  assert.equal(first.returnDifference95.samples, 500)
  assert.ok(first.returnDifference95.lower <= first.returnDifference95.upper)
})

test('CK endpoint root, CK range width, and recovery fraction cannot share one q', () => {
  const oneSided = deriveCkFrontier({ referencePrice: 100, skewAlpha: 0 })
  assert.ok(oneSided)
  assert.equal(oneSided.endpointFourthRoot, 3 / 5)
  assert.ok(Math.abs(oneSided.ckRangeWidth - 0.8704) < 1e-12)
  assert.equal(oneSided.ckDownWidthFraction, oneSided.ckRangeWidth)
  assert.equal(oneSided.ckUpWidthFraction, 0)
  assert.ok(Math.abs(oneSided.ckDownWidthPrice - 87.04) < 1e-12)
  assert.equal(oneSided.ckUpWidthPrice, 0)
  assert.equal(oneSided.capitalEfficiencyAtGeometricMidpoint, oneSided.capitalEfficiency)
  assert.notEqual(oneSided.capitalEfficiencyAtReferencePrice, oneSided.capitalEfficiencyAtGeometricMidpoint)
  assert.equal(oneSided.geometryClaimClass, 'exact-identity')
  assert.equal(oneSided.skewParameterClaimClass, 'scenario-proxy')
  assert.equal('q' in oneSided, false)
  assert.equal(oneSided.isRecoveryFraction, false)

  const directional = deriveCkFrontier({ referencePrice: 100, skewAlpha: 2 })
  assert.ok(Math.abs(directional.ckUpWidthFraction - 2 * directional.ckDownWidthFraction) < 1e-12)
  assert.ok(Number.isFinite(directional.capitalEfficiencyAtGeometricMidpoint))
  assert.ok(Number.isFinite(directional.capitalEfficiencyAtReferencePrice))
  assert.notEqual(directional.capitalEfficiencyAtReferencePrice, directional.capitalEfficiencyAtGeometricMidpoint)

  const recovery = deriveRecoveryCycle({
    cycleStartPrice: 80,
    anchorPrice: 100,
    targetPrice: 90,
    targetSource: 'test-midpoint',
    arCoefficient: 0.5,
    halfLifeSessions: 1,
  })
  assert.equal(recovery.recoveryFraction, 0.5)
  assert.equal(recovery.modelHorizonRawSessions, 1)
  assert.equal('q' in recovery, false)
})

test('87.5% recovery only appears when an event target explicitly implies three half-lives', () => {
  const recovery = deriveRecoveryCycle({
    cycleStartPrice: 80,
    anchorPrice: 100,
    targetPrice: 97.5,
    targetSource: 'explicit-test-target',
    arCoefficient: 0.5,
    halfLifeSessions: 1,
  })
  assert.equal(recovery.recoveryFraction, 0.875)
  assert.equal(recovery.modelHorizonRawSessions, 3)
})

test('one holding session resolves at T+1 close, not one session late', () => {
  const sample = [
    { date: '2024-01-01', open: 90, high: 91, low: 89, close: 90, volume: 1 },
    { date: '2024-01-02', open: 90, high: 96, low: 89, close: 95, volume: 1 },
    { date: '2024-01-03', open: 96, high: 97, low: 94, close: 96, volume: 1 },
  ]
  const outcome = buildDynamicCycleOutcome(
    sample,
    { signalIndex: 0 },
    {
      eligible: true,
      executionHorizonSessions: 1,
      modelHorizonSessions: 1,
      modelHorizonRawSessions: 1,
      costAnchor: 100,
      targetPrice: 95,
      recoveryFraction: 0.5,
    },
  )
  assert.equal(outcome.terminalDate, '2024-01-02')
  assert.equal(outcome.firstHitHoldingSessions, 1)
  assert.equal(outcome.targetHit, true)
})

test('directional move-scale estimate is prefix-only and maps explicitly to a CK alpha scenario', () => {
  const closes = [100, 104, 102, 108, 105, 114, 110]
  const sample = closes.map((close, index) => ({
    date: `2024-02-${String(index + 1).padStart(2, '0')}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }))
  const baseline = estimateCkSkewAt({ rows: sample, index: sample.length - 1, cycleHalfLifeSessions: 6 })
  const appended = estimateCkSkewAt({
    rows: [...sample, { ...sample.at(-1), date: '2024-03-01', close: 1 }],
    index: sample.length - 1,
    cycleHalfLifeSessions: 6,
  })
  assert.deepEqual(appended, baseline)
  assert.equal(baseline.status, 'ok')
  assert.notEqual(baseline.directionalMoveScaleRatioEstimate, 1)
  assert.equal(baseline.directionalMoveScaleRatioClaimClass, 'sample-estimate')
  assert.equal(baseline.ckSkewAlphaScenario, baseline.directionalMoveScaleRatioEstimate)
  assert.equal(baseline.ckSkewAlphaScenarioClaimClass, 'scenario-proxy')
  assert.equal(baseline.geometry.ckSkewAlphaScenario, baseline.ckSkewAlphaScenario)
  assert.equal(baseline.geometry.geometryClaimClass, 'exact-identity')
  assert.match(baseline.scenarioBridge, /assume CK upper-width/)
  assert.equal(baseline.geometry.isExecutionTarget, false)
})

test('recurrence cycle is invariant to appended future states', () => {
  const statePath = Array.from({ length: 80 }, (_, index) => ({
    costDistance: Math.sin((2 * Math.PI * index) / 12) * 0.05,
  }))
  const baseline = deriveRecurrenceCycleAt({ statePath, index: 70 })
  const appended = deriveRecurrenceCycleAt({
    statePath: [...statePath, { costDistance: 99 }, { costDistance: -99 }],
    index: 70,
  })
  assert.deepEqual(appended, baseline)
  assert.equal(baseline.status, 'ok')
  assert.equal(baseline.provenance, 'CK-Part-1-inspired-recurrence-extension-not-a-CK-identity')
  assert.ok(baseline.neighbourCount < baseline.candidateCount)
})

test('directional move-scale ratio uses arithmetic coordinates, is price-scale invariant, and is one for symmetric moves', () => {
  const moves = [1.02, 0.98, 1.02, 0.98, 1.02, 0.98, 1.02, 0.98]
  const closes = [100]
  for (const move of moves) closes.push(closes.at(-1) * move)
  const makeRows = (scale) =>
    closes.map((close, index) => ({
      date: `2024-04-${String(index + 1).padStart(2, '0')}`,
      open: close * scale,
      high: close * scale,
      low: close * scale,
      close: close * scale,
      volume: 1,
    }))
  const baseRows = makeRows(1)
  const scaledRows = makeRows(100)
  const base = estimateCkSkewAt({ rows: baseRows, index: moves.length, cycleHalfLifeSessions: 8 })
  const scaled = estimateCkSkewAt({ rows: scaledRows, index: moves.length, cycleHalfLifeSessions: 8 })
  assert.equal(base.status, 'ok')
  assert.ok(Math.abs(base.directionalMoveScaleRatioEstimate - 1) < 1e-12)
  assert.ok(Math.abs(scaled.directionalMoveScaleRatioEstimate - base.directionalMoveScaleRatioEstimate) < 1e-12)
  assert.ok(Math.abs(scaled.geometry.ckRangeWidth - base.geometry.ckRangeWidth) < 1e-12)
})

test('directional scale-ratio uncertainty is labelled as a tail-model approximation', () => {
  const closes = [100, 104, 102, 108, 105, 114, 110]
  const sample = closes.map((close, index) => ({
    date: `2024-04-${String(index + 1).padStart(2, '0')}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }))
  const result = estimateCkSkewAt({ rows: sample, index: sample.length - 1, cycleHalfLifeSessions: 6 })

  assert.equal(result.status, 'ok')
  assert.ok(Number.isFinite(result.tailModelApproximateLogScaleRatioStandardError))
  assert.equal(result.uncertaintyAssumptions.length, 4)
  assert.match(result.uncertaintyBoundary, /not a calibrated standard error/)
  assert.equal(result.logAlphaStandardError, result.tailModelApproximateLogScaleRatioStandardError)
})

test('directional move-scale estimation refuses a one-sided return history', () => {
  const sample = [100, 101, 102, 103, 104].map((close, index) => ({
    date: `2024-05-${String(index + 1).padStart(2, '0')}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }))
  const result = estimateCkSkewAt({ rows: sample, index: sample.length - 1, cycleHalfLifeSessions: 4 })
  assert.equal(result.status, 'unavailable')
  assert.equal(result.directionalMoveScaleRatioClaimClass, 'missing-input')
  assert.equal(result.ckSkewAlphaScenarioClaimClass, 'missing-input')
  assert.equal(result.alphaClaimClass, 'missing-input')
  assert.equal(result.geometry, null)
})

test('adaptive market windows depend on prefix evidence rather than a calendar holding period', () => {
  assert.deepEqual(deriveAdaptiveWindows(100), {
    sampleSize: 100,
    localWindowSamples: 10,
    recentWindowSamples: 3,
    slopeLagSamples: 3,
    rule: 'localWindowSamples=floor(sqrt(prefixSamples)); recentWindowSamples=floor(sqrt(localWindowSamples))',
  })
  assert.equal(deriveAdaptiveWindows(400).localWindowSamples, 20)
  assert.equal(deriveAdaptiveWindows(401).localWindowSamples, 20)
})

test('recurrence episodes merge consecutive hits before calculating periods', () => {
  const values = [0.01, 0.011, 0.012, 0.5, 0.6, 0.7, 0.013, 0.012, 0.011, 0.8, 0.9, 0.01]
  const result = deriveRecurrenceCycleAt({
    statePath: values.map((costDistance) => ({ costDistance })),
    index: values.length - 1,
  })
  assert.equal(result.status, 'ok')
  assert.ok(result.episodes.some((episode) => episode.hitCount > 1))
  assert.ok(result.recurrenceIntervalsSessions.every((value) => value > 1))
  assert.equal(result.isAnchorNeighborhood, false)
  assert.ok(Number.isFinite(result.empiricalRadiusRank))
  assert.equal(result.outOfDistributionRank, result.empiricalRadiusRank)
  assert.equal('recoveryFraction' in result, false)
  assert.equal('radiusImpliedHorizon' in result, false)
})

test('recurrence Kaplan-Meier uses completed intervals without censoring current episode age', () => {
  const values = [0.01, 0.011, 0.012, 0.5, 0.6, 0.7, 0.013, 0.012, 0.011, 0.8, 0.9, 0.01, 0.011]
  const result = deriveRecurrenceCycleAt({
    statePath: values.map((costDistance) => ({ costDistance })),
    index: values.length - 1,
  })

  assert.equal(result.status, 'ok')
  assert.deepEqual(result.recurrenceIntervalsSessions, [7, 3])
  assert.equal(result.currentEpisodeAgeSessions, 1)
  assert.equal(result.censoredCount, 0)
  assert.equal(result.survivalCensoringStatus, 'completed-intervals-only-no-valid-right-censoring')

  const survival = result.kaplanMeier
  assert.equal(survival.status, 'ok')
  assert.equal(survival.eventCount, 2)
  assert.equal(survival.censoredCount, 0)
  assert.equal(survival.currentEpisodeAgeSessionsUsedAsCensor, false)
  assert.deepEqual(
    survival.points.map((point) => point.timeSessions),
    [3, 7],
  )
  assert.deepEqual(
    survival.points.map((point) => point.atRiskCount),
    [2, 1],
  )
  assert.deepEqual(
    survival.points.map((point) => point.eventCount),
    [1, 1],
  )
  assert.ok(Math.abs(survival.points[0].survivalProbability - 0.5) < 1e-12)
  assert.ok(Math.abs(survival.points[0].greenwoodStandardError - Math.sqrt(0.125)) < 1e-12)
  assert.ok(survival.points[0].confidenceLower95 <= survival.points[0].survivalProbability)
  assert.ok(survival.points[0].confidenceUpper95 >= survival.points[0].survivalProbability)
  assert.equal(survival.points[1].survivalProbability, 0)
  assert.equal(survival.points[1].greenwoodStandardError, 0)
  assert.equal(survival.points[1].confidenceLower95, 0)
  assert.equal(survival.points[1].confidenceUpper95, 0)
  assert.ok(survival.points.every((point) => point.censoredCount === 0))
})

test('recovery cycle is scale invariant and rejects invalid targets or decay', () => {
  const base = deriveRecoveryCycle({
    cycleStartPrice: 80,
    anchorPrice: 100,
    targetPrice: 90,
    arCoefficient: 0.8,
    halfLifeSessions: 4,
  })
  const scaled = deriveRecoveryCycle({
    cycleStartPrice: 800,
    anchorPrice: 1000,
    targetPrice: 900,
    arCoefficient: 0.8,
    halfLifeSessions: 4,
  })
  assert.equal(scaled.recoveryFraction, base.recoveryFraction)
  assert.equal(scaled.modelHorizonRawSessions, base.modelHorizonRawSessions)
  assert.equal(
    deriveRecoveryCycle({
      cycleStartPrice: 80,
      anchorPrice: 100,
      targetPrice: 100,
      arCoefficient: 0.8,
      halfLifeSessions: 4,
    }).eligible,
    false,
  )
  assert.equal(
    deriveRecoveryCycle({
      cycleStartPrice: 80,
      anchorPrice: 100,
      targetPrice: 70,
      arCoefficient: 0.8,
      halfLifeSessions: 4,
    }).eligible,
    false,
  )
  assert.equal(
    deriveRecoveryCycle({
      cycleStartPrice: 80,
      anchorPrice: 100,
      targetPrice: 90,
      arCoefficient: -0.2,
      halfLifeSessions: 4,
    }).eligible,
    false,
  )
})

test('T+2 and later rows cannot change a cycle frozen from T and T+1 open', () => {
  const sampleRows = Array.from({ length: 11 }, (_, index) => ({
    date: `2024-06-${String(index + 1).padStart(2, '0')}`,
    open: index === 9 ? 90 : 100,
    high: 101,
    low: 89,
    close: index === 8 ? 90 : 100,
    volume: 1,
  }))
  const statePath = Array.from({ length: 11 }, (_, index) => ({
    status: 'ok',
    costDistance: -0.2 * 0.8 ** index,
    costAnchor: 100,
    costLow: 95,
    annualVol: 0.2,
  }))
  const baseline = deriveCycleHorizonAt({
    rows: sampleRows,
    statePath,
    index: 8,
    input: { tradingDaysPerYear: 242 },
  })
  const futureChanged = sampleRows.map((row, index) =>
    index > 9 ? { ...row, open: 1, high: 10000, low: 0.1, close: 5000, volume: 999999 } : row,
  )
  const replay = deriveCycleHorizonAt({
    rows: futureChanged,
    statePath,
    index: 8,
    input: { tradingDaysPerYear: 242 },
  })
  assert.equal(baseline.eligible, true)
  assert.equal(baseline.claimClass, 'scenario-proxy')
  assert.equal(baseline.arCoefficientClaimClass, 'sample-estimate')
  assert.equal(baseline.recoveryAlgebraClaimClass, 'exact-identity')
  assert.equal(baseline.horizonClaimClass, 'scenario-proxy')
  assert.deepEqual(baseline.claimLayers, {
    arCoefficientEstimate: 'sample-estimate',
    conditionalRecoveryAlgebra: 'exact-identity',
    selectedTargetHorizon: 'scenario-proxy',
  })
  assert.equal(baseline.recovery.calculationClaimClass, 'exact-identity')
  assert.equal(baseline.recovery.arCoefficientClaimClass, 'sample-estimate')
  assert.equal(baseline.recovery.horizonClaimClass, 'scenario-proxy')
  assert.equal(replay.recoveryFraction, baseline.recoveryFraction)
  assert.equal(replay.modelHorizonRawSessions, baseline.modelHorizonRawSessions)
  assert.equal(replay.availableAt, baseline.availableAt)
  assert.equal(
    allObjectKeys(baseline).some((key) => FORBIDDEN_OUTPUT_KEYS.has(key)),
    false,
  )
})
