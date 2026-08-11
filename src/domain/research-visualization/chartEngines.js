export const CHART_ENGINE_IDS = Object.freeze({
  LIGHTWEIGHT: 'lightweight',
  HQCHART: 'hqchart',
})

export const CHART_ENGINE_PROFILES = Object.freeze({
  [CHART_ENGINE_IDS.LIGHTWEIGHT]: Object.freeze({
    id: CHART_ENGINE_IDS.LIGHTWEIGHT,
    label: '研究图',
    shortLabel: 'Light',
    description: '公式 / 成本 / 回放',
    status: '完整研究叠加',
    capabilities: Object.freeze(['公式带', '成本锚', '回放标记', '研究筹码', '轻量手绘']),
    unavailable: Object.freeze([]),
  }),
  [CHART_ENGINE_IDS.HQCHART]: Object.freeze({
    id: CHART_ENGINE_IDS.HQCHART,
    label: 'HQ 终端',
    shortLabel: 'HQ',
    description: 'Lab 指标 / HQ 工具',
    status: '双层指标终端',
    capabilities: Object.freeze([
      'Market Lab 公式带',
      '成本锚',
      '自研副图',
      'HQ 通用指标',
      '多周期',
      '高级画线',
      '多空仓尺',
      '右键菜单',
      '研究筹码',
    ]),
    unavailable: Object.freeze(['回放标记']),
  }),
})

export function normalizeChartEngine(value) {
  return Object.hasOwn(CHART_ENGINE_PROFILES, value) ? value : CHART_ENGINE_IDS.LIGHTWEIGHT
}

export function getChartEngineProfile(value) {
  return CHART_ENGINE_PROFILES[normalizeChartEngine(value)]
}

export function getChartEngineNotice(value) {
  const profile = getChartEngineProfile(value)
  if (!profile.unavailable.length) return ''
  return `${profile.unavailable.join('、')}仍保留在研究图，切换不会删除状态。`
}
