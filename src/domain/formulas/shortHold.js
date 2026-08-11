import {
  DEFAULT_DYNAMIC_HOLDING_PROFILES,
  buildExpectation,
  buildHoldingPlan,
  buildMilestones,
  classifyPhase,
  emptyDynamicState,
  normalizeProfiles,
  phaseLabel,
  unique,
} from './dynamicHoldingSupport.js'
import { defineLegacyAliasContract } from './legacyAliases.js'
import { recoveryHorizonAudit } from './recoveryHorizonAudit.js'

export { DEFAULT_DYNAMIC_HOLDING_PROFILES } from './dynamicHoldingSupport.js'

export function deriveShortHoldWindow({
  zScore,
  halfLifeSessions,
  costDistance = null,
  recoveryFraction = null,
  zExit = 1,
  minAbsZ = 1.5,
  minExecutableSessions = 0,
  maxHoldingSessions = null,
  minimumGrossReturn,
  minGrossReturn: legacyMinimumGrossReturn,
  side = 'long',
} = {}) {
  const grossReturnGate = resolveMinimumGrossReturn({ minimumGrossReturn, legacyMinimumGrossReturn })
  if (!grossReturnGate) return null
  if (![zScore, halfLifeSessions, recoveryFraction, zExit, minAbsZ, minExecutableSessions].every(Number.isFinite))
    return null
  if (maxHoldingSessions !== null && (!Number.isFinite(maxHoldingSessions) || maxHoldingSessions <= 0)) return null
  if (halfLifeSessions <= 0 || recoveryFraction <= 0 || recoveryFraction >= 1 || zExit <= 0) return null
  if (
    minAbsZ < 0 ||
    minExecutableSessions < 0 ||
    (Number.isFinite(maxHoldingSessions) && minExecutableSessions > maxHoldingSessions)
  )
    return null

  const absZ = Math.abs(zScore)
  const sessionsToZExit = absZ > zExit ? halfLifeSessions * log2(absZ / zExit) : 0
  const partialRecoverySessions = halfLifeSessions * log2(1 / (1 - recoveryFraction))
  const executableHoldingSessions = Math.max(minExecutableSessions, Math.ceil(partialRecoverySessions))
  const expectedGrossReturn = Number.isFinite(costDistance) ? Math.abs(costDistance) * recoveryFraction : null
  const minExecutableRecoveryFraction = 1 - Math.pow(2, -minExecutableSessions / halfLifeSessions)
  const maxWindowRecoveryFraction = Number.isFinite(maxHoldingSessions)
    ? 1 - Math.pow(2, -maxHoldingSessions / halfLifeSessions)
    : null

  const blockedReasons = []
  if (!passesZDirection({ zScore, minAbsZ, side })) blockedReasons.push('z-threshold')
  if (Number.isFinite(maxHoldingSessions) && partialRecoverySessions > maxHoldingSessions)
    blockedReasons.push('holding-window')
  if (expectedGrossReturn !== null && expectedGrossReturn < grossReturnGate.value) blockedReasons.push('gross-return')

  return {
    eligible: blockedReasons.length === 0,
    status: blockedReasons.length === 0 ? 'eligible' : 'wait',
    side,
    zScore,
    absZ,
    zExit,
    recoveryFraction,
    halfLifeSessions,
    sessionsToZExit,
    partialRecoverySessions,
    executableHoldingSessions,
    minExecutableSessions,
    maxHoldingSessions,
    horizonUnit: 'trading-session',
    horizonRounding: 'ceil-to-whole-trading-session',
    horizonMode: 'formula-derived-from-recovery-target',
    fixedHoldingCapApplied: Number.isFinite(maxHoldingSessions),
    expectedGrossReturn,
    minimumGrossReturn: grossReturnGate.value,
    minimumGrossReturnSource: grossReturnGate.source,
    ...(grossReturnGate.legacyContract ?? {}),
    minExecutableRecoveryFraction,
    maxWindowRecoveryFraction,
    blockedReasons,
  }
}

