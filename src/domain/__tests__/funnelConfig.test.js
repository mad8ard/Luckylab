import { describe, expect, it } from 'vitest'

import { A_SHARE_FUNNEL } from '../strategy-planning/funnelConfig.js'

describe('A股漏斗数量配置', () => {
  it('相对50→30→15各收缩约30%', () => {
    expect(A_SHARE_FUNNEL.firstStage.total).toBe(35)
    expect(A_SHARE_FUNNEL.secondStage).toBe(21)
    expect(A_SHARE_FUNNEL.finalStage).toBe(10)
  })

  it('第一段两档数量之和等于目标总数', () => {
    expect(A_SHARE_FUNNEL.firstStage.focus + A_SHARE_FUNNEL.firstStage.wait).toBe(
      A_SHARE_FUNNEL.firstStage.total,
    )
  })
})
