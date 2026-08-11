/** 与 Light 图一致的副图参考线。它们只辅助读图，不计入业务指标数量。 */
export function buildMarketLabChartGuides(groupId, rows) {
  const guides = GUIDE_DEFINITIONS[groupId] ?? []
  return guides.map((guide) => ({
    ...guide,
    render: 'line',
    unit: 'num',
    source: 'chart-guide',
    sourceField: `chart-guide.${guide.id}`,
    showTitle: false,
    points: rows.map((row) => ({ time: row.date, value: guide.value })),
  }))
}

const GUIDE_DEFINITIONS = Object.freeze({
  greeks: Object.freeze([guide('greeksZero', '0', 0, '#888', 'dashed', 'delta')]),
  lp: Object.freeze([guide('lpZero', 'LP 暴露零线', 0, '#888', 'dashed', 'ratio')]),
  carry: Object.freeze([guide('carryZero', '归因零线', 0, '#888', 'dashed', 'shared')]),
  equity: Object.freeze([guide('equityZero', '盈亏=0', 0, '#888', 'dashed', 'shared')]),
  kdj: Object.freeze([
    guide('kdjUpper', 'KDJ 100', 100, 'rgba(255,0,0,0.3)', 'dashed', 'shared'),
    guide('kdjLower', 'KDJ 0', 0, 'rgba(0,167,6,0.3)', 'dashed', 'shared'),
  ]),
  rsi: Object.freeze([
    guide('rsiUpper', 'RSI 100', 100, 'rgba(120,123,134,0.5)', 'solid', 'shared'),
    guide('rsiMiddle', 'RSI 50', 50, 'rgba(0,0,0,0.7)', 'solid', 'shared'),
    guide('rsiLower', 'RSI 0', 0, 'rgba(120,123,134,0.5)', 'solid', 'shared'),
  ]),
})

function guide(id, label, value, color, lineStyle, scale) {
  return Object.freeze({ id, label, value, color, lineStyle, lineWidth: 1, scale })
}