export function deriveStructuralHoldWindow({
  zScore,
  halfLifeSessions,
  entryPrice,
  anchorPrice,
  targetPrices = {},
  minAbsZ = 1.5,
  minExecutableSessions = 0,
  maxHoldingSessions = null,
  minimumGrossReturn,
  minGrossReturn: legacyMinimumGrossReturn,
  side = 'long',
} = {}) {
  const grossReturnGate = resolveMinimumGrossReturn({ minimumGrossReturn, legacyMinimumGrossReturn })
  if (!grossReturnGate) return null
  if (![zScore, halfLifeSessions, entryPrice, anchorPrice, minAbsZ, minExecutableSessions].every(Number.isFinite))
    return null
  if (halfLifeSessions <= 0 || entryPrice <= 0 || anchorPrice <= 0) return null
  if (maxHoldingSessions !== null && (!Number.isFinite(maxHoldingSessions) || maxHoldingSessions <= 0)) return null
  if (
    minAbsZ < 0 ||
    minExecutableSessions < 0 ||
    (Number.isFinite(maxHoldingSessions) && minExecutableSessions > maxHoldingSessions)
  )
    return null

  const direction = side === 'short' ? -1 : 1
  const anchorGap = (anchorPrice - entryPrice) * direction
  if (anchorGap <= 0) return null

  const candidates = Object.entries(targetPrices)
    .map(([id, rawPrice]) =>
      buildTargetCandidate({
        id,
        rawPrice,
        direction,
        zScore,
        halfLifeSessions,
        entryPrice,
        anchorPrice,
        anchorGap,
        minAbsZ,
        minExecutableSessions,
        maxHoldingSessions,
        minimumGrossReturn: grossReturnGate.value,
        side,
      }),
    )
    .filter(Boolean)

  const selected = candidates.find((candidate) => candidate.eligible) ?? null
  return {
    eligible: selected !== null,
    status: selected ? 'eligible' : 'wait',
    side,
    entryPrice,
    anchorPrice,
    horizonUnit: 'trading-session',
    horizonRounding: 'ceil-to-whole-trading-session',
    horizonMode: 'formula-derived-per-structural-target',
    fixedHoldingCapApplied: Number.isFinite(maxHoldingSessions),
    minimumGrossReturn: grossReturnGate.value,
    minimumGrossReturnSource: grossReturnGate.source,
    ...(grossReturnGate.legacyContract ?? {}),
    selected,
    candidates,
  }
}

/**
 * Exact recovery-horizon identity conditional on an estimated half-life and a
 * target strictly between the cycle start and the frozen anchor. The identity
 * is exact, while an estimated half-life leaves the result sample-conditioned.
 * `resultClaimClass` is null when no result exists due to an inapplicable structure or failed model gate.
 */
export function deriveRecoveryHorizon({
  cycleStartPrice,
  anchorPrice,
  targetPrice,
  halfLifeSessions,
  side = 'long',
  availableAt = null,
} = {}) {
  const audit = recoveryHorizonAudit(cycleStartPrice, anchorPrice, targetPrice, halfLifeSessions, side, availableAt)
  if (![cycleStartPrice, anchorPrice, targetPrice, halfLifeSessions].every(Number.isFinite)) {
    return unavailableRecovery('invalid-recovery-input', audit)
  }
  if (cycleStartPrice <= 0 || anchorPrice <= 0 || targetPrice <= 0 || halfLifeSessions <= 0) {
    return unavailableRecovery('invalid-recovery-input', audit)
  }

  const { anchorGap, targetGap } = audit
  if (!(anchorGap > 0)) return unavailableRecovery('cycle-start-at-or-beyond-anchor', audit)
  if (!(targetGap > 0)) return unavailableRecovery('target-already-crossed-at-cycle-start', audit)

  const recoveryFraction = audit.rawRecoveryFraction
  if (!(recoveryFraction > 0 && recoveryFraction < 1)) {
    return unavailableRecovery('target-not-strictly-between-cycle-start-and-anchor', audit)
  }

  const modelHorizonRaw = halfLifeSessions * log2(1 / (1 - recoveryFraction))
  if (!Number.isFinite(modelHorizonRaw) || modelHorizonRaw <= 0) {
    return unavailableRecovery('non-finite-recovery-horizon', audit)
  }

  return {
    ...audit,
    status: 'eligible',
    eligible: true,
    recoveryFraction,
    modelHorizonRaw,
    modelHorizonSessions: Math.ceil(modelHorizonRaw),
    horizonUnit: 'trading-session',
    horizonRounding: 'ceil-to-whole-trading-session',
    availableAt,
    formula: 'H=HL*log2(1/(1-recoveryFraction))',
    identityClaimClass: 'exact-identity',
    resultClaimClass: 'scenario-proxy',
    inputSemantics: 'canonical-half-life-sessions',
  }
}

