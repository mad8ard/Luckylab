import { deriveRecoveryHorizon, resolveExitTargetReturn } from '../formulas/core.js'
import { formulaStrategySnapshot } from './dailyReplayReport.js'

const INTRABAR_POLICY = 'open-gap-first-then-stop-first-when-intrabar-order-unknown'
const SAME_BAR_EXIT_POLICY = 'defer-to-next-complete-bar-after-fill'

export function accountExit({ row, index, market, cash, fee, profile, exitPlans, input }) {
  if (!Array.isArray(exitPlans) || exitPlans.length === 0) return null
  let nextCash = cash
  const remainingPlans = []
  const events = []

  for (const plan of exitPlans) {
    const exit = resolveLongLotExit({ row, index, market, profile, plan, input })
    if (!exit) {
      remainingPlans.push(plan)
      continue
    }
    const closed = closeAccountPosition({ row, index, cash: nextCash, fee, plan, exit })
    nextCash = closed.cash
    events.push(closed.event)
  }

  if (events.length === 0) return null
  const totals = positionTotals(remainingPlans)
  return {
    cash: nextCash,
    base: totals.base,
    costBasis: totals.costBasis,
    exitPlans: remainingPlans,
    events,
  }
}

export function resolveLongLotExit({ row, index, market, profile, plan, input }) {
  if (!plan || plan.baseAmount <= 0) return null
  if (Number.isFinite(plan.eligibleExitIndex) && index < plan.eligibleExitIndex) return null
  const averageCost = plan.investedCost / plan.baseAmount
  const target = finite(plan.targetPrice) ? Number(plan.targetPrice) : averageCost * (1 + exitTargetReturn(input))
  const stop = finite(plan.stopPrice) ? Number(plan.stopPrice) : null
  const targetHit = finite(row?.high) && row.high >= target
  const stopHit = stop !== null && finite(row?.low) && row.low <= stop
  const gapThroughTarget = targetHit && finite(row?.open) && row.open >= target
  const gapThroughStop = stopHit && finite(row?.open) && row.open <= stop

  if (gapThroughTarget) {
    return {
      price: Number(row.open),
      reason: '目标',
      intrabarBothHit: stopHit,
      intrabarPolicy: INTRABAR_POLICY,
      exitPriceSource: 'open-gap-through-target',
    }
  }
  if (gapThroughStop) {
    return {
      price: Number(row.open),
      reason: '失效',
      intrabarBothHit: targetHit,
      intrabarPolicy: INTRABAR_POLICY,
      exitPriceSource: 'open-gap-through-stop',
    }
  }
  if (stopHit) {
    return {
      price: stop,
      reason: '失效',
      intrabarBothHit: targetHit,
      intrabarPolicy: INTRABAR_POLICY,
      exitPriceSource: 'stop-touch',
    }
  }
  if (targetHit) {
    return {
      price: target,
      reason: '目标',
      intrabarBothHit: false,
      intrabarPolicy: INTRABAR_POLICY,
      exitPriceSource: 'target-touch',
    }
  }

  const cutMomentum = Math.max(
    (Number(market?.atrPercent) || 0) * (Number(profile?.cutMomentumAtr) || 0),
    Number(profile?.cutMomentumMin) || 0,
  )
  if (row.close < market.costLow && market.momentumFast < -cutMomentum) {
    return {
      price: row.close,
      reason: '风控',
      intrabarBothHit: false,
      intrabarPolicy: INTRABAR_POLICY,
      exitPriceSource: 'close-risk-rule',
    }
  }
  if (Number.isFinite(plan.expiresAt) && index >= plan.expiresAt) {
    return {
      price: row.close,
      reason: '到期',
      intrabarBothHit: false,
      intrabarPolicy: INTRABAR_POLICY,
      exitPriceSource: 'close-expiry',
    }
  }
  return null
}

export function closeAccountPosition({ row, index, cash, fee, plan, exit }) {
  const sellBase = plan.baseAmount
  const averageCost = plan.investedCost / sellBase
  const proceeds = sellBase * exit.price * (1 - fee)
  return {
    cash: cash + proceeds,
    event: {
      side: 'sell',
      lotId: plan.lotId,
      signalDate: null,
      fillDate: row.date,
      exitDate: row.date,
      exitIndex: index,
      fillPrice: exit.price,
      exitPrice: exit.price,
      targetPrice: plan.targetPrice,
      stopPrice: plan.stopPrice,
      formulaHorizonSessions: plan.formulaHorizonSessions ?? null,
      recoveryFraction: plan.horizonBinding?.recoveryFraction ?? null,
      horizonBinding: plan.horizonBinding ?? null,
      expiresAt: plan.expiresAt ?? null,
      eligibleExitIndex: plan.eligibleExitIndex ?? null,
      sameBarExitPolicy: plan.sameBarExitPolicy ?? null,
      notional: sellBase * exit.price,
      baseAmount: sellBase,
      investedCost: plan.investedCost,
      pnl: proceeds - plan.investedCost,
      returnRate: averageCost > 0 ? (exit.price - averageCost) / averageCost : 0,
      reason: exit.reason,
      intrabarBothHit: exit.intrabarBothHit,
      intrabarPolicy: exit.intrabarPolicy,
      exitPriceSource: exit.exitPriceSource,
      formulaStrategy: formulaStrategySnapshot(plan.formulaStrategy),
    },
  }
}

