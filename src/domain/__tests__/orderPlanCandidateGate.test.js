import { describe, expect, it } from 'vitest'
import { applyDynamicHoldingCandidateGate } from '../strategy-planning/orderPlanCandidateGate.js'

const buyTiming = {
  state: '低于成本带',
  side: 'buy',
  action: '条件满足',
  path: '低于成本带条件链',
  reason: '价格和动量条件满足',
  signalStrength: 0.8,
  signalSemantics: 'normal-reference-extremeness-not-confidence-or-win-probability',
  triggeredConditions: ['价格低于成本带'],
  blockedReasons: [],
  missingInputs: [],
  stop: 80,
  target: 95,
}

describe('applyDynamicHoldingCandidateGate', () => {
  it('观察门禁保留诊断方向并明确候选状态', () => {
    expect(
      applyDynamicHoldingCandidateGate({ timing: buyTiming, gate: { status: '观察', blockedReasons: [] } }),
    ).toMatchObject({ side: 'buy', candidateStatus: '观察', stop: 80, target: 95 })
  })

  it.each(['等待', '剔除', '需刷新数据'])('%s 会清空正式方向但保留诊断事实', (status) => {
    const result = applyDynamicHoldingCandidateGate({
      timing: buyTiming,
      gate: { status, phaseLabel: '下跌扩张', blockedReasons: ['drawdown-expanding'] },
    })

    expect(result).toMatchObject({
      state: '低于成本带',
      side: null,
      action: '未触发',
      path: '动态持仓候选门禁',
      candidateStatus: status,
      stop: null,
      target: null,
    })
    expect(result.triggeredConditions).toEqual(['价格低于成本带'])
    expect(result.blockedReasons).toContain('drawdown-expanding')
  })

  it('门禁对象存在时仍把公式缺口传到正式 timing，避免候选状态与缺口清单脱节', () => {
    const result = applyDynamicHoldingCandidateGate({
      timing: buyTiming,
      gate: {
        status: '需刷新数据',
        phaseLabel: '缺少公式输入',
        missingInputs: ['formula-horizon-inputs'],
        blockedReasons: [],
      },
    })

    expect(result).toMatchObject({ side: null, candidateStatus: '需刷新数据' })
    expect(result.missingInputs).toContain('formula-horizon-inputs')
  })

  it('缺门禁时 fail closed，并保留机器可审计缺口', () => {
    const result = applyDynamicHoldingCandidateGate({ timing: buyTiming, gate: null })
    expect(result.side).toBeNull()
    expect(result.candidateStatus).toBe('等待')
    expect(result.missingInputs).toContain('dynamic-holding-state')
  })

  it.each([
    ['not-applicable', '等待'],
    ['model-gate-failed', '等待'],
    ['missing-input', '需刷新数据'],
    ['eligible', '需刷新数据'],
  ])('门禁对象缺失时仍按 horizonStatus=%s 映射候选态', (horizonStatus, candidateStatus) => {
    const timing = { ...buyTiming, side: null }
    expect(applyDynamicHoldingCandidateGate({ timing, gate: null, inputs: { horizonStatus } })).toMatchObject({
      candidateStatus,
    })
  })

  it('没有诊断买入方向时不伪造动态门禁状态为市场状态', () => {
    const timing = { ...buyTiming, state: '成本带内', side: null, stop: null, target: null }
    const result = applyDynamicHoldingCandidateGate({ timing, gate: { status: '观察' } })
    expect(result).toMatchObject({ state: '成本带内', side: null, candidateStatus: '观察' })
  })

  it('没有诊断方向时也保留门禁报告的公式缺口', () => {
    const timing = { ...buyTiming, state: '成本带内', side: null, stop: null, target: null }
    const result = applyDynamicHoldingCandidateGate({
      timing,
      gate: { status: '需刷新数据', missingInputs: ['formula-horizon-inputs'] },
    })

    expect(result).toMatchObject({ state: '成本带内', side: null, candidateStatus: '需刷新数据' })
    expect(result.missingInputs).toContain('formula-horizon-inputs')
  })

  it('独立 short-side 诊断只有完成自身结构绑定后才进入候选观察', () => {
    const timing = { ...buyTiming, state: '高于成本带', side: 'sell' }
    const result = applyDynamicHoldingCandidateGate({
      timing,
      gate: null,
      inputs: {
        formulaHorizonSessions: 5,
        formulaHorizonSide: 'short',
        horizonAnchorPrice: 100,
        horizonTargetPrice: 95,
        horizonHalfLifeSessions: 8,
      },
    })
    expect(result).toMatchObject({ state: '高于成本带', side: 'sell', candidateStatus: '观察' })
  })

  it('short-side 诊断缺少独立绑定时 fail closed，不硬编码为候选观察', () => {
    const timing = { ...buyTiming, state: '高于成本带', side: 'sell' }
    const result = applyDynamicHoldingCandidateGate({ timing, gate: null, inputs: {} })
    expect(result).toMatchObject({ side: null, candidateStatus: '需刷新数据' })
    expect(result.missingInputs).toContain('short-side-target-horizon-binding')
  })
})