export function deriveDrawdownFeatures({ rows, index = null, lookback = null, minSamples = null } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return insufficientDrawdown(rows?.length ?? 0)
  const end = Number.isInteger(index) ? Math.min(Math.max(index, 0), rows.length - 1) : rows.length - 1
  const visibleCount = end + 1
  const explicitLookback = positiveInteger(lookback)
  const lookbackSessions = Math.min(explicitLookback ?? visibleCount, visibleCount)
  const minimumRequired = positiveInteger(minSamples) ?? Math.max(3, Math.ceil(Math.sqrt(lookbackSessions)))
  const start = Math.max(0, end - lookbackSessions + 1)
  const sample = rows.slice(start, end + 1).filter((row) => Number.isFinite(row?.close) && row.close > 0)
  const windowSpec = deriveDrawdownWindowSpec(sample.length, explicitLookback !== null)
  if (sample.length < minimumRequired || !windowSpec) {
    return insufficientDrawdown(sample.length, {
      lookbackSessions,
      minimumRequired,
      mode: explicitLookback === null ? 'expanding-prefix' : 'explicit-scenario',
    })
  }

  let peakRel = 0
  for (let i = 1; i < sample.length; i += 1) if (sample[i].close >= sample[peakRel].close) peakRel = i
  let troughRel = peakRel
  for (let i = peakRel; i < sample.length; i += 1) if (sample[i].close <= sample[troughRel].close) troughRel = i

  const current = sample.at(-1).close
  const peak = sample[peakRel].close
  const trough = sample[troughRel].close
  const drawdownDepth = current / peak - 1
  const drawdownSpeedFast = drawdownDepth - drawdownDepthAt(rows, end - windowSpec.fastLagSessions, lookbackSessions)
  const drawdownSpeedSlow = drawdownDepth - drawdownDepthAt(rows, end - windowSpec.slowLagSessions, lookbackSessions)
  const drawdownRepair = peak > trough ? clamp01((current - trough) / (peak - trough)) : 1
  const peakAgeSessions = sample.length - 1 - peakRel
  const troughAgeSessions = sample.length - 1 - troughRel

  return {
    status: 'ok',
    lookbackSessions: sample.length,
    drawdownDepth,
    drawdownSpeedFast,
    drawdownSpeedSlow,
    drawdownRepair,
    drawdownAge: {
      peakSessions: peakAgeSessions,
      troughSessions: troughAgeSessions,
    },
    windowSpec: {
      ...windowSpec,
      lookbackSessions: sample.length,
      minimumRequired,
      mode: explicitLookback === null ? 'expanding-prefix' : 'explicit-scenario',
    },
    peakPrice: peak,
    troughPrice: trough,
  }
}

