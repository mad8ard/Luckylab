import { describe, expect, it } from 'vitest'
import {
  deriveDrawdownFeatures,
  deriveDynamicHoldingState,
  deriveRecoveryHorizon,
  deriveShortHoldWindow,
  deriveStructuralHoldWindow,
} from '../formulas/core.js'

describe('deriveShortHoldWindow session contract', () => {
  it('由每个目标自己的 q 推导周期，且 q=1 没有有限周期', () => {
    const finite = deriveRecoveryHorizon({
      cycleStartPrice: 80,
      anchorPrice: 100,
      targetPrice: 90,
      halfLifeSessions: 4,
    })
    const anchor = deriveRecoveryHorizon({
      cycleStartPrice: 80,
      anchorPrice: 100,
      targetPrice: 100,
      halfLifeSessions: 4,
    })

    expect(finite.recoveryFraction).toBe(0.5)
    expect(finite.modelHorizonRaw).toBe(4)
    expect(finite.modelHorizonSessions).toBe(4)
    expect(finite).not.toHaveProperty('modelHorizonDays')
    expect(finite).not.toHaveProperty('halfLifeDays')
    expect(finite.identityClaimClass).toBe('exact-identity')
    expect(finite.resultClaimClass).toBe('scenario-proxy')
    expect(anchor.eligible).toBe(false)
    expect(anchor.status).toBe('model-gate-failed')
    expect(anchor.resultClaimClass).toBeNull()
    expect(anchor.recoveryFraction).toBe(1)
    expect(anchor.reason).toBe('target-not-strictly-between-cycle-start-and-anchor')
  })

  it('区分真实缺输入、结构不适用和模型门禁失败，不把三者都标成 missing-input', () => {
    const missing = deriveRecoveryHorizon({ cycleStartPrice: null, anchorPrice: 100, targetPrice: 90 })
    const notApplicable = deriveRecoveryHorizon({
      cycleStartPrice: 110,
      anchorPrice: 100,
      targetPrice: 95,
      halfLifeSessions: 4,
    })
    const modelGateFailed = deriveRecoveryHorizon({
      cycleStartPrice: 80,
      anchorPrice: 100,
      targetPrice: 105,
      halfLifeSessions: 4,
    })

    expect(missing).toMatchObject({
      eligible: false,
      status: 'missing-input',
      reason: 'invalid-recovery-input',
      resultClaimClass: 'missing-input',
    })
    expect(notApplicable).toMatchObject({
      eligible: false,
      status: 'not-applicable',
      reason: 'cycle-start-at-or-beyond-anchor',
      resultClaimClass: null,
    })
    expect(modelGateFailed).toMatchObject({
      eligible: false,
      status: 'model-gate-failed',
      reason: 'target-not-strictly-between-cycle-start-and-anchor',
      resultClaimClass: null,
    })
    expect(
      [missing, notApplicable, modelGateFailed].every((result) => result.identityClaimClass === 'exact-identity'),
    ).toBe(true)
  })

  it('用 z 与半衰期推导按交易会话计量的短线窗口', () => {
    const window = deriveShortHoldWindow({
      zScore: -2.1,
      halfLifeSessions: 10,
      costDistance: -0.1105,
      recoveryFraction: 0.2,
      maxHoldingSessions: 5,
    })

    expect(window.eligible).toBe(true)
    expect(window.partialRecoverySessions).toBeCloseTo(3.22, 2)
    expect(window.expectedGrossReturn).toBeCloseTo(0.0221, 4)
    expect(window.executableHoldingSessions).toBe(4)
    expect(window.minExecutableSessions).toBe(0)
    expect(window).not.toHaveProperty('partialRecoveryDays')
  })

  it('拒绝 z 不够深或超出显式会话上限的候选', () => {
    expect(
      deriveShortHoldWindow({ zScore: -1.1, halfLifeSessions: 3, recoveryFraction: 0.2 })?.blockedReasons,
    ).toContain('z-threshold')
    expect(
      deriveShortHoldWindow({
        zScore: -2.4,
        halfLifeSessions: 31.5,
        recoveryFraction: 0.2,
        maxHoldingSessions: 5,
      })?.blockedReasons,
    ).toContain('holding-window')
    expect(
      deriveShortHoldWindow({
        zScore: -2.1,
        halfLifeSessions: 10,
        recoveryFraction: 0.2,
        costDistance: -0.01,
        minimumGrossReturn: 0.01,
      })?.blockedReasons,
    ).toContain('gross-return')
  })

  it('保留完整回到 zExit 的理论会话数用于对照', () => {
    const window = deriveShortHoldWindow({
      zScore: -2.4,
      halfLifeSessions: 2.5,
      recoveryFraction: 0.2,
      minimumGrossReturn: 0,
    })
    expect(window.sessionsToZExit).toBeCloseTo(3.16, 2)
  })

  it('旧 minGrossReturn 只在边界适配并公开 deprecated/legacyAliasOf', () => {
    const window = deriveShortHoldWindow({
      zScore: -2.1,
      halfLifeSessions: 10,
      recoveryFraction: 0.2,
      costDistance: -0.01,
      minGrossReturn: 0.01,
    })

    expect(window.minimumGrossReturn).toBe(0.01)
    expect(window.minimumGrossReturnSource).toBe('deprecated:minGrossReturn')
    expect(window).not.toHaveProperty('minGrossReturn')
    expect(window.legacyAliasMetadata.minGrossReturn).toEqual({
      deprecated: true,
      legacyAliasOf: 'minimumGrossReturn',
    })
  })

  it('用入场价到结构目标的距离推导持仓会话数', () => {
    const window = deriveStructuralHoldWindow({
      zScore: -2.6,
      halfLifeSessions: 8,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100, lpUpper: 103 },
      minimumGrossReturn: 0.03,
      maxHoldingSessions: 6,
    })

    expect(window.eligible).toBe(true)
    expect(window.selected.id).toBe('costLower')
    expect(window.selected.recoveryFraction).toBeCloseTo(0.4, 6)
    expect(window.selected.partialRecoverySessions).toBeCloseTo(5.9, 1)
    expect(window.selected.grossReturn).toBeCloseTo(0.0444, 3)
  })

  it('锚点 q=1 不得偷偷截成 87.5%，越过锚点也保持不可有限求解', () => {
    const window = deriveStructuralHoldWindow({
      zScore: -3,
      halfLifeSessions: 5,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { anchor: 100, lpUpper: 104 },
      minimumGrossReturn: 0.03,
      maxHoldingSessions: 20,
    })

    expect(window.selected).toBeNull()
    expect(window.candidates.find((item) => item.id === 'anchor').recoveryFraction).toBe(1)
    expect(window.candidates.find((item) => item.id === 'anchor').partialRecoverySessions).toBeNull()
    expect(window.candidates.find((item) => item.id === 'anchor').isAnchorProxy).toBe(false)
    expect(window.candidates.find((item) => item.id === 'lpUpper').blockedReasons).toContain('post-anchor-extension')
  })
})

