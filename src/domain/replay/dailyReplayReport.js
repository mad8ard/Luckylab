export function engineScope() {
  return {
    id: 'spot-path-replay',
    label: '现货路径回放',
    status: 'partial',
    includes: [
      '现金',
      '现货底仓',
      '下一根 K 线开盘/限价触及成交',
      '成交后重算周期',
      '按批次独立的目标/失效/到期退出',
      '开盘跳空优先、盘中顺序未知时止损优先',
      '新成交批次从下一根完整日线开始评估退出',
    ],
    excludes: [
      '期权腿生命周期',
      'LP 区间库存',
      '手续费真实累积',
      '资金费率结算',
      '流动性重分配治理',
      '市场结算规则与日内成交顺序',
    ],
  }
}

export function summarizeReplay({
  rows,
  events,
  equityCurve,
  cash,
  base,
  costBasis,
  capital,
  profile,
  startIndex = 0,
  initialUsedNotional = 0,
  formulaStrategy = null,
  candidateAudit = null,
}) {
  let peak = 0
  let peakDate = null
  let maxDrawdown = 0
  let maxDrawdownPct = 0
  let maxDrawdownStart = null
  let maxDrawdownEnd = null
  const drawdownCurve = []
  for (const point of equityCurve) {
    if (point.equity >= peak) {
      peak = point.equity
      peakDate = point.date
    }
    const drawdown = point.equity - peak
    const accountPeak = capital + peak
    const drawdownPct = accountPeak > 0 ? drawdown / accountPeak : 0
    drawdownCurve.push({ date: point.date, drawdown, drawdownPct })
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown
      maxDrawdownPct = drawdownPct
      maxDrawdownStart = peakDate
      maxDrawdownEnd = point.date
    }
  }

  const realized = events.filter((event) => event.side === 'sell')
  const wins = realized.filter((event) => event.pnl > 0).length
  const totalPnl = equityCurve.at(-1)?.equity ?? 0
  const totalNotional = events.reduce((sum, event) => sum + event.notional, 0)
  const usedNotional = equityCurve.reduce(
    (peakUsed, point) => Math.max(peakUsed, finiteNonNegative(point.usedNotional)),
    finiteNonNegative(initialUsedNotional),
  )
  const lastClose = rows.at(-1)?.close ?? 0
  const startDate = rows[startIndex]?.date ?? rows[0]?.date ?? ''
  const endDate = rows.at(-1)?.date ?? ''

  return {
    engineScope: engineScope(),
    profileId: profile.id,
    profileLabel: profile.label,
    candidateAudit: candidateAudit ?? emptyCandidateAudit(),
    formulaStrategy: formulaStrategySnapshot(formulaStrategy),
    drawdownBasis: drawdownBasis(formulaStrategy),
    startDate,
    endDate,
    range: startDate && endDate ? `${startDate} ~ ${endDate}` : '',
    trades: events,
    equityCurve,
    tradeCount: events.length,
    winRate: realized.length ? wins / realized.length : 0,
    totalPnl,
    realizedPnl: realized.reduce((sum, event) => sum + event.pnl, 0),
    totalNotional,
    usedNotional,
    returnOnUsedNotional: usedNotional > 0 ? totalPnl / usedNotional : 0,
    maxDrawdown,
    maxDrawdownPct,
    maxDrawdownStart,
    maxDrawdownEnd,
    drawdownCurve,
    cash,
    base,
    openValue: base * lastClose,
    openCost: costBasis,
  }
}

// 保留公式清单中的历史查询名；实际报告 API 使用更明确的 summarizeReplay。
export function summarize(options) {
  return summarizeReplay(options)
}

export function formulaStrategySnapshot(strategy) {
  if (!strategy) return null
  return {
    label: strategy.label,
    summary: strategy.summary,
    steps: (strategy.steps ?? []).map((step) => ({
      id: step.id,
      label: step.label,
      status: step.status,
      value: step.value,
    })),
  }
}

export function emptyReplay() {
  return {
    engineScope: engineScope(),
    profileId: '',
    profileLabel: '',
    formulaStrategy: null,
    candidateAudit: emptyCandidateAudit(),
    drawdownBasis: drawdownBasis(null),
    range: '',
    startDate: '',
    endDate: '',
    trades: [],
    equityCurve: [],
    tradeCount: 0,
    winRate: 0,
    totalPnl: 0,
    realizedPnl: 0,
    totalNotional: 0,
    usedNotional: 0,
    returnOnUsedNotional: 0,
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    maxDrawdownStart: null,
    maxDrawdownEnd: null,
    drawdownCurve: [],
    cash: 0,
    base: 0,
    openValue: 0,
    openCost: 0,
  }
}

function emptyCandidateAudit() {
  return {
    eligiblePrefixes: 0,
    diagnosticBuyPrefixes: 0,
    diagnosticSellPrefixes: 0,
    acceptedCandidates: 0,
    blockedCandidates: 0,
    statusCounts: { 观察: 0, 等待: 0, 剔除: 0, 需刷新数据: 0 },
  }
}

function drawdownBasis(strategy) {
  const steps = strategy?.steps?.map((step) => step.label).filter(Boolean)
  return {
    label: '现货路径回撤',
    source: steps?.length ? steps.join(' → ') : '成本路径 → GetDelta → 偏离强度 → OrderPlan',
    note: '这里只是现货账户权益路径；期权、LP、资金费率和流动性重分配还没有进入组合回测引擎。',
  }
}

function finiteNonNegative(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : 0
}
