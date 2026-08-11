import { buildMarketStatePath, isPrefixCausalMarketStatePath } from '../market-data/cost.js'
import { buildFormulaPath } from '../market-data/formulaPath.js'
import { buildDecisionGraph, resolveProfile } from '../planning/orderPlan.js'
import { buildDynamicHoldingGate } from '../strategy-planning/dynamicHoldingGate.js'
import {
  accountExit,
  applyFill,
  initialExitPlan,
  mergeExitPlan,
  orderExitPlan,
  positionTotals,
  rebindFormulaHorizonAtFill,
  resolveLongLotExit,
  resolveNextSessionLimitFill,
} from './dailyReplayExecution.js'
import { emptyReplay, summarizeReplay } from './dailyReplayReport.js'

export {
  accountExit,
  mergeExitPlan,
  rebindFormulaHorizonAtFill,
  resolveLongLotExit,
  resolveNextSessionLimitFill,
  summarizeReplay,
}

export function buildDailyReplay(rows, input, marketStates = null) {
  if (!Array.isArray(rows) || rows.length < 3) return emptyReplay()
  const tdpy = positive(input?.tradingDaysPerYear)
  if (tdpy === null) return { ...emptyReplay(), status: 'missing-trading-days-per-year' }
  const capital = Math.max(Number(input.capital) || 0, 0)
  const initialBaseNotional = Math.max(Number(input.baseNotional) || 0, 0)
  if (capital <= 0 && initialBaseNotional <= 0) {
    return { ...emptyReplay(), status: 'missing-account-input' }
  }
  const fee = feeRate(input)
  if (fee === null) return { ...emptyReplay(), status: 'missing-replay-fee-input' }
  const startIndex = replayStartIndex(rows, input.accountStartDate)
  if (rows.length <= startIndex + 2) {
    return insufficientRangeReplay(rows, startIndex)
  }

  const initialPrice = rows[startIndex]?.close ?? rows[0]?.close ?? 0
  const accountCapital = capital + initialBaseNotional
  const profile = resolveProfile(input.strategyProfile, input)
  const marketStatePath = resolveMarketStatePath(rows, tdpy, marketStates)
  const states = marketStatePath.states
  const formulaPath = buildFormulaPath(rows, input)
  const events = []
  const equityCurve = []
  let cash = capital
  let exitPlans = initialExitPlan({ initialBaseNotional, initialPrice, startIndex, states, input })
  let { base, costBasis } = positionTotals(exitPlans)
  let nextSignalIndex = startIndex
  let pendingOrder = null
  let lastFormulaStrategy = null
  const candidateAudit = emptyCandidateAudit()

  for (let index = startIndex; index < rows.length; index += 1) {
    const row = rows[index]
    const market = states[index]
    const accountAction = accountExit({ row, index, market, cash, fee, profile, exitPlans, input })
    if (accountAction) {
      cash = accountAction.cash
      base = accountAction.base
      costBasis = accountAction.costBasis
      exitPlans = accountAction.exitPlans
      events.push(...accountAction.events)
      nextSignalIndex = index + profile.buyCooldown
      pendingOrder = null
    }

    if (pendingOrder && pendingOrder.expiresAt < index) pendingOrder = null
    if (pendingOrder) {
      const fill = fillPendingOrder({ row, index, pendingOrder })
      if (fill) {
        const filledOrder = rebindFormulaHorizonAtFill(pendingOrder.order, fill)
        if (filledOrder) {
          const filledPendingOrder = { ...pendingOrder, order: filledOrder }
          const nextPlan =
            filledOrder.side === 'buy'
              ? orderExitPlan({ order: filledOrder, formulaStrategy: pendingOrder.formulaStrategy, fill, input })
              : null
          const applied = applyFill({
            pendingOrder: filledPendingOrder,
            fill,
            cash,
            exitPlans,
            fee,
            nextPlan,
          })
          if (applied) {
            cash = applied.cash
            base = applied.base
            costBasis = applied.costBasis
            exitPlans = applied.exitPlans
            events.push(applied.event)
            nextSignalIndex = index + (filledOrder.side === 'buy' ? profile.buyCooldown : profile.sellCooldown)
          }
        }
        pendingOrder = null
      }
    }

    const equity = cash + base * row.close
    const queryEligibility = replayQueryEligibility({
      market,
      formulaPoint: formulaPath[index],
      index,
      marketStateSource: marketStatePath.source,
    })
    equityCurve.push({ date: row.date, equity: equity - accountCapital, usedNotional: costBasis, queryEligibility })
    if (index >= rows.length - 1 || index < nextSignalIndex || pendingOrder) continue
    if (!queryEligibility.eligible) continue

    const formulaPoint = formulaPath[index]
    const dynamicHoldingGate = buildDynamicHoldingGate({
      market,
      rows: rows.slice(0, index + 1),
      formulaPoint,
      tradingDaysPerYear: tdpy,
    })
    const graph = buildDecisionGraph({
      market,
      input: replayInput(input, market, profile, formulaPoint, dynamicHoldingGate),
      account: { cash, base, costBasis },
    })
    recordCandidateAudit(candidateAudit, graph)
    lastFormulaStrategy = graph.formulaStrategy ?? lastFormulaStrategy
    const order = chooseAccountOrder(graph, { cash, base, markPrice: row.close })
    if (!order) continue
    pendingOrder = {
      order,
      formulaStrategy: graph.formulaStrategy,
      signalDate: row.date,
      signalIndex: index,
      expiresAt: index + 1,
    }
  }

  return summarizeReplay({
    rows,
    events,
    equityCurve,
    cash,
    base,
    costBasis,
    capital: accountCapital,
    profile,
    startIndex,
    initialUsedNotional: initialBaseNotional,
    formulaStrategy: lastFormulaStrategy,
    candidateAudit,
  })
}

