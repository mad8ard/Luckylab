import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ComputeDrawer from '../ComputeDrawer.vue'

describe('ComputeDrawer GetDelta metric', () => {
  it('悬停只显示历史 OHLCV，不改写观察日 GetDelta 快照', () => {
    const wrapper = mountDrawer({
      isHovering: true,
      hoverDate: '2026-01-01',
      hoverRow: {
        date: '2026-01-01',
        open: 68,
        high: 72,
        low: 67,
        close: 70,
        volume: 1000,
      },
      hoverPrevRow: { close: 65 },
    })

    const metric = getDeltaMetric(wrapper)
    expect(metric.text()).toContain('80 — 120')
    expect(metric.text()).toContain('P=入场价')
    expect(metric.text()).toContain('不等于主图成本锚路径')
    expect(wrapper.text()).toContain('图表回看')
    expect(wrapper.findAll('.metric-strip article')[0].text()).toContain('100')
  })

  it('历史十字线数据不能覆盖成本锚和观察价', () => {
    const wrapper = mountDrawer({
      isHovering: true,
      hoverDate: '2026-01-01',
      hoverRow: { date: '2026-01-01', open: 68, high: 72, low: 67, close: 70, volume: 1000 },
      hoverPrevRow: { close: 65 },
    })

    const metricCards = wrapper.findAll('.metric-strip article').map((item) => item.text())
    expect(metricCards[0]).toContain('100')
    expect(metricCards[1]).toContain('98')
    expect(metricCards.join(' ')).not.toContain('70 — 90')
  })

  it('非悬停时使用当前公式行状态，不把不适用误写成待输入', () => {
    const wrapper = mountDrawer({
      graph: {
        inputs: { entryPrice: 100, formulaHorizonSessions: null, iv: 0.3, tradingDaysPerYear: 242 },
        deltaBands: { long: { low: 80, cost: 100, high: 120 } },
        decision: { missingInputs: [] },
      },
      formulaPath: [
        {
          fieldStates: {
            deltaUpper: {
              status: 'not-applicable',
              missingInputs: [],
              blockedReasons: ['cycle-start-at-or-beyond-anchor'],
            },
          },
        },
      ],
    })

    const metric = getDeltaMetric(wrapper)
    expect(metric.text()).toContain('当前结构不适用')
    expect(metric.text()).toContain('没有前向修复区间')
    expect(metric.text()).not.toContain('待输入')
  })
})

function mountDrawer(overrides = {}) {
  return mount(ComputeDrawer, {
    props: {
      graph: {
        inputs: { entryPrice: 100, formulaHorizonSessions: 8, iv: 0.3, tradingDaysPerYear: 242 },
        deltaBands: { long: { low: 80, cost: 100, high: 120 } },
        decision: { missingInputs: [] },
      },
      market: {
        rows: 2,
        markPrice: 100,
        costAnchor: 98,
        costDistance: 0.02,
        costLow: 90,
        costHigh: 110,
        annualVol: 0.3,
        atrPercent: 0.02,
      },
      rows: [
        { date: '2026-01-01', close: 99 },
        { date: '2026-01-02', close: 100 },
      ],
      costPath: [
        { date: '2026-01-01', anchor: 98 },
        { date: '2026-01-02', anchor: 98 },
      ],
      formulaPath: [],
      sourceLabel: '测试',
      activeFormulaId: 'delta-band',
      activeFormula: { label: 'GetDelta 成本带' },
      ...overrides,
    },
    global: {
      stubs: {
        WorkbenchSummary: true,
        ChainFlow: true,
        FormulaChart: true,
        FormulaDrawerContent: true,
        FormulaNav: true,
      },
    },
  })
}

function getDeltaMetric(wrapper) {
  return wrapper.findAll('.metric-strip article').find((item) => item.text().includes('入场价情景 GetDelta'))
}
