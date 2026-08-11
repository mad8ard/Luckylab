import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import StockChipProfileOverlay from '../StockChipProfileOverlay.vue'

function row(date, open, high, low, close, volume) {
  return { date, open, high, low, close, volume }
}

describe('StockChipProfileOverlay', () => {
  it('渲染成交量代理筹码图，不暴露为公式结论', () => {
    const wrapper = mount(StockChipProfileOverlay, {
      props: {
        rows: [
          row('2024-01-01', 10, 12, 9, 11, 100),
          row('2024-01-02', 11, 13, 10, 12, 200),
          row('2024-01-03', 12, 14, 11, 13, 300),
        ],
      },
    })

    expect(wrapper.text()).toContain('筹码')
    expect(wrapper.text()).toContain('成交量代理')
    expect(wrapper.text()).toContain('POC')
    expect(wrapper.find('.scp-svg').exists()).toBe(true)
    expect(wrapper.findAll('.scp-total').length).toBeGreaterThan(0)
  })

  it('优先使用图表价格映射，让对数坐标下的筹码条与主轴对齐', () => {
    const priceToY = vi.fn((price) => 180 - price * 10)
    const wrapper = mount(StockChipProfileOverlay, {
      props: {
        rows: [row('2024-01-01', 10, 12, 9, 11, 100), row('2024-01-02', 11, 13, 10, 12, 200)],
        viewport: {
          top: 24,
          height: 180,
          priceLower: 9,
          priceUpper: 13,
          activeIndex: 1,
          visibleWindow: 2,
          priceToY,
        },
      },
    })

    const firstBar = wrapper.find('.scp-total')
    expect(firstBar.exists()).toBe(true)
    expect(Number(firstBar.attributes('y'))).toBeGreaterThanOrEqual(0)
    expect(priceToY).toHaveBeenCalled()
  })
})