export function deriveDynamicHoldingState({
  zScore,
  halfLifeSessions,
  entryPrice,
  anchorPrice,
  targetPrices = {},
  drawdown,
  lpPercentile = null,
  costSlopePct = 0,
  minAbsZ = 1.5,
  profiles = DEFAULT_DYNAMIC_HOLDING_PROFILES,
  side = 'long',
} = {}) {
  const normalizedProfiles = normalizeProfiles(profiles)
  if (!drawdown || drawdown.status === 'insufficient-history') {
    return emptyDynamicState({
      status: '需刷新数据',
      phase: 'insufficient-history',
      structural: null,
      profiles: normalizedProfiles,
    })
  }

  const phase = classifyPhase({ drawdown, entryPrice, anchorPrice, costSlopePct })
  const state = {
    zScore,
    absZ: Math.abs(zScore),
    halfLifeSessions,
    lpPercentile,
    costSlopePct,
    drawdown,
  }

  // A long position above its anchor no longer has a valid mean-reversion gap.
  // Preserve the phase and risk state instead of misreporting valid history as missing.
  if (phase === 'post-anchor-extension') {
    return buildDynamicState({ phase, state, structural: null, profiles: normalizedProfiles })
  }

  const structural = deriveStructuralHoldWindow({
    zScore,
    halfLifeSessions,
    entryPrice,
    anchorPrice,
    targetPrices,
    minAbsZ,
    minExecutableSessions: 0,
    maxHoldingSessions: null,
    minimumGrossReturn: 0,
    side,
  })

  if (!structural) {
    return emptyDynamicState({
      status: '需刷新数据',
      phase: 'insufficient-history',
      structural,
      profiles: normalizedProfiles,
    })
  }

  return buildDynamicState({ phase, state, structural, profiles: normalizedProfiles })
}

function buildDynamicState({ phase, state, structural, profiles }) {
  const milestones = structural ? buildMilestones(structural) : []
  const shortTrade = buildHoldingPlan({ kind: 'shortTrade', profile: profiles.shortTrade, phase, milestones })
  const fundCycle = buildHoldingPlan({ kind: 'fundCycle', profile: profiles.fundCycle, phase, milestones })
  const status =
    phase === 'falling-expansion'
      ? '等待'
      : [shortTrade, fundCycle].some((plan) => plan.status === '观察')
        ? '观察'
        : [shortTrade, fundCycle].every((plan) => plan.status === '剔除')
          ? '剔除'
          : '等待'

  return {
    status,
    phase,
    phaseLabel: phaseLabel(phase),
    state,
    milestones,
    expectation: buildExpectation({ milestones, structural, profiles }),
    holdingPlan: { shortTrade, fundCycle },
    profiles,
    blockedReasons: unique([...shortTrade.blockedReasons, ...fundCycle.blockedReasons]),
  }
}

function buildTargetCandidate({
  id,
  rawPrice,
  direction,
  zScore,
  halfLifeSessions,
  entryPrice,
  anchorGap,
  minAbsZ,
  minExecutableSessions,
  maxHoldingSessions,
  minimumGrossReturn,
  side,
}) {
  const targetPrice = Number(rawPrice)
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) return null

  const rawMove = (targetPrice - entryPrice) * direction
  const recoveryFraction = rawMove / anchorGap
  const effectiveTargetPrice = targetPrice
  const blockedReasons = []

  if (!passesZDirection({ zScore, minAbsZ, side })) blockedReasons.push('z-threshold')
  if (recoveryFraction <= 0) blockedReasons.push('target-behind-entry')
  if (recoveryFraction >= 1) blockedReasons.push('post-anchor-extension')

  const partialRecoverySessions =
    recoveryFraction > 0 && recoveryFraction < 1 ? halfLifeSessions * log2(1 / (1 - recoveryFraction)) : null
  const executableHoldingSessions =
    partialRecoverySessions !== null ? Math.max(minExecutableSessions, Math.ceil(partialRecoverySessions)) : null
  const grossReturn = direction === 1 ? effectiveTargetPrice / entryPrice - 1 : entryPrice / effectiveTargetPrice - 1

  if (partialRecoverySessions === null) blockedReasons.push('non-finite-target-horizon')
  if (Number.isFinite(maxHoldingSessions) && partialRecoverySessions > maxHoldingSessions)
    blockedReasons.push('holding-window')
  if (!Number.isFinite(grossReturn) || grossReturn < minimumGrossReturn) blockedReasons.push('gross-return')

  return {
    id,
    targetPrice,
    effectiveTargetPrice,
    recoveryFraction,
    zAtTarget: zScore * (1 - Math.max(0, Math.min(recoveryFraction, 1))),
    halfLifeSessions,
    partialRecoverySessions,
    executableHoldingSessions,
    horizonUnit: 'trading-session',
    horizonRounding: 'ceil-to-whole-trading-session',
    grossReturn,
    isAnchorProxy: false,
    horizonMode: 'formula-derived-from-target-recovery',
    eligible: blockedReasons.length === 0,
    blockedReasons,
  }
}

