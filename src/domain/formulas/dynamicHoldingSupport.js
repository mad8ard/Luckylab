import { defineLegacyAliasContract } from './legacyAliases.js'

export const DEFAULT_DYNAMIC_HOLDING_PROFILES = {
  shortTrade: { targetOrder: ['firstRepair', 'baseAnchor'], minimumGrossReturn: 0.03 },
  fundCycle: { targetOrder: ['baseAnchor', 'firstRepair'], minimumGrossReturn: 0.03 },
}

export function buildMilestones(structural) {
  const alias = { costLower: 'firstRepair', anchor: 'baseAnchor', lpUpper: 'stretch' }
  return structural.candidates.map((candidate) => ({
    id: alias[candidate.id] ?? candidate.id,
    sourceId: candidate.id,
    targetPrice: candidate.targetPrice,
    effectiveTargetPrice: candidate.effectiveTargetPrice,
    expectedSessions: candidate.partialRecoverySessions,
    executableSessions: candidate.executableHoldingSessions,
    halfLifeSessions: candidate.halfLifeSessions,
    horizonUnit: 'trading-session',
    grossReturn: candidate.grossReturn,
    returnPerSessionPct:
      Number.isFinite(candidate.grossReturn) && Number.isFinite(candidate.partialRecoverySessions)
        ? round((candidate.grossReturn * 100) / candidate.partialRecoverySessions, 4)
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
  const targetOrder = profile.targetOrder ?? defaultTargetOrder(kind)
  const candidates = targetOrder.map((id) => milestoneById(milestones, id)).filter(Boolean)
  const target = candidates.find((item) => usableMilestone(item, profile))

  if (phase === 'low-compression') {
    if (target) return plan('等待', 'wait-repair-start', target, ['drawdown-repair-insufficient'])
    const pendingTarget = candidates.find(forwardMilestone) ?? null
    const reasons = unique(['drawdown-repair-insufficient', ...profileMilestoneBlockedReasons(pendingTarget, profile)])
    return plan('等待', 'wait-repair-start', pendingTarget, reasons)
  }
  if (target) {
    const action = kind === 'fundCycle' ? 'review' : 'execute'
    return {
      ...plan('观察', action, target, []),
      firstReviewSessions: Number.isFinite(firstRepair?.expectedSessions)
        ? Math.max(1, Math.ceil(firstRepair.expectedSessions))
        : null,
    }
  }

  const horizonCandidate = candidates.find((item) => Number.isFinite(item?.expectedSessions)) ?? null
  const reasons = profileMilestoneBlockedReasons(horizonCandidate, profile)
  return plan(
    reasons.includes('holding-window') || reasons.includes('z-threshold') ? '等待' : '剔除',
    'wait-target',
    horizonCandidate ?? null,
    reasons,
  )
}

export function classifyPhase({ drawdown, entryPrice, anchorPrice, costSlopePct }) {
  if (entryPrice >= anchorPrice) return 'post-anchor-extension'
  if (drawdown.drawdownSpeedFast <= -0.015 || drawdown.drawdownSpeedSlow <= -0.035) return 'falling-expansion'
  if (drawdown.drawdownRepair >= 0.35) return 'mean-reverting'
  if (drawdown.drawdownRepair >= 0.15 && drawdown.drawdownSpeedFast >= -0.005 && costSlopePct >= -1.5)
    return 'repair-start'
  return 'low-compression'
}

export function buildExpectation({ milestones, structural, profiles }) {
  const firstRepair = milestoneById(milestones, 'firstRepair')
  const baseAnchor = milestoneById(milestones, 'baseAnchor')
  const stretch = milestoneById(milestones, 'stretch')
  return {
    firstRepairSessions: roundNullable(firstRepair?.expectedSessions),
    baseAnchorSessions: roundNullable(baseAnchor?.expectedSessions),
    stretchSessions: roundNullable(stretch?.expectedSessions),
    horizonUnit: 'trading-session',
    baseReturnPct: rangePct(forwardGrossReturn(firstRepair), forwardGrossReturn(baseAnchor)),
    stretchReturnPct: Number.isFinite(stretch?.grossReturn) ? roundNullable(stretch.grossReturn * 100) : null,
    profileExpectations: {
      shortTrade: buildProfileExpectation({ kind: 'shortTrade', profile: profiles.shortTrade, structural, milestones }),
      fundCycle: buildProfileExpectation({ kind: 'fundCycle', profile: profiles.fundCycle, structural, milestones }),
    },
  }
}

export function normalizeProfiles(profiles) {
  return {
    shortTrade: normalizeProfile('shortTrade', profiles?.shortTrade),
    fundCycle: normalizeProfile('fundCycle', profiles?.fundCycle),
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

function usableMilestone(item, profile) {
  return profileMilestoneBlockedReasons(item, profile).length === 0
}

function profileMilestoneBlockedReasons(item, profile) {
  if (!item) return ['no-structural-target']
  const reasons = [...(item.blockedReasons ?? [])]
  if (!Number.isFinite(item.grossReturn) || item.grossReturn < profile.minimumGrossReturn) reasons.push('gross-return')
  return unique(reasons)
}

function forwardMilestone(item) {
  if (
    !item ||
    item.blockedReasons.includes('target-behind-entry') ||
    item.blockedReasons.includes('post-anchor-extension')
  )
    return false
  return Number.isFinite(item.expectedSessions) && Number.isFinite(item.grossReturn) && item.grossReturn > 0
}

function buildProfileExpectation({ kind, profile, structural, milestones }) {
  if (!structural) {
    return {
      horizonMode: 'formula-derived-per-structural-target',
      horizonUnit: 'trading-session',
      targetId: null,
      expectedSessions: null,
      expectedReturnPct: null,
      blockedReasons: ['missing-structural-target'],
    }
  }
  const candidates = (profile.targetOrder ?? defaultTargetOrder(kind))
    .map((id) => milestoneById(milestones, id))
    .filter(Boolean)
  const target = candidates.find((item) => usableMilestone(item, profile)) ?? candidates.find(forwardMilestone) ?? null
  return {
    horizonMode: 'formula-derived-per-structural-target',
    horizonUnit: 'trading-session',
    targetId: target?.id ?? null,
    expectedSessions: roundNullable(target?.expectedSessions),
    expectedReturnPct: Number.isFinite(target?.grossReturn) ? roundNullable(target.grossReturn * 100) : null,
    blockedReasons: target ? profileMilestoneBlockedReasons(target, profile) : ['no-structural-target'],
  }
}

function normalizeProfile(kind, rawProfile = {}) {
  const defaults = DEFAULT_DYNAMIC_HOLDING_PROFILES[kind]
  const threshold = resolveProfileMinimumGrossReturn(rawProfile, defaults.minimumGrossReturn)
  return {
    targetOrder: Array.isArray(rawProfile?.targetOrder) ? [...rawProfile.targetOrder] : [...defaults.targetOrder],
    minimumGrossReturn: threshold.value,
    minimumGrossReturnSource: threshold.source,
    ...(threshold.legacyContract ?? {}),
  }
}

function resolveProfileMinimumGrossReturn(rawProfile, fallback) {
  if (Number.isFinite(rawProfile?.minimumGrossReturn) && rawProfile.minimumGrossReturn >= 0) {
    return { value: rawProfile.minimumGrossReturn, source: 'minimumGrossReturn' }
  }
  if (Number.isFinite(rawProfile?.minGrossReturn) && rawProfile.minGrossReturn >= 0) {
    return {
      value: rawProfile.minGrossReturn,
      source: 'deprecated:minGrossReturn',
      legacyContract: defineLegacyAliasContract({ minGrossReturn: 'minimumGrossReturn' }),
    }
  }
  return { value: fallback, source: 'profile-default' }
}

function defaultTargetOrder(kind) {
  return kind === 'fundCycle' ? ['baseAnchor', 'firstRepair'] : ['firstRepair', 'baseAnchor']
}

function plan(status, action, target, blockedReasons) {
  return {
    status,
    action,
    target,
    targetId: target?.id ?? null,
    expectedSessions: roundNullable(target?.expectedSessions),
    horizonUnit: 'trading-session',
    expectedReturnPct: Number.isFinite(target?.grossReturn) ? roundNullable(target.grossReturn * 100) : null,
    blockedReasons,
  }
}

function milestoneById(milestones, id) {
  return milestones.find((item) => item.id === id) ?? null
}

function forwardGrossReturn(item) {
  if (!Number.isFinite(item?.grossReturn) || item.grossReturn <= 0) return null
  if (item.blockedReasons.includes('target-behind-entry') || item.blockedReasons.includes('post-anchor-extension'))
    return null
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
