export const DEFAULT_DYNAMIC_HOLDING_PROFILES = {
  shortTrade: { minDays: 2, maxDays: 10, minGrossReturn: 0.03 },
  fundCycle: { minDays: 20, maxDays: 120, minGrossReturn: 0.03 },
}

export function buildMilestones(structural) {
  const alias = { costLower: 'firstRepair', anchor: 'baseAnchor', lpUpper: 'stretch' }
  return structural.candidates.map((candidate) => ({
    id: alias[candidate.id] ?? candidate.id,
    sourceId: candidate.id,
    targetPrice: candidate.targetPrice,
    effectiveTargetPrice: candidate.effectiveTargetPrice,
    expectedDays: candidate.partialRecoveryDays,
    executableDays: candidate.executableHoldingDays,
    halfLifeDays: candidate.halfLifeDays,
    grossReturn: candidate.grossReturn,
    returnPerDayPct:
      Number.isFinite(candidate.grossReturn) && Number.isFinite(candidate.partialRecoveryDays)
        ? round((candidate.grossReturn * 100) / candidate.partialRecoveryDays, 4)
        : null,
    monthlyEfficiencyPct:
      Number.isFinite(candidate.grossReturn) && Number.isFinite(candidate.partialRecoveryDays)
        ? round(((candidate.grossReturn * 100) / candidate.partialRecoveryDays) * 21, 2)
        : null,
    recoveryFraction: candidate.recoveryFraction,
    zAtTarget: candidate.zAtTarget,
    isStretch: candidate.id === 'lpUpper',
    blockedReasons: candidate.blockedReasons,
  }))
}

export function buildHoldingPlan({ kind, profile, phase, milestones }) {
  if (phase === 'insufficient-history') return plan('需刷新数据', 'refresh-data', null, ['insufficient-history'])
  if (phase === 'falling-expansion') return plan('等待', 'wait-drawdown-stabilize', null, ['drawdown-expanding'])
  if (phase === 'post-anchor-extension')
    return plan('等待', 'review-extension', milestoneById(milestones, 'stretch'), ['post-anchor-extension'])

  const firstRepair = milestoneById(milestones, 'firstRepair')
  const baseAnchor = milestoneById(milestones, 'baseAnchor')
  const candidates = kind === 'fundCycle' ? [baseAnchor, firstRepair] : [firstRepair, baseAnchor]
  const target = candidates.find((item) => usableMilestone(item, profile, kind))

  if (kind === 'shortTrade' && phase === 'low-compression') {
    if (target) return plan('观察', 'wait-repair-start', target, ['drawdown-repair-insufficient'])
    const pendingTarget = candidates.find(forwardMilestone) ?? null
    const reasons = ['drawdown-repair-insufficient']
    if (!pendingTarget) reasons.push('no-structural-target')
    if (pendingTarget && (pendingTarget.expectedDays < profile.minDays || pendingTarget.expectedDays > profile.maxDays))
      reasons.push('holding-window')
    if (pendingTarget && pendingTarget.grossReturn < profile.minGrossReturn) reasons.push('gross-return')
    return plan('等待', 'wait-repair-start', pendingTarget, reasons)
  }
  if (target) {
    const action = kind === 'fundCycle' ? 'review' : 'execute'
    return {
      ...plan('观察', action, target, []),
      firstReviewDays: Number.isFinite(firstRepair?.expectedDays)
        ? Math.max(1, Math.round(firstRepair.expectedDays))
        : null,
    }
  }

  const horizonCandidate = candidates.find((item) => Number.isFinite(item?.expectedDays))
  const reasons = horizonCandidate?.expectedDays > profile.maxDays ? ['holding-window'] : ['no-structural-target']
  return plan(
    reasons.includes('no-structural-target') ? '剔除' : '等待',
    'wait-window',
    horizonCandidate ?? null,
    reasons,
  )
}