export function resolveNextSessionLimitFill({ row, index, order, signalIndex }) {
  if (!row || !order || index <= signalIndex) return null
  if (order.side === 'buy' && row.low <= order.price) {
    const price = row.open <= order.price ? row.open : order.price
    return { index, date: row.date, price, priceSource: row.open <= order.price ? 'next-open' : 'limit-touch' }
  }
  if (order.side === 'sell' && row.high >= order.price) {
    const price = row.open >= order.price ? row.open : order.price
    return { index, date: row.date, price, priceSource: row.open >= order.price ? 'next-open' : 'limit-touch' }
  }
  return null
}

export function rebindFormulaHorizonAtFill(order, fill) {
  const binding = order?.horizonBinding
  if (!binding?.eligible || !Number.isFinite(fill?.price) || fill.price <= 0) return null
  if (binding.mode === 'explicit-scenario') {
    return {
      ...order,
      horizonBinding: {
        ...binding,
        cycleStartPrice: fill.price,
        availableAt: `${fill.date}:fill`,
        fillPriceSource: fill.priceSource,
      },
    }
  }
  const expectedSide = order.side === 'buy' ? 'long' : order.side === 'sell' ? 'short' : null
  if (binding.side !== expectedSide || !expectedSide) return null
  const recovery = deriveRecoveryHorizon({
    cycleStartPrice: fill.price,
    anchorPrice: binding.anchorPrice,
    targetPrice: order.targetPrice,
    halfLifeSessions: binding.halfLifeSessions,
    side: binding.side,
    availableAt: `${fill.date}:fill`,
  })
  if (!recovery.eligible) return null
  return {
    ...order,
    formulaHorizonSessions: recovery.modelHorizonSessions,
    horizonBinding: {
      ...binding,
      ...recovery,
      mode: 'formula-derived',
      targetSource: binding.targetSource,
      fillPriceSource: fill.priceSource,
      rederivedAtFill: true,
    },
  }
}

export function applyFill({ pendingOrder, fill, cash, exitPlans, fee, nextPlan = null }) {
  const { order, signalDate } = pendingOrder
  const totals = positionTotals(exitPlans)
  if (order.side === 'buy') {
    const spend = Math.min(order.notional, cash)
    if (spend <= 0 || !nextPlan) return null
    const acquired = (spend * (1 - fee)) / fill.price
    const plannedOrder = {
      ...order,
      targetPrice: nextPlan.targetPrice,
      stopPrice: nextPlan.stopPrice,
      formulaHorizonSessions: nextPlan.formulaHorizonSessions,
      horizonBinding: nextPlan.horizonBinding,
    }
    const nextExitPlans = mergeExitPlan({
      currentPlans: exitPlans,
      addedBase: acquired,
      addedCost: spend,
      nextPlan,
    })
    const nextTotals = positionTotals(nextExitPlans)
    return {
      cash: cash - spend,
      base: nextTotals.base,
      costBasis: nextTotals.costBasis,
      exitPlans: nextExitPlans,
      event: eventRow({
        order: plannedOrder,
        exitPlan: nextExitPlans.at(-1),
        formulaStrategy: pendingOrder.formulaStrategy,
        signalDate,
        signalIndex: pendingOrder.signalIndex,
        fill,
        pnl: 0,
        reason: '建仓',
        notional: spend,
        baseAmount: acquired,
        investedCost: spend,
      }),
    }
  }

  const sellBase = Math.min(totals.base, order.notional / fill.price)
  if (sellBase <= 0) return null
  const reduction = reducePlansProRata(exitPlans, sellBase)
  const proceeds = sellBase * fill.price * (1 - fee)
  const nextTotals = positionTotals(reduction.exitPlans)
  return {
    cash: cash + proceeds,
    base: nextTotals.base,
    costBasis: nextTotals.costBasis,
    exitPlans: reduction.exitPlans,
    event: eventRow({
      order,
      formulaStrategy: pendingOrder.formulaStrategy,
      signalDate,
      signalIndex: pendingOrder.signalIndex,
      fill,
      pnl: proceeds - reduction.removedCost,
      reason: '减仓',
      notional: sellBase * fill.price,
      baseAmount: sellBase,
      investedCost: reduction.removedCost,
    }),
  }
}

