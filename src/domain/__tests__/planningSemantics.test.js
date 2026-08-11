import { describe, expect, it } from 'vitest'
import { buildDecisionGraph } from '../strategy-planning/orderPlan.js'

const bydMarket = {
  rows: 1356,
  markPrice: 90.04,
  costAnchor: 88.44,
  costRecent: 88.44,
  costLow: 83.53,
  costHigh: 93.34,
  costDistance: (90.04 - 88.44) / 88.44,
  annualVol: 0.352,
  atrPercent: 0.027,
  momentumFast: 0,
  momentumSlow: 0,
  costSlopeRecent: 0,
}

const bydInput = {
  entryPrice: 90.04,
  formulaHorizonSessions: null,
  formulaHorizonState: {
    status: 'not-applicable',
    context: {
      mode: 'formula-derived',
      side: 'long',
      cycleStartPrice: 90.04,
      anchorPrice: 88.44,
      targetPrice: 83.53,
      targetSource: 'adaptive-cost-lower',
      halfLifeSessions: 7.158,
      reason: 'cycle-start-at-or-beyond-anchor',
      executionAuthority: 'none',
    },
  },
  iv: 0.352,
  deltaSlope: 0.3,
  exitTargetReturn: 0,
  capital: 0,
  baseNotional: 0,
  strategyProfile: 'balanced',
  tradingDaysPerYear: 242,
}

describe('planning gate semantics', () => {
  it('成本带内没有方向时只给复核条件，不制造周期、失效线或账户缺口', () => {
    const graph = buildDecisionGraph({ market: bydMarket, input: bydInput })

    expect(graph.decision.state).toBe('成本带内')
    expect(graph.decision.timing.side).toBeNull()
    expect(graph.decision.missingInputs).not.toContain('formula-derived-horizon')
    expect(graph.decision.missingInputs).not.toContain('account.capital')
    expect(graph.decision.holdingWindow).toBe('当前无执行方向；研究周期待公式推导')
    expect(graph.decision.invalidations).toEqual([])
    expect(graph.decision.reviewConditions).toEqual([
      '收盘价跌破届时成本下沿（当前 83.53，逐 K 线重算）',
      '收盘价突破届时成本上沿（当前 93.34，逐 K 线重算）',
      '成本锚、结构目标或 AR 门禁发生变化',
      '偏离阈值参考 4.0%',
    ])
    expect(graph.plan.primaryOrders).toEqual([])
  })

  it('价格越过成本上沿时拒绝复用 long-side 周期并明确等待独立 short-side 绑定', () => {
    const graph = buildDecisionGraph({
      market: {
        ...bydMarket,
        markPrice: 95,
        costDistance: (95 - bydMarket.costAnchor) / bydMarket.costAnchor,
      },
      input: { ...bydInput, entryPrice: 95, formulaHorizonSessions: 7 },
    })

    expect(graph.decision.state).toBe('执行上沿周期待推导')
    expect(graph.decision.holdingWindow).toBe('无执行方向；研究周期 7 个交易会话（公式推导）')
    expect(graph.decision.timing.side).toBeNull()
    expect(graph.decision.missingInputs).toEqual(['short-side-target-horizon-binding'])
    expect(graph.decision.blockedReasons[0]).toContain('上沿减仓执行方向绑定')
    expect(graph.decision.timing.reason).toContain('不适用于减仓')
    expect(graph.plan.primaryOrders).toEqual([])
  })
})