export function classifyPhase({ drawdown, entryPrice, anchorPrice, costSlopePct }) {
  if (entryPrice >= anchorPrice) return 'post-anchor-extension'
  if (drawdown.drawdownSpeed5 <= -0.015 || drawdown.drawdownSpeed20 <= -0.035) return 'falling-expansion'
  if (drawdown.drawdownRepair >= 0.35) return 'mean-reverting'
  if (drawdown.drawdownRepair >= 0.15 && drawdown.drawdownSpeed5 >= -0.005 && costSlopePct >= -1.5)
    return 'repair-start'
  return 'low-compression'
}

export function buildExpectation({ milestones, structural, profiles }) {
  const firstRepair = milestoneById(milestones, 'firstRepair')
  const baseAnchor = milestoneById(milestones, 'baseAnchor')
  const stretch = milestoneById(milestones, 'stretch')
  return {
    firstRepairDays: roundNullable(firstRepair?.expectedDays),
    baseAnchorDays: roundNullable(baseAnchor?.expectedDays),
    stretchDays: roundNullable(stretch?.expectedDays),
    baseReturnPct: rangePct(forwardGrossReturn(firstRepair), forwardGrossReturn(baseAnchor)),
    stretchReturnPct: Number.isFinite(stretch?.grossReturn) ? roundNullable(stretch.grossReturn * 100) : null,
    profileExpectations: {
      shortTrade: buildProfileExpectation({ profile: profiles.shortTrade, structural, milestones }),
      fundCycle: buildProfileExpectation({ profile: profiles.fundCycle, structural, milestones }),
    },
  }
}

export function normalizeProfiles(profiles) {
  return {
    shortTrade: { ...DEFAULT_DYNAMIC_HOLDING_PROFILES.shortTrade, ...(profiles?.shortTrade ?? {}) },
    fundCycle: { ...DEFAULT_DYNAMIC_HOLDING_PROFILES.fundCycle, ...(profiles?.fundCycle ?? {}) },
  }
}

export function emptyDynamicState({ status, phase, structural, profiles }) {
  const milestones = structural ? buildMilestones(structural) : []
  return {
    status,
    phase,
    phaseLabel: phaseLabel(phase),
    state: null,
    milestones,
    expectation: buildExpectation({ milestones, structural, profiles }),
    holdingPlan: {
      shortTrade: plan(status, 'refresh-data', null, ['insufficient-history']),
      fundCycle: plan(status, 'refresh-data', null, ['insufficient-history']),
    },
    profiles,
    blockedReasons: ['insufficient-history'],
  }
}