function replayStartIndex(rows, accountStartDate) {
  const requested = String(accountStartDate ?? '').trim()
  if (!requested) return 1
  const index = rows.findIndex((row) => row.date >= requested)
  if (index < 0) return rows.length - 1
  return Math.max(1, index)
}

function replayQueryEligibility({ market, formulaPoint, index, marketStateSource }) {
  const missingInputs = []
  if (index < 1) missingInputs.push('next-session-boundary')
  if (!Number.isFinite(market?.costAnchor)) missingInputs.push('cost-anchor')
  if (!Number.isFinite(market?.annualVol) || market.annualVol <= 0) missingInputs.push('realized-volatility')
  if (!Number.isFinite(formulaPoint?.formulaHorizonSessions)) missingInputs.push('formula-derived-horizon')
  if (!Number.isFinite(formulaPoint?.deltaUpper)) missingInputs.push('getdelta-band')
  return {
    eligible: missingInputs.length === 0,
    mode: 'per-prefix-estimator-sufficiency',
    visiblePrefixRows: index + 1,
    futureRowsUsed: false,
    marketStateSource,
    missingInputs,
  }
}

function resolveMarketStatePath(rows, tradingDaysPerYear, externalStates) {
  if (isPrefixCausalMarketStatePath(externalStates, rows)) {
    return { states: externalStates, source: 'external-prefix-verified' }
  }
  return {
    states: buildMarketStatePath(rows, tradingDaysPerYear),
    source: Array.isArray(externalStates)
      ? 'internal-prefix-recomputed-from-unverified-external'
      : 'internal-prefix-computed',
  }
}

function replayInput(input, market, profile, formulaPoint, dynamicHoldingGate) {
  return {
    ...input,
    strategyProfile: profile.id,
    entryPrice: market.markPrice,
    formulaHorizonSessions: formulaPoint?.formulaHorizonSessions ?? null,
    formulaHorizonState: formulaPoint?.fieldStates?.formulaHorizonSessions ?? null,
    dynamicHoldingGate,
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
  return resolveNextSessionLimitFill({ row, index, order: pendingOrder.order, signalIndex: pendingOrder.signalIndex })
}

function insufficientRangeReplay(rows, startIndex) {
  const startDate = rows[startIndex]?.date ?? ''
  const endDate = rows.at(-1)?.date ?? ''
  return {
    ...emptyReplay(),
    status: 'insufficient-range',
    startDate,
    endDate,
    range: startDate ? `${startDate} ~ ${endDate}` : '',
  }
}

function feeRate(input) {
  if (input?.replayFeeRate === null || input?.replayFeeRate === undefined || input?.replayFeeRate === '') return null
  const value = Number(input.replayFeeRate)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
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

function recordCandidateAudit(audit, graph) {
  audit.eligiblePrefixes += 1
  const side = graph?.diagnosticTiming?.side
  if (side === 'buy') audit.diagnosticBuyPrefixes += 1
  if (side === 'sell') audit.diagnosticSellPrefixes += 1
  if (side !== 'buy' && side !== 'sell') return
  const status = graph?.decision?.candidateStatus ?? '等待'
  audit.statusCounts[status] = (audit.statusCounts[status] ?? 0) + 1
  if (graph?.decision?.timing?.side) audit.acceptedCandidates += 1
  else audit.blockedCandidates += 1
}