function drawdownDepthAt(rows, index, lookback) {
  const end = Math.min(Math.max(index, 0), rows.length - 1)
  const start = Math.max(0, end - lookback + 1)
  const sample = rows.slice(start, end + 1).filter((row) => Number.isFinite(row?.close) && row.close > 0)
  if (!sample.length) return 0
  const peak = Math.max(...sample.map((row) => row.close))
  return sample.at(-1).close / peak - 1
}

function insufficientDrawdown(sampleSize, windowSpec = null) {
  return {
    status: 'insufficient-history',
    sampleSize,
    drawdownDepth: null,
    drawdownSpeedFast: null,
    drawdownSpeedSlow: null,
    drawdownRepair: null,
    drawdownAge: { peakSessions: null, troughSessions: null },
    windowSpec,
  }
}

function deriveDrawdownWindowSpec(sampleSize, explicitLookback) {
  if (!Number.isFinite(sampleSize) || sampleSize < 3) return null
  const fastLagSessions = Math.max(1, Math.floor(Math.cbrt(sampleSize)))
  const slowLagSessions = Math.min(sampleSize - 1, Math.max(fastLagSessions + 1, Math.floor(Math.sqrt(sampleSize))))
  return {
    fastLagSessions,
    slowLagSessions,
    lagMode: explicitLookback ? 'adaptive-within-explicit-scenario' : 'adaptive-prefix',
  }
}

function positiveInteger(value) {
  const next = Number(value)
  return Number.isInteger(next) && next > 0 ? next : null
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function passesZDirection({ zScore, minAbsZ, side }) {
  if (side === 'long') return zScore <= -minAbsZ
  if (side === 'short') return zScore >= minAbsZ
  return Math.abs(zScore) >= minAbsZ
}

function resolveMinimumGrossReturn({ minimumGrossReturn, legacyMinimumGrossReturn }) {
  if (minimumGrossReturn !== undefined && minimumGrossReturn !== null) {
    if (!Number.isFinite(minimumGrossReturn) || minimumGrossReturn < 0) return null
    return { value: minimumGrossReturn, source: 'minimumGrossReturn' }
  }
  if (legacyMinimumGrossReturn !== undefined && legacyMinimumGrossReturn !== null) {
    if (!Number.isFinite(legacyMinimumGrossReturn) || legacyMinimumGrossReturn < 0) return null
    return {
      value: legacyMinimumGrossReturn,
      source: 'deprecated:minGrossReturn',
      legacyContract: defineLegacyAliasContract({ minGrossReturn: 'minimumGrossReturn' }),
    }
  }
  return { value: 0, source: 'query-default' }
}

function log2(value) {
  return Math.log(value) / Math.log(2)
}

function unavailableRecovery(reason, audit = {}) {
  const status = recoveryAvailabilityStatus(reason)
  return {
    ...audit,
    status,
    eligible: false,
    reason,
    identityClaimClass: 'exact-identity',
    resultClaimClass: status === 'missing-input' ? 'missing-input' : null,
  }
}

function recoveryAvailabilityStatus(reason) {
  if (reason === 'invalid-recovery-input') return 'missing-input'
  if (['cycle-start-at-or-beyond-anchor', 'target-already-crossed-at-cycle-start'].includes(reason))
    return 'not-applicable'
  return 'model-gate-failed'
}
