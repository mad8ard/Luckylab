import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import HqIndicatorLayers from '../HqIndicatorLayers.vue'

const wrappers = []

const preferences = {
  mainIndex: 'EMA',
  subIndex1: 'MACD',
  subIndex2: 'RSI',
}

const overlays = {
  priceBands: true,
  costBand: true,
  volBand: true,
  lpBand: true,
  entryLine: true,
  executionMarkers: false,
  volume: true,
  greeksPane: false,
  lpPane: false,
  carryPane: false,
  equityPane: false,
  kdjPane: false,
  rsiPane: false,
}

const researchModel = {
  activeSeriesCount: 6,
  availableSeriesCount: 14,
  controls: {
    priceBands: available('estimated', 5),
    costBand: available('estimated', 3),
    volBand: available('estimated', 2),
    lpBand: available('estimated', 2),
    entryLine: available('ready', 1),
    executionMarkers: missing('missing-execution-input'),
    volume: available('ready', 1),
    greeksPane: missing('缺少期权情景输入'),
    lpPane: missing('缺少 LP 库存输入'),
    carryPane: missing('缺少 Funding 输入'),
    equityPane: available('ready', 1),
    kdjPane: available('estimated', 2),
    rsiPane: available('estimated', 1),
  },
}

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

describe('HqIndicatorLayers', () => {
  it('提供 Lab 研究层与 HQ 指标两个可访问的一级入口', async () => {
    const wrapper = mountLayers()
    const [labTrigger, hqTrigger] = wrapper.findAll('.hq-layer-trigger')

    expect(labTrigger.text()).toContain('Lab 研究层')
    expect(labTrigger.text()).toContain('6/14 条曲线')
    expect(labTrigger.attributes('aria-haspopup')).toBe('dialog')
    expect(hqTrigger.text()).toContain('HQ 通用指标')
    expect(hqTrigger.text()).toContain('EMA · MACD · RSI')

    await labTrigger.trigger('click')
    const labPanel = wrapper.get('#hq-lab-indicator-panel')
    expect(labPanel.attributes('role')).toBe('dialog')
    expect(labPanel.attributes('aria-modal')).toBe('true')
    expect(labPanel.text()).toContain('HQChart 只负责绘制')

    await hqTrigger.trigger('click')
    expect(wrapper.find('#hq-lab-indicator-panel').exists()).toBe(false)
    expect(wrapper.get('#hq-native-indicator-panel').text()).toContain('辅助技术指标，不替代 Lab 公式口径')
    expect(hqTrigger.attributes('aria-expanded')).toBe('true')
  })

  it('缺输入项禁用，并把人话原因直接显示在面板中', async () => {
    const wrapper = mountLayers()
    await wrapper.find('.hq-layer-trigger.lab').trigger('click')

    const greeks = labelByText(wrapper, '期权 Greeks')
    expect(greeks.classes()).toContain('unavailable')
    expect(greeks.get('input').attributes('disabled')).toBeDefined()
    expect(greeks.get('[data-state="missing-input"]').text()).toBe('缺少输入')
    expect(greeks.get('.hq-layer-reason').text()).toBe('缺少期权情景输入')
    expect(greeks.get('input').attributes('aria-describedby')).toBe('hq-layer-reason-greeksPane')

    const execution = labelByText(wrapper, '目标 / 失效价格线')
    expect(execution.get('.hq-layer-reason').text()).toBe('需要持仓目标价或失效价')

    const cost = labelByText(wrapper, '成本锚带')
    expect(cost.classes()).not.toContain('unavailable')
    expect(cost.get('[data-state="estimated"]').text()).toBe('研究估算 · 3 条曲线')
  })

  it('主价格层关闭时，子层明确显示待开启而非伪装成已绘制', async () => {
    const wrapper = mountLayers({ overlays: { ...overlays, priceBands: false } })
    await wrapper.find('.hq-layer-trigger.lab').trigger('click')

    const cost = labelByText(wrapper, '成本锚带')
    expect(cost.classes()).toContain('suppressed')
    expect(cost.get('[data-state="estimated"]').text()).toBe('待开启主层')
    expect(cost.get('.hq-layer-reason').text()).toContain('开启“研究价格层”后才会绘制')
  })

  it('当前 Delta 不适用时保留历史稀疏段并明确当前无右侧值', async () => {
    const wrapper = mountLayers({
      researchModel: {
        ...researchModel,
        controls: {
          ...researchModel.controls,
          volBand: {
            state: 'not-applicable',
            reason: 'current-formula-output-unavailable',
            missing: [],
            blockedReasons: ['cycle-start-at-or-beyond-anchor'],
            outputCount: 2,
            historicalOutputCount: 2,
            active: true,
            current: true,
          },
        },
      },
    })
    await wrapper.find('.hq-layer-trigger.lab').trigger('click')

    const delta = labelByText(wrapper, '动态周期 GetDelta 路径')
    expect(delta.get('[data-state="not-applicable"]').text()).toBe('当前结构不适用')
    expect(delta.get('.hq-layer-reason').text()).toContain('历史稀疏分段仍显示')
    expect(delta.get('input').element.checked).toBe(true)
  })

  it('Lab checkbox 保留 set-overlay(key, checked) 合约', async () => {
    const wrapper = mountLayers()
    await wrapper.find('.hq-layer-trigger.lab').trigger('click')

    await labelByText(wrapper, '成本锚带').get('input').setValue(false)
    await labelByText(wrapper, '回放权益').get('input').setValue(true)

    expect(wrapper.emitted('set-overlay')).toEqual([
      ['costBand', false],
      ['equityPane', true],
    ])
  })

  it('HQ 三个 select 分别发出主图和两个副图选择事件', async () => {
    const wrapper = mountLayers()
    await wrapper.findAll('.hq-layer-trigger')[1].trigger('click')
    const selects = wrapper.findAll('.hq-native-slots select')

    expect(selects).toHaveLength(3)
    expect(selects[0].findAll('option').map((option) => option.text())).not.toContain('BOLL')
    await selects[0].setValue('EMA')
    await selects[1].setValue('CCI')
    await selects[2].setValue('EMPTY')

    expect(wrapper.emitted('main-index')).toEqual([['EMA']])
    expect(wrapper.emitted('sub-index-1')).toEqual([['CCI']])
    expect(wrapper.emitted('sub-index-2')).toEqual([['EMPTY']])
  })

  it('Escape 关闭 dialog，并把焦点还给触发按钮', async () => {
    const wrapper = mountLayers()
    const labTrigger = wrapper.find('.hq-layer-trigger.lab')
    labTrigger.element.focus()
    await labTrigger.trigger('click')

    expect(document.activeElement.getAttribute('aria-label')).toContain('关闭 Lab')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(wrapper.find('#hq-lab-indicator-panel').exists()).toBe(false)
    expect(labTrigger.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(labTrigger.element)
  })
})

function mountLayers(props = {}) {
  const wrapper = mount(HqIndicatorLayers, {
    attachTo: document.body,
    props: {
      preferences,
      overlays,
      researchModel,
      ready: true,
      ...props,
    },
    global: { stubs: { Teleport: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}

function labelByText(wrapper, text) {
  return wrapper.findAll('.hq-lab-toggle').find((label) => label.text().includes(text))
}

function available(state, outputCount) {
  return { state, reason: 'finite-output-available', outputCount, active: true, missing: [] }
}

function missing(reason) {
  return { state: 'missing-input', reason, outputCount: 0, active: false, missing: ['fixture'] }
}
