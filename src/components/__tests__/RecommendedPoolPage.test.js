import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RecommendedPoolPage from '../RecommendedPoolPage.vue'

vi.mock('../../composables/useBreakpoint.js', () => ({
  useBreakpoint: () => ({ isMobile: { value: false } }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RecommendedPoolPage', () => {
  it('使用公式交易会话字段，并把不可用状态与固定天数分开', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          generatedAt: '2026-08-10T00:00:00.000Z',
          totalCandidates: 2,
          dimensions: [],
          logic: '评分逻辑',
          riskNote: '仅研究',
          focusItems: [
            {
              symbol: 'A',
              label: '有效周期',
              market: 'A股',
              buyScore: 8,
              maxScore: 10,
              metrics: { price: 10, formulaHorizonSessions: 6.2, holdingProjectionStatus: 'eligible' },
            },
          ],
          waitItems: [
            {
              symbol: 'B',
              label: '结构不适用',
              market: 'A股',
              buyScore: 4,
              maxScore: 10,
              metrics: { price: 11, formulaHorizonSessions: null, holdingProjectionStatus: 'not-applicable' },
            },
          ],
        }),
      })),
    )

    const wrapper = mount(RecommendedPoolPage)
    await flushPromises()

    expect(wrapper.text()).toContain('评分研究池 · 非执行建议')
    expect(wrapper.text()).toContain('7 个交易会话*')
    expect(wrapper.text()).toContain('当前结构不适用')
    expect(wrapper.text()).not.toContain('--天*')
    expect(wrapper.text()).toContain('不是持仓期预测')
  })
})
