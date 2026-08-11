import { describe, expect, it } from 'vitest'
import { buildDecisionGraph } from '../strategy-planning/orderPlan.js'

describe('planning dynamic holding integration', () => {
  it('价格与动量满足但候选仍等待时，不向模拟订单传递买入方向', () => {
    const market = {
      markPrice: 90,
      costAnchor: 100,
      costRecent: 100,
      costLow: 95,
      costHigh: 105,
      costDistance: -0.1,
      annualVol: 0.4,
      atrPercent: 0.02,
      momentumFast: 0.03,
      momentumSlow: 0.01,
      costSlopeRecent: 0,
    }
    const input = {
      entryPrice: 100,
      formulaHorizonSessions: 13,
      formulaHorizonState: {
        context: {
          mode: 'formula-derived',
          side: 'long',
          cycleStartPrice: 90,
          anchorPrice: 100,
          targetPrice: 95,
          halfLifeSessions: 13,
          executionAuthority: 'none',
        },
      },
      iv: 0.4,
      deltaSlope: 0.3,
      capital: 10_000,
      tradingDaysPerYear: 252,
      dynamicHoldingGate: {
        status: '等待',
        phase: 'falling-expansion',
        phaseLabel: '下跌扩张',
        blockedReasons: ['drawdown-expanding'],
        executionAuthority: 'none',
      },
    }

    const graph = buildDecisionGraph({ market, input })
    expect(graph.diagnosticTiming.side).toBe('buy')
    expect(graph.decision).toMatchObject({
      state: '低于成本带',
      candidateStatus: '等待',
      executionStatus: 'blocked',
    })
    expect(graph.decision.timing.side).toBeNull()
    expect(graph.plan.primaryOrders).toEqual([])
  })
})
