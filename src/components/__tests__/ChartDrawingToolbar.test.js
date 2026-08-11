import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChartDrawingToolbar from '../ChartDrawingToolbar.vue'

describe('ChartDrawingToolbar', () => {
  it('呈现完整工具、数量、帮助和研究边界', () => {
    const wrapper = mount(ChartDrawingToolbar, {
      props: { tool: 'trend', count: 3, helpText: '点起点，再点终点' },
    })
    expect(wrapper.get('section').attributes('aria-label')).toBe('图表画线工具')
    expect(wrapper.get('[role="toolbar"]').attributes('aria-label')).toBe('画线工具')
    expect(wrapper.text()).toContain('画图 3')
    expect(wrapper.text()).toContain('点起点，再点终点')
    expect(wrapper.text()).toContain('手绘不参与公式')
    expect(wrapper.findAll('.dt-tool').map((button) => button.text())).toEqual(['查看', '选择', '水平', '趋势', '区域'])
  })

  it('用 aria-pressed 和 active class 标识当前工具', () => {
    const wrapper = mount(ChartDrawingToolbar, { props: { tool: 'range' } })
    const buttons = wrapper.findAll('.dt-tool')
    const active = buttons.find((button) => button.text() === '区域')
    expect(active.classes()).toContain('active')
    expect(active.attributes('aria-pressed')).toBe('true')
    for (const button of buttons.filter((item) => item !== active)) {
      expect(button.attributes('aria-pressed')).toBe('false')
    }
  })

  it.each([
    ['查看', 'cursor'],
    ['选择', 'select'],
    ['水平', 'horizontal'],
    ['趋势', 'trend'],
    ['区域', 'range'],
  ])('点击 %s 发出 set-tool(%s)', async (label, tool) => {
    const wrapper = mount(ChartDrawingToolbar)
    const button = wrapper.findAll('.dt-tool').find((item) => item.text() === label)
    await button.trigger('click')
    expect(wrapper.emitted('set-tool')?.at(-1)).toEqual([tool])
  })

  it('按能力启停撤销、重做、删除和清空动作', () => {
    const wrapper = mount(ChartDrawingToolbar, {
      props: { count: 0, canUndo: false, canRedo: false, canDelete: false },
    })
    expect(wrapper.get('[aria-label="撤销画线"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="重做画线"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="删除选中画线"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.dt-clear').attributes('disabled')).toBeDefined()
  })

  it('启用动作分别发出 command 事件', async () => {
    const wrapper = mount(ChartDrawingToolbar, {
      props: { count: 2, canUndo: true, canRedo: true, canDelete: true },
    })
    await wrapper.get('[aria-label="撤销画线"]').trigger('click')
    await wrapper.get('[aria-label="重做画线"]').trigger('click')
    await wrapper.get('[aria-label="删除选中画线"]').trigger('click')
    await wrapper.get('[aria-label="适配全部K线"]').trigger('click')
    await wrapper.get('.dt-clear').trigger('click')

    expect(wrapper.emitted('undo')).toHaveLength(1)
    expect(wrapper.emitted('redo')).toHaveLength(1)
    expect(wrapper.emitted('delete')).toHaveLength(1)
    expect(wrapper.emitted('fit')).toHaveLength(1)
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })
})
