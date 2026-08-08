import { buildMarketStatePath } from '../market-data/cost.js'
import { buildDecisionGraph, resolveProfile } from '../planning/orderPlan.js'
import { resolveExitTargetReturn } from '../formulas/core.js'

function warmupDays(totalRows) { return Math.min(80, Math.max(20, Math.floor(totalRows * 0.03))) }

export function buildDailyReplay(rows, input, marketStates = null) {
  if (!Array.isArray(rows) || rows.length < 30) return emptyReplay()
  const WARMUP = warmupDays(rows.length)
  if (rows.length <= WARMUP + 2) return emptyReplay()
  const tdpy = Number(input.tradingDaysPerYear) || 365
  const capital = Math.max(Number(input.capital) || 0, 0)
  const initialBaseNotional = Math.max(Number(input.baseNotional) || 0, 0)
  if (capital <= 0 && initialBaseNotional <= 0) {
    return { ...emptyReplay(), status: 'missing-account-input' }
  }
  const startIndex = replayStartIndex(rows, input.accountStartDate, WARMUP)
  if (rows.length <= startIndex + 2) {
    return {
      ...emptyReplay(),
      status: 'insufficient-range',
      startDate: rows[startIndex]?.date ?? '',
      endDate: rows.at(-1)?.date ?? '',
      range: rows[startIndex]?.date ? `${rows[startIndex].date} ~ ${rows.at(-1)?.date}` : '',
    }
  }
  const initialPrice = rows[startIndex]?.close ?? rows[WARMUP]?.close ?? rows[0]?.close ?? 0
  const accountCapital = capital + initialBaseNotional
  const fee = feeRate(input)
  const profile = resolveProfile(input.strategyProfile, input)
  // 优先复用外部传入的 market states，避免重复计算。
  // 当未传入或长度不一致时回退到内部计算（与外部 tdpy 保持一致）。
  const states = (Array.isArray(marketStates) && marketStates.length === rows.length)
    ? marketStates
    : buildMarketStatePath(rows, tdpy)
  const events = []
  const equityCurve = []
  let cash = capital
  let base = initialPrice > 0 ? initialBaseNotional / initialPrice : 0
  let costBasis = initialBaseNotional
  let nextSignalIndex = startIndex
  let pendingOrder = null
  let exitPlan = initialExitPlan({ initialBaseNotional, initialPrice, startIndex, states, input })
  let lastFormulaStrategy = null

  for (let index = startIndex; index < rows.length; index += 1) {
    const row = rows[index]
    const market = states[index]
    const accountAction = accountExit({ row, index, market, cash, base, costBasis, fee, profile, exitPlan, input })
    if (accountAction) {
      cash = accountAction.cash
      base = accountAction.base
      costBasis = accountAction.costBasis
      events.push(accountAction.event)
      nextSignalIndex = index + profile.buyCooldown
      pendingOrder = null
      exitPlan = null
    }

    if (pendingOrder && pendingOrder.expiresAt < index) pendingOrder = null
    if (pendingOrder) {
      const fill = fillPendingOrder({ row, index, pendingOrder })
      if (fill) {
        const previousBase = base
        const applied = applyFill({ pendingOrder, fill, cash, base, costBasis, fee })
        if (applied) {
          cash = applied.cash
          base = applied.base
          costBasis = applied.costBasis
          if (pendingOrder.order.side === 'buy') {
            const nextPlan = orderExitPlan({ order: pendingOrder.order, formulaStrategy: pendingOrder.formulaStrategy, fill, input })
            applied.event.targetPrice = nextPlan.targetPrice
            applied.event.stopPrice = nextPlan.stopPrice
            applied.event.expiresAt = nextPlan.expiresAt
            exitPlan = mergeExitPlan({
              currentPlan: exitPlan,
              currentBase: previousBase,
              addedBase: applied.event.baseAmount,
              nextPlan,
            })
          } else if (base <= 0) {
            exitPlan = null
          }
          events.push(applied.event)
          nextSignalIndex = index + (pendingOrder.order.side === 'buy' ? profile.buyCooldown : profile.sellCooldown)
        }
        pendingOrder = null
      }
    }

    const equity = cash + base * row.close
    equityCurve.push({ date: row.date, equity: equity - accountCapital })
    if (index >= rows.length - 1 || index < nextSignalIndex || pendingOrder) continue

    const graph = buildDecisionGraph({
      market,
      input: replayInput(input, market, profile),
      account: { cash, base, costBasis },
    })
    lastFormulaStrategy = graph.formulaStrategy ?? lastFormulaStrategy
    const order = chooseAccountOrder(graph, { cash, base, markPrice: row.close })
    if (!order) continue
    pendingOrder = {
      order,
      formulaStrategy: graph.formulaStrategy,
      signalDate: row.date,
      signalIndex: index,
      expiresAt: Math.min(rows.length - 1, index + 1),
    }
  }

  return summarize({ rows, events, equityCurve, cash, base, costBasis, capital: accountCapital, profile, startIndex, formulaStrategy: lastFormulaStrategy })
}

