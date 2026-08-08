const STATUS_RANK = { ok: 0, wait: 1, missing: 2, research: 3, off: 4 }

export function buildTraderChecklist({ graph, market } = {}) {
  const items = [
    marketDataItem(market),
    triggerItem(graph),
    accountItem(graph),
    orderItem(graph),
    optionItem(graph),
    lpItem(graph),
    fundingItem(graph),
  ]
  return groupChecklist(items)
}

function marketDataItem(market) {
  if (!market?.rows || !Number.isFinite(market.markPrice)) {
    return item('entry', '市场样本', 'missing', '先加载标的 K 线', '现价、成本锚、波动率都依赖这里。')
  }
  return item('entry', '市场样本', 'ok', `${market.rows} 根 K 线`, `现价 ${fmt(market.markPrice)}，成本锚 ${fmt(market.costAnchor)}。`)
}

function triggerItem(graph) {
  const decision = graph?.decision
  if (!decision) return item('entry', '信号条件', 'missing', '等待市场态', '没有信号状态时不生成模拟挂单。')
  const triggered = decision.triggeredConditions ?? []
  const blocked = decision.blockedReasons ?? []
  if (decision.timing?.side) {
    return item('entry', '信号条件', 'ok', decision.timing.side === 'sell' ? '减仓条件满足' : '入场条件满足', triggered.join(' / ') || decision.timing.reason)
  }
  return item('entry', '信号条件', 'wait', '未触发', blocked[0] || decision.timing?.reason || '价格位置、动量或成本状态未同时满足。')
}

function accountItem(graph) {
  const account = graph?.account
  const missing = graph?.decision?.missingInputs ?? []
  if (!account?.isConfigured || missing.includes('account.capital')) {
    return item('entry', '账户输入', 'missing', '缺账户资金', '未配置资金时，只能观察条件，不能计算名义金额和风险预算。')
  }
  if (missing.includes('account.basePosition')) {
    return item('position', '底仓输入', 'missing', '缺底仓', '出现减仓条件时需要底仓名义，才可生成模拟卖出单。')
  }
  return item('entry', '账户输入', 'ok', `资金 ${fmt(account.capital)}`, `现金 ${fmt(account.cash)}，底仓 ${fmt(account.base)}。`)
}

function orderItem(graph) {
  const orders = graph?.plan?.primaryOrders ?? []
  if (orders.length) {
    const first = orders[0]
    return item('entry', '模拟挂单', 'ok', `${orders.length} 档`, `首档 ${fmt(first.price)}，名义 ${fmt(first.notional)}。`)
  }
  const missing = graph?.decision?.missingInputs ?? []
  if (missing.length) return item('entry', '模拟挂单', 'missing', '缺输入', mapMissing(missing[0]))
  return item('entry', '模拟挂单', 'wait', '未生成', '信号条件未触发，当前只适合观察。')
}

function optionItem(graph) {
  const combo = graph?.optionPortfolio
  if (!combo) return item('hedge', '期权组合', 'off', '未配置', '研究层未形成组合 Greeks。')
  if (combo.missingInputs?.length) {
    return item('hedge', '期权组合', 'research', '模型权利金', '部分 leg 使用模型价格替代真实权利金，不能当成真实持仓盈亏。')
  }
  return item('hedge', '期权组合', 'research', `${combo.legs?.length ?? 0} legs`, `Delta ${f4(combo.delta)}，Gamma ${f4(combo.gamma)}，research-only。`)
}

function lpItem(graph) {
  const missing = graph?.portfolioResearch?.missingInputs ?? []
  if (!graph?.lpV3Hedged) return item('hedge', 'LP / 流动性', 'off', '未配置', '没有 LP 区间或流动性输入。')
  if (missing.includes('real-lp-position')) {
    return item('hedge', 'LP / 流动性', 'research', '缺真实 LP', '当前是模型区间，不是链上 NFT、盘口或真实 LP 仓位。')
  }
  return item('hedge', 'LP / 流动性', 'research', '模型区间', '只用于 payoff / 库存暴露对照。')
}

function fundingItem(graph) {
  const funding = graph?.funding
  if (!funding) return item('carry', '资金费率', 'off', '未配置', '未接永续资金费率数据。')
  return item('carry', '资金费率', 'research', 'TWAP 估计', `当前估计 ${pct(funding.ratio)}，缺真实结算周期和交易所制度。`)
}

function groupChecklist(items) {
  const groups = [
    group('entry', '入场前', items),
    group('position', '持仓中', items),
    group('hedge', '组合 / 对冲', items),
    group('carry', '资金成本', items),
  ].filter(section => section.items.length)
  const worst = items
    .map(item => item.status)
    .sort((a, b) => STATUS_RANK[b] - STATUS_RANK[a])[0] ?? 'off'
  return { status: worst, groups, items }
}

function group(id, label, items) {
  return { id, label, items: items.filter(item => item.group === id) }
}

function item(group, label, status, title, detail) {
  return { group, label, status, title, detail }
}

function mapMissing(id) {
  const labels = {
    'account.capital': '需要在启动配置里填写账户资金。',
    'account.basePosition': '需要填写底仓名义，才能计算减仓候选。',
  }
  return labels[id] ?? `缺少 ${id}。`
}

function fmt(v) {
  return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—'
}

function pct(v) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '—'
}

function f4(v) {
  return Number.isFinite(v) ? v.toFixed(4) : '—'
}
