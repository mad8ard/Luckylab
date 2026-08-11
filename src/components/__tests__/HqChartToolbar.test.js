import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import HqChartToolbar from '../HqChartToolbar.vue'

const wrappers = []

const preferences = {
  period: 0,
  drawType: 0,
  mainIndex: 'EMPTY',
  subIndex1: 'MACD',
  subIndex2: 'EMPTY',
}

const overlays = {
  priceBands: true,
  costBand: true,
  volBand: true,
  lpBand: false,
  entryLine: true,
  executionMarkers: false,
  volume: true,
  greeksPane: false,
  lpPane: false,
  carryPane: false,
  equityPane: false,
  kdjPane: false,
  rsiPane: false,
  stockChipProfile: true,
}

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

describe('HqChartToolbar', () => {
  it('移动端周期入口保留 period 数字事件合约', async () => {
    const wrapper = mountToolbar()

    await wrapper.get('.hq-mobile-period select').setValue('2')

    expect(wrapper.emitted('period')).toEqual([[2]])
  })

  it('自有分组画图面板可触达，并通过既有 draw 事件选择工具', async () => {
    const wrapper = mountToolbar()
    const moreDrawing = wrapper.get('.hq-quick-draw .primary')

    expect(moreDrawing.attributes('aria-haspopup')).toBe('dialog')
    await moreDrawing.trigger('click')

    const panel = wrapper.get('#hq-accessible-draw-panel')
    expect(panel.attributes('aria-modal')).toBe('true')
    expect(panel.text()).toContain('仓位与测量')
    const fibonacci = panel.findAll('button').find((button) => button.text().includes('斐波那契回撤'))
    await fibonacci.trigger('click')

    expect(wrapper.emitted('draw')).toEqual([['FibRetracement']])
    expect(wrapper.find('#hq-accessible-draw-panel').exists()).toBe(false)
  })

  it('activeDrawing 同步快捷按钮与分组按钮的 active/aria-pressed', async () => {
    const wrapper = mountToolbar({ activeDrawing: '趋势线' })
    const quickTrend = wrapper.findAll('.hq-quick-draw button').find((button) => button.text() === '趋势线')

    expect(quickTrend.classes()).toContain('active')
    expect(quickTrend.attributes('aria-pressed')).toBe('true')

    await wrapper.get('.hq-quick-draw .primary').trigger('click')
    const panelTrend = wrapper
      .get('#hq-accessible-draw-panel')
      .findAll('button')
      .find((button) => button.text().includes('连接两个关键点'))
    expect(panelTrend.classes()).toContain('active')
    expect(panelTrend.attributes('aria-pressed')).toBe('true')
  })

  it('画图和指标 dialog 互斥，桌面 HQ 原生入口仍保留原 emit', async () => {
    const wrapper = mountToolbar()
    await wrapper.get('.hq-quick-draw .primary').trigger('click')
    expect(wrapper.find('#hq-accessible-draw-panel').exists()).toBe(true)

    await wrapper.get('.hq-layer-trigger.lab').trigger('click')
    expect(wrapper.find('#hq-accessible-draw-panel').exists()).toBe(false)
    expect(wrapper.find('#hq-lab-indicator-panel').exists()).toBe(true)

    await wrapper.get('[aria-label="关闭 Lab 研究层面板"]').trigger('click')
    await wrapper.get('.hq-quick-draw .primary').trigger('click')
    await wrapper.get('.hq-native-draw-launch').trigger('click')
    expect(wrapper.emitted('draw-tools')).toEqual([[]])
  })

  it('面板中的全览与全屏保留既有事件合约', async () => {
    const wrapper = mountToolbar()
    await wrapper.get('.hq-quick-draw .primary').trigger('click')
    const footerButtons = wrapper.findAll('.hq-draw-panel footer button')

    await footerButtons[0].trigger('click')
    await footerButtons[1].trigger('click')

    expect(wrapper.emitted('reset')).toEqual([[]])
    expect(wrapper.emitted('fullscreen')).toEqual([[]])
  })

  it('工具栏直接保留成交量与筹码开关', async () => {
    const wrapper = mountToolbar()
    const tools = wrapper.get('.chart-display-tools')
    const chip = tools.findAll('button').find((button) => button.text() === '筹码')

    expect(tools.text()).toContain('成交量')
    expect(tools.text()).toContain('主图 Log')
    await chip.trigger('click')
    expect(wrapper.emitted('set-overlay')).toEqual([['stockChipProfile', false]])
  })
})

function mountToolbar(props = {}) {
  const wrapper = mount(HqChartToolbar, {
    attachTo: document.body,
    props: {
      preferences,
      ready: true,
      rowCount: 1356,
      overlays,
      ...props,
    },
    global: { stubs: { Teleport: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}