export function phaseLabel(phase) {
  return (
    {
      'falling-expansion': '下跌扩张',
      'low-compression': '低位压缩',
      'repair-start': '修复启动',
      'mean-reverting': '回归中',
      'post-anchor-extension': '锚后扩展',
      'insufficient-history': '数据不足',
    }[phase] ?? phase
  )
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function usableMilestone(item, profile, kind) {
  if (!item || item.blockedReasons.includes('post-anchor-extension')) return false
  if (!Number.isFinite(item.expectedDays) || item.expectedDays > profile.maxDays) return false
  if (kind === 'fundCycle' && item.id !== 'firstRepair' && item.expectedDays < profile.minDays) return false
  if (kind !== 'fundCycle' && item.expectedDays < profile.minDays) return false
  return Number.isFinite(item.grossReturn) && item.grossReturn >= profile.minGrossReturn
}

function forwardMilestone(item) {
  if (
    !item ||
    item.blockedReasons.includes('target-behind-entry') ||
    item.blockedReasons.includes('post-anchor-extension')
  )
    return false
  return Number.isFinite(item.expectedDays) && Number.isFinite(item.grossReturn) && item.grossReturn > 0
}

function buildProfileExpectation({ profile, structural, milestones }) {
  if (!structural) {
    return {
      minDays: profile.minDays,
      maxDays: profile.maxDays,
      expectedReturnAtMinPct: null,
      expectedReturnAtMaxPct: null,
      expectedReturnRangePct: null,
      monthlyEfficiencyPct: null,
      reachedMilestone: null,
      nextMilestone: null,
    }
  }
  const atMin = expectedReturnAtDays({ days: profile.minDays, structural, milestones })
  const atMax = expectedReturnAtDays({ days: profile.maxDays, structural, milestones })
  const targetInWindow =
    milestones.find(
      (item) =>
        Number.isFinite(item.expectedDays) &&
        item.expectedDays >= profile.minDays &&
        item.expectedDays <= profile.maxDays &&
        !item.blockedReasons.includes('post-anchor-extension'),
    ) ?? null
  const nextMilestone =
    milestones.find(
      (item) =>
        Number.isFinite(item.expectedDays) &&
        item.expectedDays > profile.maxDays &&
        !item.blockedReasons.includes('post-anchor-extension'),
    ) ?? null
  return {
    minDays: profile.minDays,
    maxDays: profile.maxDays,
    expectedReturnAtMinPct: atMin.returnPct,
    expectedReturnAtMaxPct: atMax.returnPct,
    expectedReturnRangePct: rangePct(atMin.grossReturn, atMax.grossReturn),
    monthlyEfficiencyPct:
      atMax.days > 0 && Number.isFinite(atMax.grossReturn)
        ? round(((atMax.grossReturn * 100) / atMax.days) * 21, 2)
        : null,
    reachedMilestone: targetInWindow?.id ?? null,
    nextMilestone: nextMilestone?.id ?? null,
  }
}

function expectedReturnAtDays({ days, structural, milestones }) {
  const halfLifeDays = milestones.find((item) => Number.isFinite(item.expectedDays))?.halfLifeDays
  if (!Number.isFinite(days) || !Number.isFinite(halfLifeDays) || halfLifeDays <= 0)
    return { days, grossReturn: null, returnPct: null }
  const direction = structural.side === 'short' ? -1 : 1
  const anchorGap = (structural.anchorPrice - structural.entryPrice) * direction
  if (!Number.isFinite(anchorGap) || anchorGap <= 0) return { days, grossReturn: null, returnPct: null }
  const baseAnchor = milestoneById(milestones, 'baseAnchor')
  const cap = Number.isFinite(baseAnchor?.recoveryFraction) ? baseAnchor.recoveryFraction : 0.875
  const recoveryFraction = Math.min(cap, 1 - Math.pow(2, -days / halfLifeDays))
  const price = structural.entryPrice + direction * anchorGap * recoveryFraction
  const grossReturn = direction === 1 ? price / structural.entryPrice - 1 : structural.entryPrice / price - 1
  return { days, grossReturn, returnPct: roundNullable(grossReturn * 100) }
}

function plan(status, action, target, blockedReasons) {
  return {
    status,
    action,
    target,
    targetId: target?.id ?? null,
    expectedDays: roundNullable(target?.expectedDays),
    expectedReturnPct: Number.isFinite(target?.grossReturn) ? roundNullable(target.grossReturn * 100) : null,
    blockedReasons,
  }
}

function milestoneById(milestones, id) {
  return milestones.find((item) => item.id === id) ?? null
}

function forwardGrossReturn(item) {
  if (!Number.isFinite(item?.grossReturn) || item.grossReturn <= 0) return null
  if (item.blockedReasons.includes('target-behind-entry') || item.blockedReasons.includes('post-anchor-extension')) return null
  return item.grossReturn
}

function rangePct(a, b) {
  const values = [a, b].filter(Number.isFinite)
  if (!values.length) return null
  if (values.length === 1) return `${roundNullable(values[0] * 100)}%`
  return `${roundNullable(Math.min(...values) * 100)}%~${roundNullable(Math.max(...values) * 100)}%`
}

function roundNullable(value, digits = 2) {
  return Number.isFinite(value) ? round(value, digits) : null
}

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