describe('deriveDynamicHoldingState session contract', () => {
  const repairDrawdown = {
    status: 'ok',
    drawdownDepth: -0.22,
    drawdownSpeedFast: 0.002,
    drawdownSpeedSlow: 0.04,
    drawdownRepair: 0.22,
    drawdownAge: { peakSessions: 58, troughSessions: 6 },
  }

  it('回撤继续扩张时，即使 z/LP 很强也输出等待', () => {
    const state = deriveDynamicHoldingState({
      zScore: -3.2,
      halfLifeSessions: 6,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100, lpUpper: 103 },
      lpPercentile: 1,
      drawdown: { ...repairDrawdown, drawdownSpeedFast: -0.03, drawdownSpeedSlow: -0.08 },
    })

    expect(state.status).toBe('等待')
    expect(state.phase).toBe('falling-expansion')
    expect(state.holdingPlan.shortTrade.blockedReasons).toContain('drawdown-expanding')
  })

  it('修复启动时允许 costLower 和 nearAnchor 进入候选里程碑', () => {
    const state = deriveDynamicHoldingState({
      zScore: -2.8,
      halfLifeSessions: 6,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100, lpUpper: 103 },
      costSlopePct: 0,
      drawdown: repairDrawdown,
    })

    expect(state.status).toBe('观察')
    expect(state.phase).toBe('repair-start')
    expect(state.milestones.map((item) => item.id)).toEqual(['firstRepair', 'baseAnchor', 'stretch'])
    expect(state.holdingPlan.shortTrade.targetId).toBe('firstRepair')
    expect(state.expectation.profileExpectations.shortTrade.targetId).toBe('firstRepair')
    expect(state.expectation.profileExpectations.shortTrade.expectedSessions).toBeCloseTo(
      state.holdingPlan.shortTrade.expectedSessions,
      2,
    )
    expect(state.expectation.profileExpectations.fundCycle.targetId).toBe('firstRepair')
    expect(state.milestones[0].returnPerSessionPct).toBeGreaterThan(0)
    expect(state.expectation.profileExpectations.fundCycle).not.toHaveProperty('monthlyEfficiencyPct')
    expect(state.state).not.toHaveProperty('halfLifeDays')
    expect(JSON.stringify(state)).not.toMatch(/"[^"]*Days"/)
  })

  it('固定周期旧字段不进入规范化契约，两个计划只消费目标推导周期', () => {
    const state = deriveDynamicHoldingState({
      zScore: -3.1,
      halfLifeSessions: 20,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100, lpUpper: 104 },
      drawdown: repairDrawdown,
      profiles: {
        shortTrade: { minDays: 2, maxDays: 10, minimumGrossReturn: 0.03 },
        fundCycle: { minDays: 20, maxDays: 120, minimumGrossReturn: 0.03 },
      },
    })

    expect(state.holdingPlan.shortTrade.status).toBe('观察')
    expect(state.holdingPlan.shortTrade.blockedReasons).not.toContain('holding-window')
    expect(state.holdingPlan.fundCycle.status).toBe('观察')
    expect(state.holdingPlan.fundCycle.action).toBe('review')
    expect(state.holdingPlan.fundCycle.targetId).toBe('firstRepair')
    expect(state.profiles.shortTrade).not.toHaveProperty('minDays')
    expect(state.profiles.shortTrade).not.toHaveProperty('maxDays')
    expect(state.profiles.shortTrade.minimumGrossReturn).toBe(0.03)
    expect(state.profiles.shortTrade).not.toHaveProperty('minGrossReturn')
    expect(state.profiles.fundCycle).not.toHaveProperty('minDays')
    expect(state.profiles.fundCycle).not.toHaveProperty('maxDays')
  })

  it('旧 profile 门槛只经规范化边界迁移，主状态不再输出旧字段', () => {
    const state = deriveDynamicHoldingState({
      zScore: -3.1,
      halfLifeSessions: 20,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100 },
      drawdown: repairDrawdown,
      profiles: { shortTrade: { minGrossReturn: 0.02 } },
    })

    expect(state.profiles.shortTrade.minimumGrossReturn).toBe(0.02)
    expect(state.profiles.shortTrade.minimumGrossReturnSource).toBe('deprecated:minGrossReturn')
    expect(state.profiles.shortTrade).not.toHaveProperty('minGrossReturn')
    expect(state.profiles.shortTrade.legacyAliasMetadata.minGrossReturn).toEqual({
      deprecated: true,
      legacyAliasOf: 'minimumGrossReturn',
    })
  })

  it('lpUpper 超过锚点时标记为 post-anchor-extension 且不作为默认短线退出', () => {
    const state = deriveDynamicHoldingState({
      zScore: -3,
      halfLifeSessions: 5,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100, lpUpper: 104 },
      drawdown: repairDrawdown,
    })

    const stretch = state.milestones.find((item) => item.id === 'stretch')
    expect(stretch.blockedReasons).toContain('post-anchor-extension')
    expect(state.holdingPlan.shortTrade.targetId).not.toBe('stretch')
  })

  it('数据不足时输出需刷新数据和 insufficient-history', () => {
    const rows = Array.from({ length: 2 }, (_, index) => ({ close: 100 - index }))
    const drawdown = deriveDrawdownFeatures({ rows })
    const state = deriveDynamicHoldingState({
      zScore: -2,
      halfLifeSessions: 5,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100 },
      drawdown,
    })

    expect(drawdown.status).toBe('insufficient-history')
    expect(state.status).toBe('需刷新数据')
    expect(state.phase).toBe('insufficient-history')
  })

  it('回撤速度窗口由可见前缀推导，追加未来数据不改写旧时点', () => {
    const prefix = Array.from({ length: 40 }, (_, index) => ({ close: 120 - index * 0.4 + Math.sin(index) }))
    const future = Array.from({ length: 20 }, (_, index) => ({ close: 90 + index * 3 }))
    const before = deriveDrawdownFeatures({ rows: prefix })
    const after = deriveDrawdownFeatures({ rows: [...prefix, ...future], index: prefix.length - 1 })

    expect(after).toEqual(before)
    expect(before.windowSpec.mode).toBe('expanding-prefix')
    expect(before.windowSpec.fastLagSessions).toBeLessThan(before.windowSpec.slowLagSessions)
    expect(before).not.toHaveProperty('lookbackDays')
    expect(before.drawdownAge).not.toHaveProperty('peakDays')
  })
})
