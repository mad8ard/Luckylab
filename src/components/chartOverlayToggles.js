export const CHART_OVERLAY_TOGGLES = [
  { key: 'priceBands', label: '价格带组' },
  { key: 'greeksPane', label: '期权希腊值子图' },
  { key: 'lpPane', label: 'LP库存子图' },
  { key: 'carryPane', label: '资金费率子图' },
  { key: 'executionMarkers', label: '执行标记' },
  { key: 'researchMarkers', label: '研究标记' },
  { key: 'costBand', label: '成本锚带' },
  { key: 'entryLine', label: '入场价线' },
  { key: 'volBand', label: '波动带' },
  { key: 'volume', label: '成交量' },
  { key: 'stockChipProfile', label: '个股筹码图' },
  { key: 'replayMarkers', label: '回放标记' },
  { key: 'replayMarkerLabels', label: '回放文字' },
  { key: 'currentDecision', label: '当前状态点' },
  { key: 'equityPane', label: '权益子图' },
  { key: 'kdjPane', label: 'KDJ随机指标子图' },
  { key: 'rsiPane', label: 'RSI相对强弱子图' },
]

export const CHART_OVERLAY_KEYS = CHART_OVERLAY_TOGGLES.map((toggle) => toggle.key)
