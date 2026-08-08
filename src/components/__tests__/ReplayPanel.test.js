import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReplayPanel from '../ReplayPanel.vue'

function replay(overrides = {}) {
  return {
    status: 'missing-account-input',
    totalPnl: 0,
    range: '',
    tradeCount: 0,
    winRate: 0,
    returnOnUsedNotional: 0,
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    cash: 0,
    openValue: 0,
    trades: [],
    ...overrides,
  }
}

describe('ReplayPanel', () => {
  it('缺账户输入时只展示可修复状态，不展示 0 指标结果', () => {
    const wrapper = mount(ReplayPanel, {
      props: {
        replay: replay(),
        input: { capital: 0, baseNotional: 0 },
      },
    })

    expect(wrapper.text()).toContain('未运行')
    expect(wrapper.text()).toContain('账户资金')
    expect(wrapper.text()).toContain('底仓名义')
    expect(wrapper.find('.replay-grid').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('兑现胜率')
    expect(wrapper.text()).not.toContain('账户回报')
  })

  it('可运行现货路径回放才展示执行、胜率和回撤指标', () => {
    const wrapper = mount(ReplayPanel, {
      props: {
        replay: replay({
          status: undefined,
          range: '2025-01-01 → 2025-02-01',
          tradeCount: 2,
          winRate: 0.5,
          returnOnUsedNotional: 0.08,
          maxDrawdown: -120,
          maxDrawdownPct: -0.02,
          cash: 1000,
          openValue: 500,
        }),
      },
    })

    expect(wrapper.find('.replay-grid').exists()).toBe(true)
    expect(wrapper.text()).toContain('执行')
    expect(wrapper.text()).toContain('兑现胜率')
    expect(wrapper.text()).toContain('回撤')
    expect(wrapper.text()).toContain('现货路径回撤')
    expect(wrapper.text()).toContain('成本路径')
    expect(wrapper.text()).toContain('LP 区间库存')
  })
})
