import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChartOverlayToggles from '../ChartOverlayToggles.vue'
import { CHART_OVERLAY_TOGGLES } from '../chartOverlayToggles.js'

describe('ChartOverlayToggles', () => {
  it('通过命令事件修改图层，不直接写入 overlays prop', async () => {
    const overlays = Object.fromEntries(CHART_OVERLAY_TOGGLES.map(({ key }) => [key, false]))
    const wrapper = mount(ChartOverlayToggles, { props: { overlays } })
    const lpIndex = CHART_OVERLAY_TOGGLES.findIndex(({ key }) => key === 'lpBand')

    await wrapper.findAll('input')[lpIndex].setValue(true)

    expect(overlays.lpBand).toBe(false)
    expect(wrapper.emitted('change')).toContainEqual(['lpBand', true])
    expect(wrapper.text()).toContain('LP 动态公式研究区间')
  })
})
