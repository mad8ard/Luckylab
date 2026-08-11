import { describe, expect, it } from 'vitest'
import {
  buildOrderPlanReviewPresentation,
  buildFormulaAvailabilityMap,
  formatFormulaBlockReason,
  formatFormulaInputToken,
  getFormulaAvailability,
  resolveDisplayedDeltaBand,
} from '../formula-research/formulaAvailability.js'
import { formulaStages } from '../formulas/registry.js'

describe('formula availability query', () => {
  it('对 22 个注册阶段都返回当前可用性，不把研究层提升为可执行', () => {
    const map = buildFormulaAvailabilityMap(completeContext())

    expect(Object.keys(map)).toEqual(formulaStages.map((stage) => stage.id))
    expect(map.path.state).toBe('viewable')
    expect(map['option-greeks'].state).toBe('research-only')
    expect(map.funding.state).toBe('proxy-only')
    expect(map['amm-geometry'].state).toBe('protocol-unverified')
    expect(map['net-lp-efficiency'].state).toBe('missing-input')
    expect(Object.values(map).every((item) => item.executionAuthority === 'none')).toBe(true)
  })

  it('缺公式周期时 GetDelta 是待输入，且只展示中文输入和下一步', () => {
    const context = completeContext()
    context.graph.deltaBands = null
    context.graph.inputs.formulaHorizonSessions = null
    context.formulaPath.at(-1).deltaUpper = null
    context.formulaPath.at(-1).fieldStates.deltaUpper = {
      status: 'missing-input',
      missingInputs: ['formula-horizon-inputs'],
      blockedReasons: ['invalid-recovery-input'],
    }

    const result = getFormulaAvailability('delta-band', context)
    expect(result.state).toBe('missing-input')
    expect(result.missingText).toBe('公式周期推导所需输入')
    expect(result.reasonText).toContain('输入不完整')
    expect(result.nextStep).toContain('前向结构目标')
    expect(result.missingText).not.toContain('formula-horizon-inputs')
  })

  it('周期起点已越过成本锚时是当前结构不适用，不伪装成缺用户输入', () => {
    const context = completeContext()
    context.graph.deltaBands = null
    context.graph.inputs.formulaHorizonSessions = null
    context.formulaPath.at(-1).formulaHorizonSessions = null
    const state = {
      status: 'not-applicable',
      missingInputs: [],
      blockedReasons: ['cycle-start-at-or-beyond-anchor'],
    }
    context.formulaPath.at(-1).fieldStates.deltaUpper = state
    context.formulaPath.at(-1).fieldStates.formulaHorizonSessions = state

    for (const id of ['delta-band', 'deviation-score', 'risk-surface', 'dynamic-holding-state']) {
      const result = getFormulaAvailability(id, context)
      expect(result.state).toBe('not-applicable')
      expect(result.label).toBe('当前结构不适用')
      expect(result.missingInputs).toEqual([])
      expect(result.reasonText).toContain('没有前向修复区间')
    }
  })

  it('当前公式行的不可用状态优先于残留的 graph Delta 带', () => {
    const context = completeContext()
    context.formulaPath.at(-1).fieldStates.deltaUpper = {
      status: 'not-applicable',
      missingInputs: [],
      blockedReasons: ['cycle-start-at-or-beyond-anchor'],
    }

    const result = getFormulaAvailability('delta-band', context)
    expect(result.state).toBe('not-applicable')
    expect(result.canRender).toBe(false)
  })

  it('非单调 AR 前缀显示门禁未通过', () => {
    const context = completeContext()
    context.graph.deltaBands = null
    context.graph.inputs.formulaHorizonSessions = null
    context.formulaPath.at(-1).fieldStates.deltaUpper = {
      status: 'model-gate-failed',
      missingInputs: [],
      blockedReasons: ['non-monotonic-or-insufficient-ar-prefix'],
    }

    const result = getFormulaAvailability('delta-band', context)
    expect(result.state).toBe('model-gate-failed')
    expect(result.label).toBe('门禁未通过')
    expect(result.reasonText).toContain('AR 样本不足')
  })

  it('翻译已知 token，未知 token 也保持可读分隔', () => {
    expect(formatFormulaInputToken('formula-derived-horizon')).toBe('公式推导周期')
    expect(formatFormulaInputToken('account.risk.limit')).toBe('账户 · 风险 · 上限')
    expect(formatFormulaInputToken('customRiskWindow')).toBe('custom · 风险 · Window')
  })

  it('shortHold 门禁原因不泄漏英文 token', () => {
    const context = completeContext()
    context.graph.deltaBands = null
    context.formulaPath.at(-1).fieldStates.deltaUpper = {
      status: 'not-applicable',
      missingInputs: [],
      blockedReasons: ['target-not-strictly-between-cycle-start-and-anchor'],
    }

    const targetResult = getFormulaAvailability('delta-band', context)
    expect(targetResult.reasonText).toContain('没有合法的前向修复目标')
    expect(targetResult.reasonText).not.toContain('target-not-strictly')

    context.formulaPath.at(-1).fieldStates.deltaUpper = {
      status: 'model-gate-failed',
      missingInputs: [],
      blockedReasons: ['non-finite-recovery-horizon'],
    }
    const horizonResult = getFormulaAvailability('delta-band', context)
    expect(horizonResult.reasonText).toContain('结构修复周期无法得到有限值')
    expect(horizonResult.reasonText).not.toContain('non-finite-recovery-horizon')
  })

  it('动态持仓门禁与未知机器 token 都不直出前端', () => {
    expect(formatFormulaBlockReason('drawdown-repair-insufficient')).toBe('回撤修复尚不足')
    expect(formatFormulaBlockReason('future-machine-reason')).toBe('未标注的门禁原因')
    expect(formatFormulaBlockReason('当前结构尚未形成')).toBe('当前结构尚未形成')
  })
})

