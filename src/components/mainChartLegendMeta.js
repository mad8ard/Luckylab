/**
 * MainChart hover legend 域：series 展示元数据 + fallback 取值 + 分组排序
 *
 * 这层是纯视图配置（title/color/unit/group），不沾染 chart 实例或 Vue 响应式。
 * MainChart.vue 在 buildLegend 时把它当作只读字典查询。
 */

// 每个 series 的展示 metadata（title/color/unit/group）
export const SERIES_META = {
  cost:        { title: '成本锚',           color: '#0e7558', unit: 'price', group: 'price' },
  costUpper:   { title: '成本上沿',         color: '#8b5a16', unit: 'price', group: 'price' },
  costLower:   { title: '成本下沿',         color: '#274f9f', unit: 'price', group: 'price' },
  deltaUpper:  { title: 'GetDelta 上沿',    color: '#9a4f00', unit: 'price', group: 'price' },
  deltaLower:  { title: 'GetDelta 下沿',    color: '#1f5fbf', unit: 'price', group: 'price' },
  lpLower:     { title: 'LP 区间下沿',      color: '#7a5cff', unit: 'price', group: 'price' },
  lpUpper:     { title: 'LP 区间上沿',      color: '#7a5cff', unit: 'price', group: 'price' },
  lpRealPrice: { title: '链上池价',         color: '#8b5a16', unit: 'price', group: 'price' },
  entry:       { title: '入场价',           color: '#b3261e', unit: 'price', group: 'price' },
  bsDelta:     { title: '期权 Delta',       color: '#a93226', unit: 'num',   group: 'greeks' },
  bsGamma:     { title: '期权 Gamma',       color: '#8b5a16', unit: 'num',   group: 'greeks' },
  bsTheta:     { title: '期权 Theta/日',    color: '#274f9f', unit: 'num',   group: 'greeks' },
  lpDelta:     { title: 'LP 库存暴露',      color: '#0e7558', unit: 'ratio', group: 'lp' },
  lpValue:     { title: 'LP 库存价值',      color: '#7a5cff', unit: 'price', group: 'lp' },
  lpRealDiv:   { title: '链上池价偏离',     color: '#8b5a16', unit: 'pct',   group: 'lp' },
  lpPoolTurnover: { title: '真实池24h换手',  color: '#b3261e', unit: 'pct',   group: 'lp' },
  lpPoolConcentration: { title: '主池资金占比', color: '#274f9f', unit: 'ratio', group: 'lp' },
  lpCe:        { title: '资本效率',         color: '#8b5a16', unit: 'num',   group: 'lp' },
  fundingProxy:{ title: 'Funding 估算',     color: '#a93226', unit: 'pct',   group: 'carry' },
  netCarry:    { title: '净持有收益',       color: '#0e7558', unit: 'pct',   group: 'carry' },
  equity:      { title: '回放权益',         color: '#1f5fbf', unit: 'price', group: 'equity' },
  kdjK:        { title: 'KDJ K/D 均',       color: '#cc8400', unit: 'num',   group: 'kdj' },
  kdjJ:        { title: 'KDJ J',            color: '#4e4e4e', unit: 'num',   group: 'kdj' },
  rsi:         { title: 'RSI',              color: '#2e2e2e', unit: 'num',   group: 'rsi' },
}

/**
 * hover 时按 idx 从 formulaPath/costPath/entryPrice 反查某 series 的兜底值
 * （首选是 lightweight-charts 的 param.seriesData，失败时走这条路径）
 *
 * ctx 形如 `{ formulaPath, costPath, entryPrice }`，可以直接传入 Vue 的 props（响应式 proxy 会自动 unwrap），
 * 或任意纯对象。函数只读取这三个字段，不会写入。
 */
export function fallbackValue(key, idx, ctx = {}) {
  const fp = ctx.formulaPath?.[idx]
  const cp = ctx.costPath?.[idx]
  switch (key) {
    case 'cost':        return cp?.anchor ?? fp?.costAnchor
    case 'costUpper':   return cp?.upper  ?? fp?.costUpper
    case 'costLower':   return cp?.lower  ?? fp?.costLower
    case 'deltaUpper':  return fp?.deltaUpper
    case 'deltaLower':  return fp?.deltaLower
    case 'lpLower':     return fp?.lpLowerPrice
    case 'lpUpper':     return fp?.lpUpperPrice
    case 'lpRealPrice': return fp?.lpRealPrice
    case 'entry':       return ctx.entryPrice
    case 'bsDelta':     return fp?.optionDelta
    case 'bsGamma':     return fp?.optionGamma
    case 'bsTheta':     return fp?.optionThetaDaily
    case 'lpDelta':     return fp?.lpNormalizedDelta
    case 'lpValue':     return fp?.lpValue
    case 'lpRealDiv':   return fp?.lpRealDivergence
    case 'lpPoolTurnover':
      return idx === ctx.formulaPath?.length - 1 ? fp?.lpPoolTurnover24h : null
    case 'lpPoolConcentration':
      return idx === ctx.formulaPath?.length - 1 ? fp?.lpPoolTopReserveShare : null
    case 'lpCe':        return fp?.capitalEfficiency
    case 'fundingProxy':return fp?.fundingProxy
    case 'netCarry':    return fp?.netCarry
    default:            return null
  }
}

/** 把扁平 indicators 数组按 group 聚合，并保持稳定的展示顺序 */
export function groupIndicators(indicators) {
  const order = ['price', 'greeks', 'lp', 'carry', 'kdj', 'rsi', 'equity']
  const buckets = new Map(order.map((g) => [g, []]))
  for (const ind of indicators) {
    if (!buckets.has(ind.group)) buckets.set(ind.group, [])
    buckets.get(ind.group).push(ind)
  }
  const out = []
  for (const g of order) {
    const list = buckets.get(g)
    if (list?.length) out.push({ group: g, items: list })
  }
  return out
}
