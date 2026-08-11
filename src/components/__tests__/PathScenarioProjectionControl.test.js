import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PathScenarioProjectionControl from '../PathScenarioProjectionControl.vue'

describe('PathScenarioProjectionControl', () => {
  it('默认关闭并明确标注研究边界', () => {
    const wrapper = mount(PathScenarioProjectionControl, { props: { enabled: false } })

    expect(wrapper.find('input[role="switch"]').element.checked).toBe(false)
    expect(wrapper.text()).toContain('默认关闭')
    expect(wrapper.text()).toContain('不代表真实历史期权合约')
    expect(wrapper.text()).toContain('不补 0、不插值')
  })

  it('只发出布尔命令，不直接改写输入对象', async () => {
    const wrapper = mount(PathScenarioProjectionControl, { props: { enabled: false } })

    await wrapper.find('input[role="switch"]').setValue(true)
    expect(wrapper.emitted('change')?.[0]).toEqual([true])
  })
})