describe('hover GetDelta query', () => {
  it('历史悬停行没有 Delta 时不回退到当前 graph 价格带', () => {
    const result = resolveDisplayedDeltaBand({
      isHovering: true,
      hoverFormulaRow: {
        fieldStates: {
          deltaUpper: {
            status: 'not-applicable',
            missingInputs: [],
            blockedReasons: ['target-already-crossed-at-cycle-start'],
          },
        },
      },
      graph: { deltaBands: { long: { low: 80, cost: 100, high: 120 } } },
    })

    expect(result.long).toBeNull()
    expect(result.state).toBe('not-applicable')
    expect(result.reasonText).toContain('当前结构不适用')
  })

  it('历史悬停行有 Delta 时只使用该行的带', () => {
    const result = resolveDisplayedDeltaBand({
      isHovering: true,
      hoverFormulaRow: { deltaLower: 70, deltaCost: 80, deltaUpper: 90 },
      graph: { deltaBands: { long: { low: 80, cost: 100, high: 120 } } },
    })

    expect(result.long).toEqual({ low: 70, cost: 80, high: 90 })
    expect(result.source).toBe('hover-formula-row')
  })

  it('非悬停时也优先使用当前 formula row 的不适用状态，不回退残留 graph 带', () => {
    const result = resolveDisplayedDeltaBand({
      currentFormulaRow: {
        fieldStates: {
          deltaUpper: {
            status: 'not-applicable',
            missingInputs: [],
            blockedReasons: ['cycle-start-at-or-beyond-anchor'],
          },
        },
      },
      graph: {
        deltaBands: { long: { low: 80, cost: 100, high: 120 } },
        decision: { missingInputs: [] },
      },
    })

    expect(result.state).toBe('not-applicable')
    expect(result.label).toBe('当前结构不适用')
    expect(result.missingInputs).toEqual([])
    expect(result.long).toBeNull()
  })

  it('观察日 GetDelta 优先使用当前 graph 带，不误用历史 formula row 的成本锚带', () => {
    const result = resolveDisplayedDeltaBand({
      currentFormulaRow: {
        deltaLower: 70,
        deltaCost: 80,
        deltaUpper: 90,
        fieldStates: { deltaUpper: { status: 'implemented', missingInputs: [], blockedReasons: [] } },
      },
      graph: { deltaBands: { long: { low: 80, cost: 100, high: 120 } } },
    })

    expect(result.long).toEqual({ low: 80, cost: 100, high: 120 })
    expect(result.source).toBe('current-graph')
  })

  it('没有声明 LP 情景时，库存和资本效率明确保持待输入', () => {
    const context = completeContext()
    context.graph.lpV3 = null
    context.graph.efficiency = null
    context.graph.researchInputs = {
      ...context.graph.researchInputs,
      liquidity: null,
      lpValuationMissingInputs: ['declared-lp-scenario-or-complete-position'],
    }

    expect(getFormulaAvailability('lp-inventory', context).missingInputs).toEqual([
      'declared-lp-scenario-or-complete-position',
    ])
    expect(getFormulaAvailability('capital-efficiency', context).missingInputs).toEqual([
      'declared-lp-scenario-or-complete-position',
    ])
  })

  it('无方向命题时只返回复核条件，不消费空失效线', () => {
    const result = buildOrderPlanReviewPresentation({
      decision: { timing: { side: null }, reviewConditions: ['成本锚变化后复核'], invalidations: [] },
      plan: { invalidation: { lower: null, upper: null } },
    })

    expect(result).toEqual({
      mode: 'review',
      label: '复核条件',
      lower: null,
      upper: null,
      conditions: ['成本锚变化后复核'],
    })
  })
})

