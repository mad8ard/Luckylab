import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FormulaChart from '../FormulaChart.vue'

describe('FormulaChart', () => {
  it('LP 净效率使用 ViewModel 数据渲染分项，不落回公式说明占位', () => {
    const wrapper = mount(FormulaChart, {
      props: makeProps('net-lp-efficiency'),
    })

    expect(wrapper.text()).toContain('LP 净效率')
    expect(wrapper.text()).toContain('CE 毛效率')
    expect(wrapper.text()).toContain('真实 LP 权重')
  })

  it('动态持仓状态接入二阶公式输出，展示计划和里程碑', () => {
    const wrapper = mount(FormulaChart, {
      props: makeProps('dynamic-holding-state'),
    })

    expect(wrapper.text()).toContain('动态持仓状态')
    expect(wrapper.text()).toContain('短线')
    expect(wrapper.text()).toContain('基金周期')
    expect(wrapper.text()).toContain('成本下沿')
  })

  it('LP 池覆盖展示聚合池快照指标', () => {
    const wrapper = mount(FormulaChart, {
      props: makeProps('lp-pool-coverage'),
    })

    expect(wrapper.text()).toContain('LP 池覆盖')
    expect(wrapper.text()).toContain('24h 换手')
    expect(wrapper.text()).toContain('主池占比')
  })

  it('公式图按 active costPath 限制 rows，避免历史光标读取未来样本', () => {
    const rows = makeRows(80)
    const costPath = makeCostPath(rows).slice(0, 40)
    const wrapper = mount(FormulaChart, {
      props: makeProps('path', { rows, costPath, market: { ...makeMarket(), rows: 40 } }),
    })

    expect(wrapper.find('.fc-kv div:first-child span').text()).toBe('40')
  })
})

function makeProps(formulaId, overrides = {}) {
  const rows = overrides.rows ?? makeRows(90)
  return {
    formulaId,
    graph: makeGraph(),
    market: makeMarket(),
    rows,
    costPath: overrides.costPath ?? makeCostPath(rows),
    formulaPath: overrides.formulaPath ?? makeFormulaPath(rows),
    ...overrides,
  }
}

function makeRows(count) {
  return Array.from({ length: count }, (_, i) => {
    const close = i < 20 ? 120 : i < 55 ? 120 - (i - 20) * 0.9 : 88.5 + (i - 55) * 0.2
    return {
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      open: close - 0.3,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + i,
    }
  })
}

function makeCostPath(rows) {
  return rows.map((row) => ({
    date: row.date,
    anchor: 100,
    lower: 94,
    upper: 106,
  }))
}

function makeFormulaPath(rows) {
  return rows.map((row) => ({
    date: row.date,
    lpPoolTurnover24h: 0.24,
    lpPoolTopReserveShare: 0.68,
    fieldStates: {
      lpPoolTurnover24h: {
        inputMode: 'pool-real',
        isSynthetic: true,
        missingInputs: ['tick-liquidity-history', 'lp-add-remove-events'],
        context: {
          poolCoverage: { reserveUsd: 1000000, volumeUsd24h: 240000, topPoolReserveShare: 0.68 },
        },
      },
    },
  }))
}

function makeMarket() {
  return {
    rows: 90,
    range: '2026-01-01 → 2026-03-31',
    markPrice: 90,
    costAnchor: 100,
    costRecent: 96,
    costLow: 94,
    costHigh: 106,
    costDistance: -0.25,
    costSlope5: 0,
    annualVol: 0.35,
    atrPercent: 0.025,
    momentum5: 0.01,
    momentum20: -0.02,
  }
}

function makeGraph() {
  return {
    inputs: { entryPrice: 90, holdingDays: 30, iv: 0.35, tradingDaysPerYear: 365 },
    researchInputs: { rangeWidth: 0.08, skew: 1.8, liquidity: 1 },
    efficiency: { efficiency: 19.5, lower: 0.92, upper: 1.14 },
    impermanentLoss: { impermanentLoss: -0.015 },
    lpV3Hedged: { upperPrice: 103, lowerPrice: 82.8 },
    deltaBands: { long: { low: 78, cost: 90, high: 108 }, short: { low: 72, cost: 90, high: 112 } },
    option: { gamma: 0.0015 },
  }
}
