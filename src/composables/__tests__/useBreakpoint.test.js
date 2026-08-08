import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useBreakpoint, __resetBreakpointForTests } from '../useBreakpoint.js'

describe('useBreakpoint', () => {
  let listeners = {}
  let mqStates = {}

  beforeEach(() => {
    listeners = {}
    // 用可变对象保存每个 query 的 matches，便于在测试中翻转后触发回调
    mqStates = {
      '(max-width: 768px)': { matches: true },
      '(max-width: 1024px)': { matches: false },
    }
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      get matches() { return mqStates[query]?.matches ?? false },
      addEventListener: (_event, cb) => { listeners[query] = cb },
      removeEventListener: () => { delete listeners[query] },
    }))
    // 单例模式下需要在每个用例之间手动重置内部状态与监听器
    __resetBreakpointForTests()
  })

  function harness() {
    const Comp = defineComponent({
      setup() {
        const bp = useBreakpoint()
        return () => h('div', { 'data-mobile': bp.isMobile.value, 'data-tablet': bp.isTablet.value })
      },
    })
    return mount(Comp)
  }

  it('mobile 媒体匹配时返回 isMobile=true', () => {
    const wrapper = harness()
    expect(wrapper.attributes('data-mobile')).toBe('true')
  })

  it('mq.change 事件触发后 isTablet 反映新的 matches 值', async () => {
    const wrapper = harness()
    // 初始状态：tablet 未匹配
    expect(wrapper.attributes('data-tablet')).toBe('false')
    // 翻转底层 matches 后触发回调，验证监听器确实被注册并执行 syncTablet
    mqStates['(max-width: 1024px)'].matches = true
    listeners['(max-width: 1024px)']()
    await wrapper.vm.$nextTick()
    expect(wrapper.attributes('data-tablet')).toBe('true')
  })

  it('多次调用 useBreakpoint 复用同一个 ref 与监听器（单例语义）', () => {
    const a = useBreakpoint()
    const b = useBreakpoint()
    expect(a.isMobile).toBe(b.isMobile)
    expect(a.isTablet).toBe(b.isTablet)
    // matchMedia 只被调用一次（mobile + tablet 两个 query 各一次，共两次），
    // 第二次 useBreakpoint 不应再触发新的 matchMedia
    expect(window.matchMedia).toHaveBeenCalledTimes(2)
  })
})
