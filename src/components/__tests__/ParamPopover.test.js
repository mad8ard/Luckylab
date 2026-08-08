import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ParamPopover from '../ParamPopover.vue'

describe('ParamPopover', () => {
  it('合法值 + Enter 触发 confirm', async () => {
    const wrapper = mount(ParamPopover, {
      props: { field: 'entryPrice', value: 100 },
    })
    const input = wrapper.find('input[type="number"]')
    await input.setValue('99.5')
    await input.trigger('keydown.enter')
    expect(wrapper.emitted('confirm')).toBeTruthy()
    expect(wrapper.emitted('confirm')[0][0]).toBe(99.5)
  })

  it('点击应用按钮也触发 confirm', async () => {
    const wrapper = mount(ParamPopover, {
      props: { field: 'iv', value: 0.4 },
    })
    const input = wrapper.find('input[type="number"]')
    // iv 字段 UI 显示 % 单位，输入 50 表示 50%
    await input.setValue('50')
    const apply = wrapper.findAll('button').find(b => b.text() === '应用')
    await apply.trigger('click')
    expect(wrapper.emitted('confirm')).toBeTruthy()
    // 50% → 0.5
    expect(wrapper.emitted('confirm')[0][0]).toBe(0.5)
  })

  it('非法值（≤0）按钮 disabled，不 emit', async () => {
    const wrapper = mount(ParamPopover, {
      props: { field: 'entryPrice', value: 100 },
    })
    const input = wrapper.find('input[type="number"]')
    await input.setValue('-5')
    const apply = wrapper.findAll('button').find(b => b.text() === '应用')
    expect(apply.attributes('disabled')).toBeDefined()
    await input.trigger('keydown.enter')
    expect(wrapper.emitted('confirm')).toBeFalsy()
  })

  it('Esc 触发 cancel', async () => {
    const wrapper = mount(ParamPopover, {
      props: { field: 'holdingDays', value: 30 },
    })
    await wrapper.find('input[type="number"]').trigger('keydown.escape')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })
})