function engineScope() {
  return {
    id: 'spot-path-replay',
    label: '现货路径回放',
    status: 'partial',
    includes: ['现金', '现货底仓', '下一根 K 线限价成交', '目标/失效/到期退出'],
    excludes: ['期权腿生命周期', 'LP 区间库存', '手续费真实累积', '资金费率结算', '流动性重分配治理'],
  }
}

function replayStartIndex(rows, accountStartDate, warmup) {
  const requested = String(accountStartDate ?? '').trim()
  if (!requested) return warmup
  const index = rows.findIndex((row) => row.date >= requested)
  if (index < 0) return Math.max(warmup, rows.length - 1)
  return Math.max(warmup, index)
}

function accountExit({ row, index, market, cash, base, costBasis, fee, profile, exitPlan, input }) {
  if (base <= 0) return null
  const averageCost = costBasis / base
  const target = finite(exitPlan?.targetPrice) ? exitPlan.targetPrice : averageCost * (1 + targetReturn(input))
  if (row.high >= target) {
    return closeAccountPosition({
      row,
      index,
      cash,
      base,
      costBasis,
      fee,
      price: target,
      reason: '目标',
      formulaStrategy: exitPlan?.formulaStrategy,
    })
  }
  if (finite(exitPlan?.stopPrice) && row.close <= exitPlan.stopPrice) {
    return closeAccountPosition({
      row,
      index,
      cash,
      base,
      costBasis,
      fee,
      price: row.close,
      reason: '失效',
      formulaStrategy: exitPlan?.formulaStrategy,
    })
  }
  const cutMomentum = Math.max(market.atrPercent * profile.cutMomentumAtr, profile.cutMomentumMin)
  if (row.close < market.costLow && market.momentum5 < -cutMomentum) {
    return closeAccountPosition({
      row,
      index,
      cash,
      base,
      costBasis,
      fee,
      price: row.close,
      reason: '风控',
      formulaStrategy: exitPlan?.formulaStrategy,
    })
  }
  if (Number.isFinite(exitPlan?.expiresAt) && index >= exitPlan.expiresAt) {
    return closeAccountPosition({
      row,
      index,
      cash,
      base,
      costBasis,
      fee,
      price: row.close,
      reason: '到期',
      formulaStrategy: exitPlan?.formulaStrategy,
    })
  }
  return null
}

function closeAccountPosition({ row, index, cash, base, costBasis, fee, price, reason, formulaStrategy }) {
  const sellBase = base
  const averageCost = costBasis / base
  const proceeds = sellBase * price * (1 - fee)
  return {
    cash: cash + proceeds,
    base: 0,
    costBasis: 0,
    event: {
      side: 'sell',
      signalDate: null,
      fillDate: row.date,
      exitDate: row.date,
      exitIndex: index,
      fillPrice: price,
      exitPrice: price,
      notional: sellBase * price,
      baseAmount: sellBase,
      pnl: proceeds - averageCost * sellBase,
      returnRate: averageCost > 0 ? (price - averageCost) / averageCost : 0,
      reason,
      formulaStrategy: formulaStrategySnapshot(formulaStrategy),
    },
  }
}

function replayInput(input, market, profile) {
  return {
    ...input,
    strategyProfile: profile.id,
    entryPrice: market.markPrice,
    holdingDays: holdingDays(input),
    iv: market.annualVol,
    strikePrice: market.markPrice * 1.05,
    startPrice: market.costAnchor,
    perpTwap: market.markPrice,
    spotTwap: market.markPrice,
  }
}

function chooseAccountOrder(graph, account) {
  const order = graph.plan.primaryOrders[0]
  if (!order) return null
  if (order.side === 'buy' && account.cash > 0) return order
  if (order.side === 'sell' && account.base * account.markPrice > 0) return order
  return null
}

function fillPendingOrder({ row, index, pendingOrder }) {
  const { order } = pendingOrder
  if (index <= pendingOrder.signalIndex) return null
  if (order.side === 'buy' && row.low <= order.price) return { index, date: row.date, price: order.price }
  if (order.side === 'sell' && row.high >= order.price) return { index, date: row.date, price: order.price }
  return null
}

