import { describe, expect, it } from 'vitest'
import {
  CHART_ENGINE_IDS,
  getChartEngineNotice,
  getChartEngineProfile,
  normalizeChartEngine,
} from '../research-visualization/chartEngines.js'

describe('chart engine profiles', () => {
  it('非法或旧持久化值回退到 lightweight', () => {
    expect(normalizeChartEngine('unknown')).toBe(CHART_ENGINE_IDS.LIGHTWEIGHT)
    expect(getChartEngineProfile(null).label).toBe('研究图')
  })

  it('HQ 模式接入自研指标并声明仍留在研究图的标记能力', () => {
    const profile = getChartEngineProfile(CHART_ENGINE_IDS.HQCHART)
    const notice = getChartEngineNotice(CHART_ENGINE_IDS.HQCHART)
    expect(profile.capabilities).toContain('Market Lab 公式带')
    expect(profile.capabilities).toContain('自研副图')
    expect(profile.capabilities).toContain('研究筹码')
    expect(notice).toContain('回放标记')
    expect(notice).not.toContain('研究筹码')
    expect(notice).toContain('不会删除状态')
  })
})