function completeContext() {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    close: 100 * (1 + 0.2 * 0.8 ** index),
  }))
  const costPath = rows.map((row) => ({ date: row.date, anchor: 100, lower: 94, upper: 106 }))
  const formulaPath = rows.map((row) => ({
    date: row.date,
    formulaHorizonSessions: 8,
    deltaLower: 88,
    deltaUpper: 112,
    lpPoolTurnover24h: 0.2,
    lpPoolTopReserveShare: 0.7,
    fieldStates: {
      formulaHorizonSessions: { status: 'research-only', missingInputs: [], blockedReasons: [] },
      deltaUpper: { status: 'implemented', missingInputs: [], blockedReasons: [] },
    },
  }))
  return {
    rows,
    costPath,
    formulaPath,
    market: {
      markPrice: rows.at(-1).close,
      costAnchor: 100,
      costLow: 94,
      costHigh: 106,
      costDistance: -0.1,
      annualVol: 0.35,
      atrPercent: 0.025,
    },
    graph: {
      inputs: { entryPrice: 90, formulaHorizonSessions: 8, iv: 0.35, tradingDaysPerYear: 242 },
      researchInputs: {
        strikePrice: 95,
        optionTenorSessions: 20,
        liquidity: 1,
        rangeStatus: 'valid',
        rangeWidth: 0.1,
        skew: 1,
      },
      deltaBands: {
        long: { low: 88, cost: 95, high: 112 },
        short: { low: 80, cost: 95, high: 118 },
      },
      option: { price: 4, optionGamma: 0.02 },
      asian: { price: 3 },
      bachelier: { price: 3.2 },
      lpV3: { value: 20 },
      liquidityFingerprint: { prices: [{ price: 90, density: 1 }] },
      efficiency: { efficiency: 2.1 },
      funding: { basisFraction: 0.001, cumulativeFundingProxy: 0.002 },
      portfolioResearch: { pnl: { scenarioTotal: 2 }, missingInputs: [] },
      rangeV3Il: { rangeV3Il: -0.01 },
      netCarry: { netReturn: 0.02 },
      decision: { state: '等待', missingInputs: [] },
    },
  }
}
