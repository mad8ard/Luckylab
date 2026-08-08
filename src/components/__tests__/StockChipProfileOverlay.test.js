import { describe, expect, it } from 'vitest'
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
})