function applyFill({ pendingOrder, fill, cash, base, costBasis, fee }) {
  const { order, signalDate } = pendingOrder
  if (order.side === 'buy') {
    const spend = Math.min(order.notional, cash)
    if (spend <= 0) return null
    const acquired = (spend * (1 - fee)) / fill.price
    return {
      cash: cash - spend,
      base: base + acquired,
      costBasis: costBasis + spend,
      event: eventRow({ order, formulaStrategy: pendingOrder.formulaStrategy, signalDate, signalIndex: pendingOrder.signalIndex, fill, pnl: 0, reason: '建仓', notional: spend, baseAmount: acquired, investedCost: spend }),
    }
  }
  const sellBase = Math.min(base, order.notional / fill.price)
  if (sellBase <= 0) return null
  const averageCost = base > 0 ? costBasis / base : 0
  const proceeds = sellBase * fill.price * (1 - fee)
  const removedCost = averageCost * sellBase
  const nextBase = Math.max(0, base - sellBase)
  return {
    cash: cash + proceeds,
    base: nextBase < 1e-12 ? 0 : nextBase,
    costBasis: nextBase < 1e-12 ? 0 : Math.max(0, costBasis - removedCost),
    event: eventRow({ order, formulaStrategy: pendingOrder.formulaStrategy, signalDate, signalIndex: pendingOrder.signalIndex, fill, pnl: proceeds - removedCost, reason: '减仓', notional: sellBase * fill.price, baseAmount: sellBase, investedCost: removedCost }),
  }
}

function eventRow({ order, formulaStrategy, signalDate, signalIndex = null, fill, pnl, reason, notional, baseAmount, investedCost }) {
  return {
    side: order.side,
    signalDate,
    signalIndex,
    fillDate: fill.date,
    exitDate: fill.date,
    exitIndex: fill.index,
    fillPrice: fill.price,
    exitPrice: fill.price,
    targetPrice: order.targetPrice,
    stopPrice: order.stopPrice,
    expiresAt: Number.isFinite(order.holdDays) ? fill.index + order.holdDays : null,
    notional,
    baseAmount,
    pnl,
    returnRate: investedCost > 0 ? pnl / investedCost : 0,
    reason,
    formulaStrategy: formulaStrategySnapshot(formulaStrategy),
  }
}

function initialExitPlan({ initialBaseNotional, initialPrice, startIndex, states, input }) {
  if (initialBaseNotional <= 0 || initialPrice <= 0) return null
  const market = states[startIndex] ?? null
  return {
    targetPrice: initialPrice * (1 + targetReturn(input)),
    stopPrice: finite(market?.costLow) ? market.costLow : null,
    expiresAt: startIndex + holdingDays(input),
  }
}

function orderExitPlan({ order, formulaStrategy, fill, input }) {
  const targetByReturn = fill.price * (1 + targetReturn(input))
  return {
    targetPrice: Math.max(positive(order.targetPrice) ?? 0, targetByReturn),
    stopPrice: positive(order.stopPrice),
    expiresAt: fill.index + (Number.isFinite(order.holdDays) ? order.holdDays : holdingDays(input)),
    formulaStrategy: formulaStrategySnapshot(formulaStrategy),
  }
}

function mergeExitPlan({ currentPlan, currentBase, addedBase, nextPlan }) {
  if (!nextPlan) return currentPlan
  if (!currentPlan || currentBase <= 0) return nextPlan
  const totalBase = currentBase + addedBase
  if (totalBase <= 0) return nextPlan
  return {
    targetPrice: weighted(currentPlan.targetPrice, currentBase, nextPlan.targetPrice, addedBase),
    stopPrice: lowerFinite(currentPlan.stopPrice, nextPlan.stopPrice),
    expiresAt: Math.max(currentPlan.expiresAt ?? 0, nextPlan.expiresAt ?? 0),
  }
}

function weighted(a, aw, b, bw) {
  if (!finite(a)) return b
  if (!finite(b)) return a
  return (a * aw + b * bw) / (aw + bw)
}

function lowerFinite(a, b) {
  if (!finite(a)) return b ?? null
  if (!finite(b)) return a
  return Math.min(a, b)
}

function holdingDays(input) {
  return Math.max(Math.round(Number(input?.holdingDays) || 1), 1)
}

function targetReturn(input) {
  return resolveExitTargetReturn(input)
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
}

function summarize({ rows, events, equityCurve, cash, base, costBasis, capital, profile, startIndex = 0, formulaStrategy = null }) {
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
  const lastClose = rows.at(-1)?.close ?? 0
  const startDate = rows[startIndex]?.date ?? rows[0]?.date ?? ''
  const endDate = rows.at(-1)?.date ?? ''
  return {
    engineScope: engineScope(),
    profileId: profile.id,
    profileLabel: profile.label,
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
    returnOnUsedNotional: capital > 0 ? totalPnl / capital : 0,
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

function formulaStrategySnapshot(strategy) {
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

function drawdownBasis(strategy) {
  const steps = strategy?.steps?.map((step) => step.label).filter(Boolean)
  return {
    label: '现货路径回撤',
    source: steps?.length ? steps.join(' → ') : '成本路径 → GetDelta → 偏离强度 → OrderPlan',
    note: '这里只是现货账户权益路径；期权、LP、资金费率和流动性重分配还没有进入组合回测引擎。',
  }
}

function feeRate(input) {
  const value = Number(input.replayFeeRate)
  return Number.isFinite(value) && value >= 0 ? value : 0.001
}

function emptyReplay() {
  return {
    engineScope: engineScope(),
    profileId: '',
    profileLabel: '',
    formulaStrategy: null,
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
