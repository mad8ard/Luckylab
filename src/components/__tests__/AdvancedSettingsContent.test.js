import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AdvancedSettingsContent from '../AdvancedSettingsContent.vue'

describe('AdvancedSettingsContent TDPY state', () => {
  it('renders missing inference without fabricating a number and allows an explicit override', async () => {
    const wrapper = mount(AdvancedSettingsContent, {
      props: {
        tdpyMeta: { value: null, basis: 'missing-input', label: '待识别' },
        effectiveTdpy: null,
        symbol: '导入样本',
      },
    })

    expect(wrapper.text()).toContain('年时间基 待识别')
    expect(wrapper.text()).toContain('按品种自动 · 待识别')
    const preset252 = wrapper.findAll('.adv-preset').find((button) => button.text() === '252')
    expect(preset252.attributes('disabled')).toBeUndefined()
    await preset252.trigger('click')
    expect(wrapper.emitted('override')?.[0]).toEqual(['导入样本', 252])
  })

  it('labels an explicit override by provenance', () => {
    const wrapper = mount(AdvancedSettingsContent, {
      props: {
        tdpyMeta: { value: 252, basis: 'explicit-override', label: '手动覆盖 252', inferredBasis: 'missing-input' },
        effectiveTdpy: 252,
        symbol: '导入样本',
      },
    })

    expect(wrapper.text()).toContain('已手动覆盖')
    expect(wrapper.find('.adv-source').classes()).toContain('overridden')
    expect(wrapper.find('.adv-reset').attributes('disabled')).toBeUndefined()
  })
})
