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

export { DEFAULT_DYNAMIC_HOLDING_PROFILES } from './dynamicHoldingSupport.js'

export function deriveShortHoldWindow({
  zScore,
  halfLifeDays,
  costDistance = null,
  recoveryFraction = 0.2,
  zExit = 1,
  minAbsZ = 1.5,
  minExecutableDays = 2,
  maxHoldingDays = 5,
  minGrossReturn = 0.01,
  side = 'long',
} = {}) {
  if (
    ![zScore, halfLifeDays, recoveryFraction, zExit, minAbsZ, minExecutableDays, maxHoldingDays, minGrossReturn].every(
      Number.isFinite,
    )
  )
    return null
  if (halfLifeDays <= 0 || recoveryFraction <= 0 || recoveryFraction >= 1 || zExit <= 0) return null
  if (
    minAbsZ < 0 ||
    minExecutableDays < 0 ||
    maxHoldingDays <= 0 ||
    minExecutableDays > maxHoldingDays ||
    minGrossReturn < 0
  )
    return null

  const absZ = Math.abs(zScore)
  const daysToZExit = absZ > zExit ? halfLifeDays * log2(absZ / zExit) : 0
  const partialRecoveryDays = halfLifeDays * log2(1 / (1 - recoveryFraction))
  const executableHoldingDays = Math.max(minExecutableDays, partialRecoveryDays)
  const expectedGrossReturn = Number.isFinite(costDistance) ? Math.abs(costDistance) * recoveryFraction : null
  const minExecutableRecoveryFraction = 1 - Math.pow(2, -minExecutableDays / halfLifeDays)
  const maxWindowRecoveryFraction = 1 - Math.pow(2, -maxHoldingDays / halfLifeDays)

  const blockedReasons = []
  if (!passesZDirection({ zScore, minAbsZ, side })) blockedReasons.push('z-threshold')
  if (partialRecoveryDays > maxHoldingDays) blockedReasons.push('holding-window')
  if (expectedGrossReturn !== null && expectedGrossReturn < minGrossReturn) blockedReasons.push('gross-return')

  return {
    eligible: blockedReasons.length === 0,
    status: blockedReasons.length === 0 ? 'eligible' : 'wait',
    side,
    zScore,
    absZ,
    zExit,
    recoveryFraction,
    halfLifeDays,
    daysToZExit,
    partialRecoveryDays,
    executableHoldingDays,
    minExecutableDays,
    maxHoldingDays,
    expectedGrossReturn,
    minExecutableRecoveryFraction,
    maxWindowRecoveryFraction,
    blockedReasons,
  }
}

export function deriveStructuralHoldWindow({
  zScore,
  halfLifeDays,
  entryPrice,
  anchorPrice,
  targetPrices = {},
  anchorRecoveryFraction = 0.875,
  minAbsZ = 1.5,
  minExecutableDays = 2,
  maxHoldingDays = 5,
  minGrossReturn = 0.01,
  side = 'long',
} = {}) {
  if (
    ![
      zScore,
      halfLifeDays,
      entryPrice,
      anchorPrice,
      anchorRecoveryFraction,
      minAbsZ,
      minExecutableDays,
      maxHoldingDays,
      minGrossReturn,
    ].every(Number.isFinite)
  )
    return null
  if (
    halfLifeDays <= 0 ||
    entryPrice <= 0 ||
    anchorPrice <= 0 ||
    anchorRecoveryFraction <= 0 ||
    anchorRecoveryFraction >= 1
  )
    return null
  if (
    minAbsZ < 0 ||
    minExecutableDays < 0 ||
    maxHoldingDays <= 0 ||
    minExecutableDays > maxHoldingDays ||
    minGrossReturn < 0
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
        halfLifeDays,
        entryPrice,
        anchorPrice,
        anchorGap,
        anchorRecoveryFraction,
        minAbsZ,
        minExecutableDays,
        maxHoldingDays,
        minGrossReturn,
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
    anchorRecoveryFraction,
    selected,
    candidates,
  }
}

