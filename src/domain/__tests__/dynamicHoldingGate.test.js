import { describe, expect, it } from 'vitest'
import { buildDynamicHoldingGate } from '../strategy-planning/dynamicHoldingGate.js'

const formulaPoint = {
  formulaHorizonSessions: 5,
  fieldStates: {
    formulaHorizonSessions: {
      context: {
        mode: 'formula-derived',
        cycleStartPrice: 90,
        halfLifeSessions: 5,
      },
    },
  },
}

const market = {
  markPrice: 90,
  costAnchor: 100,
  costLow: 95,
  costDistance: -0.1,
  annualVol: 0.4,
  costSlopeRecent: 0,
}

describe('buildDynamicHoldingGate', () => {
  it('从当前公式前缀生成可被研究视图和订单共同消费的观察门禁', () => {
    const rows = [120, 100, 80, 82, 85, 90].map((close, index) => ({ date: `d${index}`, close }))
    const gate = buildDynamicHoldingGate({ market, rows, formulaPoint, tradingDaysPerYear: 252 })

    expect(gate).toMatchObject({
      status: '观察',
      candidateStatus: '观察',
      phase: 'repair-start',
      source: 'current-formula-path-prefix',
      gateVersion: 'dynamic-holding-candidate-v1',
      candidateThresholds: { shortTradeMinimumGrossReturn: 0.03, fundCycleMinimumGrossReturn: 0.03 },
      formulaHorizonSessions: 5,
      cycleStartPrice: 90,
      executionAuthority: 'none',
    })
  })

  it('下跌仍在扩张时返回等待，不因已有周期而升级', () => {
    const rows = [120, 110, 100, 85].map((close, index) => ({ date: `d${index}`, close }))
    const gate = buildDynamicHoldingGate({
      market: { ...market, markPrice: 85 },
      rows,
      formulaPoint,
      tradingDaysPerYear: 252,
    })

    expect(gate).toMatchObject({ status: '等待', candidateStatus: '等待', phase: 'falling-expansion' })
  })

  it('周期、半衰期或结构起点缺失时保留字段状态，不制造观察候选', () => {
    expect(buildDynamicHoldingGate({ market, rows: [], formulaPoint: {}, tradingDaysPerYear: 252 })).toMatchObject({
      status: '需刷新数据',
      candidateStatus: '需刷新数据',
      formulaFieldStatus: 'missing-input',
      candidateThresholds: { shortTradeMinimumGrossReturn: 0.03, fundCycleMinimumGrossReturn: 0.03 },
      executionAuthority: 'none',
    })
  })

  it.each([
    ['not-applicable', '等待', '当前结构不适用'],
    ['model-gate-failed', '等待', '模型门禁未通过'],
    ['missing-input', '需刷新数据', '缺少公式输入'],
  ])('把公式字段 %s 映射到同一候选状态链', (fieldStatus, status, phaseLabel) => {
    const point = {
      fieldStates: {
        formulaHorizonSessions: {
          status: fieldStatus,
          inputMode: 'formula-derived',
          missingInputs: fieldStatus === 'missing-input' ? ['formula-horizon-inputs'] : [],
          blockedReasons: fieldStatus === 'missing-input' ? [] : ['formula-gate'],
        },
      },
    }
    expect(buildDynamicHoldingGate({ market, rows: [], formulaPoint: point, tradingDaysPerYear: 252 })).toMatchObject({
      status,
      candidateStatus: status,
      formulaFieldStatus: fieldStatus,
      phaseLabel,
    })
  })
})
