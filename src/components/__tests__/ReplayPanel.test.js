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
    expect(wrapper.text()).not.toContain('历史正收益率')
    expect(wrapper.text()).not.toContain('历史情景回报')
  })

  it('可运行现货路径回放才展示历史成交、正收益率和回撤指标', () => {
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
    expect(wrapper.text()).toContain('历史成交')
    expect(wrapper.text()).toContain('历史正收益率')
    expect(wrapper.text()).toContain('历史情景回报')
    expect(wrapper.text()).toContain('回撤')
    expect(wrapper.text()).toContain('现货路径回撤')
    expect(wrapper.text()).toContain('成本路径')
    expect(wrapper.text()).toContain('LP 区间库存')
  })

  it('缺少显式费率时展示费率输入，不把空值当 0%', () => {
    const input = { capital: 10000, baseNotional: 0, replayFeeRate: null }
    const wrapper = mount(ReplayPanel, {
      props: {
        replay: replay({ status: 'missing-replay-fee-input' }),
        input,
      },
    })

    expect(wrapper.text()).toContain('系统不注入隐藏默认值')
    expect(wrapper.text()).toContain('回放总费率 %')
    expect(wrapper.find('.replay-grid').exists()).toBe(false)
  })

  it('零成交时区分诊断方向与候选门禁，不把它写成没有信号', () => {
    const wrapper = mount(ReplayPanel, {
      props: {
        replay: replay({
          status: undefined,
          candidateAudit: {
            diagnosticBuyPrefixes: 6,
            diagnosticSellPrefixes: 0,
            acceptedCandidates: 0,
          },
        }),
      },
    })

    expect(wrapper.text()).toContain('6 个诊断方向前缀')
    expect(wrapper.text()).toContain('均未通过候选门禁')
  })
})