function eventRow({
  order,
  exitPlan = null,
  formulaStrategy,
  signalDate,
  signalIndex = null,
  fill,
  pnl,
  reason,
  notional,
  baseAmount,
  investedCost,
}) {
  return {
    side: order.side,
    lotId: exitPlan?.lotId ?? null,
    signalDate,
    signalIndex,
    fillDate: fill.date,
    exitDate: fill.date,
    exitIndex: fill.index,
    fillPrice: fill.price,
    exitPrice: fill.price,
    targetPrice: order.targetPrice,
    stopPrice: order.stopPrice,
    formulaHorizonSessions: order.formulaHorizonSessions,
    recoveryFraction: order.horizonBinding?.recoveryFraction ?? null,
    horizonBinding: order.horizonBinding ?? null,
    fillPriceSource: fill.priceSource ?? null,
    expiresAt:
      exitPlan?.expiresAt ??
      (Number.isFinite(order.formulaHorizonSessions) ? fill.index + order.formulaHorizonSessions : null),
    eligibleExitIndex: exitPlan?.eligibleExitIndex ?? null,
    sameBarExitPolicy: exitPlan?.sameBarExitPolicy ?? null,
    notional,
    baseAmount,
    investedCost,
    pnl,
    returnRate: investedCost > 0 ? pnl / investedCost : 0,
    reason,
    formulaStrategy: formulaStrategySnapshot(formulaStrategy),
  }
}

export function initialExitPlan({ initialBaseNotional, initialPrice, startIndex, states, input }) {
  if (initialBaseNotional <= 0 || initialPrice <= 0) return []
  const market = states[startIndex] ?? null
  const scenarioHorizon = explicitScenarioHorizon(input)
  return [
    {
      lotId: `initial-${startIndex}`,
      baseAmount: initialBaseNotional / initialPrice,
      investedCost: initialBaseNotional,
      entryIndex: startIndex,
      entryDate: null,
      entryPrice: initialPrice,
      targetPrice: initialPrice * (1 + exitTargetReturn(input)),
      stopPrice: finite(market?.costLow) ? market.costLow : null,
      expiresAt: scenarioHorizon ? startIndex + scenarioHorizon : null,
      eligibleExitIndex: startIndex,
      sameBarExitPolicy: 'pre-existing-position-at-replay-start',
      formulaHorizonSessions: scenarioHorizon,
      horizonBinding: null,
      horizonMode: scenarioHorizon ? 'explicit-scenario' : 'missing-input',
      formulaStrategy: null,
    },
  ]
}

export function orderExitPlan({ order, formulaStrategy, fill, input }) {
  const targetByReturn = fill.price * (1 + exitTargetReturn(input))
  return {
    entryIndex: fill.index,
    entryDate: fill.date,
    entryPrice: fill.price,
    targetPrice: Math.max(positive(order.targetPrice) ?? 0, targetByReturn),
    stopPrice: positive(order.stopPrice),
    expiresAt: Number.isFinite(order.formulaHorizonSessions) ? fill.index + order.formulaHorizonSessions : null,
    eligibleExitIndex: fill.index + 1,
    sameBarExitPolicy: SAME_BAR_EXIT_POLICY,
    formulaHorizonSessions: order.formulaHorizonSessions,
    horizonBinding: order.horizonBinding ?? null,
    formulaStrategy: formulaStrategySnapshot(formulaStrategy),
  }
}

export function mergeExitPlan({ currentPlans = [], addedBase, addedCost, nextPlan }) {
  const plans = Array.isArray(currentPlans) ? currentPlans : []
  if (!nextPlan || !(addedBase > 0)) return plans
  return [
    ...plans,
    {
      ...nextPlan,
      lotId: nextPlan.lotId ?? `lot-${nextPlan.entryIndex}-${plans.length}`,
      baseAmount: addedBase,
      investedCost: Math.max(Number(addedCost) || 0, 0),
    },
  ]
}

export function positionTotals(exitPlans) {
  return (exitPlans ?? []).reduce(
    (totals, plan) => ({
      base: totals.base + Math.max(Number(plan.baseAmount) || 0, 0),
      costBasis: totals.costBasis + Math.max(Number(plan.investedCost) || 0, 0),
    }),
    { base: 0, costBasis: 0 },
  )
}

function reducePlansProRata(exitPlans, sellBase) {
  const totals = positionTotals(exitPlans)
  const ratio = totals.base > 0 ? Math.min(sellBase / totals.base, 1) : 0
  let removedCost = 0
  const nextPlans = []
  for (const plan of exitPlans ?? []) {
    const removedBase = plan.baseAmount * ratio
    const removedPlanCost = plan.investedCost * ratio
    const remainingBase = Math.max(0, plan.baseAmount - removedBase)
    const remainingCost = Math.max(0, plan.investedCost - removedPlanCost)
    removedCost += removedPlanCost
    if (remainingBase > 1e-12) {
      nextPlans.push({ ...plan, baseAmount: remainingBase, investedCost: remainingCost })
    }
  }
  return { exitPlans: nextPlans, removedCost }
}

function explicitScenarioHorizon(input) {
  if (input?.pathUsesScenarioInputs !== true && input?.horizonMode !== 'explicit-scenario') return null
  const sessions = positive(input?.formulaHorizonSessions)
  return sessions ? Math.max(1, Math.ceil(sessions)) : null
}

function exitTargetReturn(input) {
  return resolveExitTargetReturn(input)
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
}
