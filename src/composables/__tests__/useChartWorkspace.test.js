import { effectScope, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChartWorkspace } from '../useChartWorkspace.js'

beforeEach(() => window.localStorage.clear())

describe('useChartWorkspace', () => {
  it('默认使用 lightweight，选择 HQ 后只加载一次异步组件', async () => {
    const component = { name: 'FakeHq' }
    const load = vi.fn(async () => ({ default: component }))
    const scope = effectScope()
    const model = scope.run(() => useChartWorkspace({ loadHqComponent: load }))
    expect(model.engine.value).toBe('lightweight')
    model.selectEngine('hqchart')
    await nextTick()
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(1)
    expect(model.hqComponent.value).toBe(component)
    expect(model.hqLoadState.value).toBe('ready')
    expect(model.isHqPending.value).toBe(true)
    expect(model.engine.value).toBe('lightweight')
    model.confirmHqReady()
    expect(model.isHqPending.value).toBe(false)
    expect(model.engine.value).toBe('hqchart')
    model.selectEngine('hqchart')
    expect(load).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('HQ 加载失败时自动回退研究图并保留可读错误', async () => {
    const scope = effectScope()
    const model = scope.run(() =>
      useChartWorkspace({
        loadHqComponent: async () => {
          throw new Error('chunk unavailable')
        },
      }),
    )
    model.selectEngine('hqchart')
    await nextTick()
    await Promise.resolve()
    expect(model.engine.value).toBe('lightweight')
    expect(model.fallbackError.value).toContain('chunk unavailable')
    scope.stop()
  })
})
