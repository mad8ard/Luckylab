/**
 * Market Lab 图表序列的唯一展示口径。
 *
 * Light 与 HQ 适配器只能消费这里的名称、颜色和线型，不能各自复制一套。
 * 数值仍来自各自明确的 domain 输出字段；本文件不做业务计算。
 */
export const MARKET_LAB_SERIES_STYLES = Object.freeze({
  cost: style('成本锚', 'price', '#0e7558', 2),
  costUpper: style('成本上沿', 'price', '#8b5a16', 1, 'dashed'),
  costLower: style('成本下沿', 'price', '#274f9f', 1, 'dashed'),
  deltaUpper: style('动态周期 GetDelta 上沿', 'price', '#9a4f00', 1, 'dotted'),
  deltaLower: style('动态周期 GetDelta 下沿', 'price', '#1f5fbf', 1, 'dotted'),
  lpLower: style('LP 动态研究区间下沿', 'price', '#7a5cff', 1, 'dashed'),
  lpUpper: style('LP 动态研究区间上沿', 'price', '#7a5cff', 1, 'dashed'),
  lpRealPrice: style('链上池价', 'price', '#8b5a16', 2, 'dotted'),
  entry: style('入场价', 'price', '#b3261e', 1, 'dotted'),
  mark: style('现价', 'price', '#202020', 1),
  target: style('模拟目标', 'price', '#0e7558', 1, 'dashed'),
  stop: style('失效线', 'price', '#a93226', 2, 'dashed'),
  bsDelta: style('期权 Delta', 'num', '#a93226'),
  bsGamma: style('期权 Gamma', 'num', '#8b5a16'),
  bsTheta: style('期权 Theta/交易会话', 'num', '#274f9f'),
  lpDelta: style('LP 库存暴露', 'ratio', '#0e7558'),
  lpValue: style('LP 库存价值', 'price', '#7a5cff'),
  lpRealDiv: style('链上池价偏离', 'pct', '#8b5a16'),
  lpPoolTurnover: style('真实池24h换手', 'pct', '#b3261e', 1, 'dotted'),
  lpPoolConcentration: style('主池资金占比', 'ratio', '#274f9f', 1, 'dotted'),
  lpCe: style('资本效率', 'num', '#8b5a16'),
  cumulativeFundingProxy: style('累计 Funding 代理', 'pct', '#a93226'),
  netCarry: style('持仓归因代理', 'pct', '#0e7558'),
  equity: style('回放权益', 'price', '#1f5fbf', 2),
  kdjK: style('KDJ K/D 均', 'num', 'rgba(255, 165, 0, 0.5)'),
  kdjJ: style('KDJ J', 'num', '#4e4e4e', 2),
  rsi: style('RSI', 'num', '#2e2e2e', 3),
})

export function getMarketLabSeriesStyle(id) {
  return MARKET_LAB_SERIES_STYLES[id] ?? null
}

function style(label, unit, color, lineWidth = 1, lineStyle = 'solid') {
  return Object.freeze({ label, unit, color, lineWidth, lineStyle })
}
