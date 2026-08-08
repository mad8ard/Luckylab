import { describe, expect, it } from 'vitest'
import { buildTraderChecklist } from '../workbench/traderChecklist.js'

describe('buildTraderChecklist', () => {
  const market = {
    rows: 120,
    markPrice: 90,
    costAnchor: 100,
    costLow: 95,
    costHigh: 105,
  }

  it('无账户输入时显式暴露缺口', () => {
    const checklist = buildTraderChecklist({
      market,
      graph: {
        account: { isConfigured: false, capital: 0, cash: 0, base: 0 },
        decision: { timing: { side: 'buy' }, triggeredConditions: ['价格低于成本带'], blockedReasons: [], missingInputs: ['account.capital'] },
        plan: { primaryOrders: [] },
      },
    })
    expect(checklist.items.find(item => item.label === '账户输入').status).toBe('missing')
    expect(checklist.items.find(item => item.label === '模拟挂单').detail).toContain('账户资金')
  })

  it('组合研究保持 research-only 口径', () => {
    const checklist = buildTraderChecklist({
      market,
      graph: {
        account: { isConfigured: true, capital: 10000, cash: 10000, base: 0 },
        decision: { timing: { side: null }, triggeredConditions: [], blockedReasons: ['未触发'], missingInputs: [] },
        plan: { primaryOrders: [] },
        optionPortfolio: { legs: [{}, {}], delta: -0.2, gamma: 0.01, missingInputs: ['option-leg-premium'] },
        lpV3Hedged: { value: 1 },
        portfolioResearch: { missingInputs: ['real-lp-position'] },
        funding: { ratio: 0.001 },
      },
    })
    expect(checklist.items.find(item => item.label === '期权组合').status).toBe('research')
    expect(checklist.items.find(item => item.label === 'LP / 流动性').detail).toContain('不是链上')
    expect(checklist.items.find(item => item.label === '资金费率').detail).toContain('真实结算周期')
  })
})
