import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import OptionPortfolioInputs from '../OptionPortfolioInputs.vue'

describe('OptionPortfolioInputs path scenario command', () => {
  it('把主图投影开关转换为显式命令', async () => {
    const input = {
      entryPrice: 100,
      optionStrategy: 'single',
      optionType: 'put',
      optionSide: 'long',
      optionQuantity: 1,
      optionMultiplier: 1,
      optionWidthPct: 0.05,
      riskFreeRate: 0.04,
      strikePrice: 100,
      optionTenorSessions: 20,
      pathUsesScenarioInputs: false,
      lpScenarioEnabled: false,
      lpScenarioStartPrice: null,
      lpScenarioRangeWidth: null,
      lpScenarioSkew: null,
      lpScenarioLiquidity: null,
    }
    const wrapper = mount(OptionPortfolioInputs, { props: { input } })

    await wrapper.find('input[role="switch"]').setValue(true)
    expect(wrapper.emitted('set-path-scenario')?.[0]).toEqual([true])
    expect(input.pathUsesScenarioInputs).toBe(false)
  })

  it('LP 指标默认关闭，必须显式声明完整研究情景', async () => {
    const input = {
      entryPrice: 100,
      optionStrategy: 'single',
      optionType: 'put',
      optionSide: 'long',
      optionQuantity: 1,
      optionMultiplier: 1,
      optionWidthPct: 0.05,
      riskFreeRate: 0.04,
      strikePrice: 100,
      optionTenorSessions: 20,
      pathUsesScenarioInputs: false,
      lpScenarioEnabled: false,
      lpScenarioStartPrice: null,
      lpScenarioRangeWidth: null,
      lpScenarioSkew: null,
      lpScenarioLiquidity: null,
    }
    const wrapper = mount(OptionPortfolioInputs, { props: { input } })

    expect(wrapper.text()).toContain('默认不估值')
    const switches = wrapper.findAll('input[role="switch"]')
    expect(switches).toHaveLength(2)
    await switches[1].setValue(true)

    expect(wrapper.emitted('set-lp-scenario-field')?.[0]).toEqual(['lpScenarioEnabled', true])
    expect(input.lpScenarioEnabled).toBe(false)
    await wrapper.setProps({ input: { ...input, lpScenarioEnabled: true } })
    expect(wrapper.text()).toContain('LP 情景入场价')
    expect(wrapper.text()).toContain('LP 情景流动性 L')
    expect(wrapper.text()).toContain('待补输入')
  })
})
