import { describe, expect, it } from 'vitest'
import { strategyProfileList } from '../strategy-planning/orderPlan.js'

describe('strategyProfileList', () => {
  it('档位顺序固定：保守 / 均衡 / 激进 / 自定义', () => {
    expect(strategyProfileList.map((profile) => profile.id)).toEqual([
      'conservative',
      'balanced',
      'aggressive',
      'custom',
    ])
  })
})