export function deriveDrawdownFeatures({ rows, index = null, lookback = 120, minSamples = 30 } = {}) {
  if (!Array.isArray(rows) || rows.length < minSamples) return insufficientDrawdown(rows?.length ?? 0)
  const end = Number.isInteger(index) ? Math.min(Math.max(index, 0), rows.length - 1) : rows.length - 1
  const start = Math.max(0, end - lookback + 1)
  const sample = rows.slice(start, end + 1).filter((row) => Number.isFinite(row?.close) && row.close > 0)
  if (sample.length < minSamples) return insufficientDrawdown(sample.length)

  let peakRel = 0
  for (let i = 1; i < sample.length; i += 1) if (sample[i].close >= sample[peakRel].close) peakRel = i
  let troughRel = peakRel
  for (let i = peakRel; i < sample.length; i += 1) if (sample[i].close <= sample[troughRel].close) troughRel = i

  const current = sample.at(-1).close
  const peak = sample[peakRel].close
  const trough = sample[troughRel].close
  const drawdownDepth = current / peak - 1
  const drawdownSpeed5 = drawdownDepth - drawdownDepthAt(rows, end - 5, lookback)
  const drawdownSpeed20 = drawdownDepth - drawdownDepthAt(rows, end - 20, lookback)
  const drawdownRepair = peak > trough ? clamp01((current - trough) / (peak - trough)) : 1

  return {
    status: 'ok',
    lookbackDays: sample.length,
    drawdownDepth,
    drawdownSpeed5,
    drawdownSpeed20,
    drawdownRepair,
    drawdownAge: {
      peakDays: sample.length - 1 - peakRel,
      troughDays: sample.length - 1 - troughRel,
    },
    peakPrice: peak,
    troughPrice: trough,
  }
}

export function deriveDynamicHoldingState({
  zScore,
  halfLifeDays,
  entryPrice,
  anchorPrice,
  targetPrices = {},
  drawdown,
  lpPercentile = null,
  costSlopePct = 0,
  anchorRecoveryFraction = 0.875,
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
    halfLifeDays,
    lpPercentile,
    costSlopePct,
    drawdown,
  }

  // A long position above its anchor no longer has a valid mean-reversion gap.
  // Preserve the phase and risk state instead of misreporting valid history as missing.
  if (phase === 'post-anchor-extension') {
    return buildDynamicState({ phase, state, structural: null, profiles: normalizedProfiles })
  }

  const maxWindow = Math.max(normalizedProfiles.shortTrade.maxDays, normalizedProfiles.fundCycle.maxDays)
  const structural = deriveStructuralHoldWindow({
    zScore,
    halfLifeDays,
    entryPrice,
    anchorPrice,
    targetPrices,
    anchorRecoveryFraction,
    minAbsZ,
    minExecutableDays: 1,
    maxHoldingDays: maxWindow,
    minGrossReturn: 0,
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
  halfLifeDays,
  entryPrice,
  anchorPrice,
  anchorGap,
  anchorRecoveryFraction,
  minAbsZ,
  minExecutableDays,
  maxHoldingDays,
  minGrossReturn,
  side,
}) {
  const targetPrice = Number(rawPrice)
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) return null

  const rawMove = (targetPrice - entryPrice) * direction
  let recoveryFraction = rawMove / anchorGap
  let effectiveTargetPrice = targetPrice
  const blockedReasons = []

  if (id === 'anchor' && recoveryFraction >= 1) {
    recoveryFraction = anchorRecoveryFraction
    effectiveTargetPrice = entryPrice + direction * anchorGap * anchorRecoveryFraction
  }

  if (!passesZDirection({ zScore, minAbsZ, side })) blockedReasons.push('z-threshold')
  if (recoveryFraction <= 0) blockedReasons.push('target-behind-entry')
  if (recoveryFraction >= 1) blockedReasons.push('post-anchor-extension')

  const partialRecoveryDays =
    recoveryFraction > 0 && recoveryFraction < 1 ? halfLifeDays * log2(1 / (1 - recoveryFraction)) : null
  const executableHoldingDays = partialRecoveryDays !== null ? Math.max(minExecutableDays, partialRecoveryDays) : null
  const grossReturn = direction === 1 ? effectiveTargetPrice / entryPrice - 1 : entryPrice / effectiveTargetPrice - 1

  if (partialRecoveryDays === null || partialRecoveryDays > maxHoldingDays) blockedReasons.push('holding-window')
  if (!Number.isFinite(grossReturn) || grossReturn < minGrossReturn) blockedReasons.push('gross-return')

  return {
    id,
    targetPrice,
    effectiveTargetPrice,
    recoveryFraction,
    zAtTarget: zScore * (1 - Math.max(0, Math.min(recoveryFraction, 1))),
    halfLifeDays,
    partialRecoveryDays,
    executableHoldingDays,
    grossReturn,
    isAnchorProxy: id === 'anchor' && targetPrice === anchorPrice,
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

function insufficientDrawdown(sampleSize) {
  return {
    status: 'insufficient-history',
    sampleSize,
    drawdownDepth: null,
    drawdownSpeed5: null,
    drawdownSpeed20: null,
    drawdownRepair: null,
    drawdownAge: { peakDays: null, troughDays: null },
  }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function passesZDirection({ zScore, minAbsZ, side }) {
  if (side === 'long') return zScore <= -minAbsZ
  if (side === 'short') return zScore >= minAbsZ
  return Math.abs(zScore) >= minAbsZ
}

function log2(value) {
  return Math.log(value) / Math.log(2)
}
