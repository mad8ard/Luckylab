import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FormulaDrawerContent from '../FormulaDrawerContent.vue'
import FormulaFusionViews from '../FormulaFusionViews.vue'
import FormulaNav from '../FormulaNav.vue'

describe('formula availability panels', () => {
  it('FormulaNav 分开已实现与当前可用性', () => {
    const props = contextProps()
    const wrapper = mount(FormulaNav, { props: { activeId: 'delta-band', ...props } })

    expect(stageButton(wrapper, '价格路径').text()).toContain('可查看')
    expect(stageButton(wrapper, 'GetDelta 成本带').text()).toContain('待输入')
    expect(stageButton(wrapper, 'AMM 几何').text()).toContain('未验证')
    expect(stageButton(wrapper, 'GetDelta 成本带').text()).not.toContain('已计算')
  })

  it('FormulaDrawerContent 与导航使用同一动态状态、中文缺口和下一步', () => {
    const wrapper = mount(FormulaDrawerContent, {
      props: { formulaId: 'delta-band', ...contextProps() },
    })

    expect(wrapper.text()).toContain('当前可用性')
    expect(wrapper.text()).toContain('待输入')
    expect(wrapper.text()).toContain('公式周期推导所需输入')
    expect(wrapper.text()).toContain('下一步')
    expect(wrapper.text()).not.toContain('formula-horizon-inputs')
  })

  it('抽屉依赖关系展示注册表中文标签，不暴露阶段 id', () => {
    const wrapper = mount(FormulaDrawerContent, {
      props: { formulaId: 'delta-band', ...contextProps() },
    })

    const relations = wrapper.findAll('.fdc-block').find((section) => section.text().includes('依赖关系'))
    expect(relations.text()).toContain('市场成本')
    expect(relations.text()).toContain('模拟挂单')
    expect(relations.text()).not.toContain('order-plan')
    expect(relations.text()).not.toContain('portfolio')
  })

  it('无方向命题只展示复核条件，不展示空失效线', () => {
    const props = contextProps()
    props.graph.decision = {
      state: '周期门禁未通过',
      candidateStatus: '需刷新数据',
      executionStatus: 'blocked',
      timing: { side: null },
      missingInputs: ['formula-derived-horizon'],
      reviewConditions: ['成本锚变化后复核'],
      invalidations: [],
    }
    props.graph.plan = { primaryOrders: [], invalidation: { lower: null, upper: null } }
    const wrapper = mount(FormulaDrawerContent, {
      props: { formulaId: 'order-plan', ...props },
    })

    expect(wrapper.text()).toContain('复核条件')
    expect(wrapper.text()).toContain('市场结构周期门禁未通过')
    expect(wrapper.text()).toContain('候选状态需刷新数据')
    expect(wrapper.text()).toContain('执行状态不可执行')
    expect(wrapper.text()).toContain('成本锚变化后复核')
    expect(wrapper.text()).not.toContain('失效下沿')
    expect(wrapper.text()).not.toContain('失效上沿')
  })

  it('资本效率缺值显示未生成，不伪造 0.00×', () => {
    const props = contextProps()
    props.graph.efficiency = null
    const wrapper = mount(FormulaDrawerContent, {
      props: { formulaId: 'capital-efficiency', ...props },
    })

    expect(wrapper.text()).toContain('未生成')
    expect(wrapper.text()).not.toContain('0.00×')
  })

  it('动态持仓卡把内部 execute 保持为研究候选，且不泄漏门禁 token', () => {
    const holdingPlan = {
      shortTrade: {
        status: '观察',
        action: 'execute',
        targetId: 'firstRepair',
        expectedSessions: 3,
        expectedReturnPct: null,
        blockedReasons: ['drawdown-repair-insufficient'],
      },
      fundCycle: {
        status: '等待',
        action: 'wait-target',
        targetId: null,
        expectedSessions: null,
        expectedReturnPct: null,
        blockedReasons: ['future-machine-reason'],
      },
    }
    const wrapper = mount(FormulaFusionViews, {
      props: {
        formulaId: 'dynamic-holding-state',
        dynamicHoldingData: { holdingPlan, state: {}, milestones: [] },
        fmt: (value) => String(value),
        pctFmt: (value) => String(value ?? '—'),
      },
    })

    expect(wrapper.text()).toContain('形成模拟候选')
    expect(wrapper.text()).toContain('回撤修复尚不足')
    expect(wrapper.text()).toContain('未标注的门禁原因')
    expect(wrapper.text()).not.toContain('execute')
    expect(wrapper.text()).not.toContain('drawdown-repair-insufficient')
  })
})

function stageButton(wrapper, label) {
  return wrapper.findAll('.fn-item').find((button) => button.text().includes(label))
}

function contextProps() {
  const rows = Array.from({ length: 6 }, (_, index) => ({
    date: `2026-01-0${index + 1}`,
    close: 100 - index,
  }))
  const costPath = rows.map((row) => ({ date: row.date, anchor: 100, lower: 94, upper: 106 }))
  const formulaPath = rows.map((row) => ({
    date: row.date,
    fieldStates: {
      deltaUpper: {
        status: 'missing-input',
        missingInputs: ['formula-horizon-inputs'],
        blockedReasons: ['invalid-recovery-input'],
      },
      formulaHorizonSessions: {
        status: 'missing-input',
        missingInputs: ['formula-horizon-inputs'],
        blockedReasons: ['invalid-recovery-input'],
      },
    },
  }))
  return {
    graph: {
      inputs: { entryPrice: 95, formulaHorizonSessions: null, iv: 0.3, tradingDaysPerYear: 242 },
      researchInputs: { rangeWidth: 0.1, skew: 1, liquidity: 1, optionTenorSessions: null },
      deltaBands: null,
      decision: { missingInputs: ['formula-derived-horizon'] },
    },
    market: {
      rows: rows.length,
      range: '2026-01-01 → 2026-01-06',
      markPrice: 95,
      costAnchor: 100,
      costLow: 94,
      costHigh: 106,
      costDistance: -0.05,
      annualVol: 0.3,
      atrPercent: 0.02,
    },
    rows,
    costPath,
    formulaPath,
  }
}
