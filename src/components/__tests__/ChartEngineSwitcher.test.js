import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChartEngineSwitcher from '../ChartEngineSwitcher.vue'

function optionByLabel(wrapper, label) {
  return wrapper.findAll('.chart-engine-option').find((option) => option.get('strong').text() === label)
}

describe('ChartEngineSwitcher', () => {
  it('把未知引擎降级为研究图并暴露可访问的单选状态', () => {
    const wrapper = mount(ChartEngineSwitcher, { props: { engine: 'unknown-engine' } })

    expect(wrapper.get('section').attributes('aria-label')).toBe('图表引擎')
    expect(wrapper.get('[role="radiogroup"]').attributes('aria-label')).toBe('选择图表引擎')
    expect(optionByLabel(wrapper, '研究图').attributes('aria-checked')).toBe('true')
    expect(optionByLabel(wrapper, '研究图').classes()).toContain('active')
    expect(optionByLabel(wrapper, 'HQ 终端').attributes('aria-checked')).toBe('false')
    expect(wrapper.text()).toContain('只换图表工具，不改公式与结论。')
  })

  it('切到 HQ 时说明双层指标和仍留在研究图的能力边界', () => {
    const wrapper = mount(ChartEngineSwitcher, { props: { engine: 'hqchart' } })

    expect(optionByLabel(wrapper, 'HQ 终端').attributes('aria-checked')).toBe('true')
    expect(wrapper.get('.chart-engine-boundary').attributes('aria-live')).toBe('polite')
    expect(wrapper.text()).toContain('Lab 自研指标 + HQ 通用工具')
    expect(wrapper.get('.chart-engine-boundary').attributes('aria-label')).toContain('回放标记仍保留在研究图')
    expect(wrapper.get('.chart-engine-boundary').attributes('aria-label')).not.toContain('研究筹码')
  })

  it.each([
    ['研究图', 'lightweight'],
    ['HQ 终端', 'hqchart'],
  ])('点击 %s 发出 change(%s)', async (label, engine) => {
    const wrapper = mount(ChartEngineSwitcher)

    await optionByLabel(wrapper, label).trigger('click')

    expect(wrapper.emitted('change')?.at(-1)).toEqual([engine])
  })

  it('加载 HQ 时只锁定 HQ 选项并显示进度', () => {
    const wrapper = mount(ChartEngineSwitcher, { props: { loading: true } })

    expect(optionByLabel(wrapper, '研究图').attributes('disabled')).toBeUndefined()
    expect(optionByLabel(wrapper, 'HQ 终端').attributes('disabled')).toBeDefined()
    expect(optionByLabel(wrapper, 'HQ 终端').text()).toContain('加载中')
  })

  it('错误状态优先展示错误并允许重试', async () => {
    const wrapper = mount(ChartEngineSwitcher, {
      props: { engine: 'hqchart', error: 'HQChart 首帧等待超时' },
    })

    expect(wrapper.get('.chart-engine-boundary').classes()).toContain('error')
    expect(wrapper.text()).toContain('HQChart 首帧等待超时')

    await wrapper.get('.chart-engine-boundary button').trigger('click')

    expect(wrapper.emitted('retry')).toHaveLength(1)
  })
})
