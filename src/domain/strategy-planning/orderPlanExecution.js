import { deriveRecoveryHorizon, resolveExitTargetReturn } from '../formulas/core.js'
import { bindPositionHorizon } from './orderPlanHorizonBinding.js'
import { ensureExecutableProfile } from './orderPlanProfile.js'
import { fmt, pctFmt } from './orderPlanUtils.js'

const LADDER_WEIGHTS = [0.2, 0.3, 0.5]

export function buildPositionPlan(timing, bands, account, profile, market, executableInputs = {}) {
  const executableProfile = ensureExecutableProfile(profile, market)
  if (!timing?.side) return emptyPosition(timing, account)
  if (!account.isConfigured) {
    return {
      ...emptyPosition(timing, account),
      action: '缺少账户输入',
      missingInputs: ['account.capital'],
      rule: '缺少账户资金输入，模拟挂单不生成名义金额。',
    }
  }
  if (timing.side === 'buy' && account.cash <= 0) {
    return {
      ...emptyPosition(timing, account),
      action: '缺少账户资金',
      missingInputs: ['account.capital'],
      rule: '缺少可用现金，模拟挂单不生成买入单。',
    }
  }
  if (timing.side === 'sell' && account.base <= 0) {
    return {
      ...emptyPosition(timing, account),
      missingInputs: ['account.basePosition'],
      action: '缺少底仓',
      rule: '缺少底仓输入，模拟挂单不生成卖出单。',
    }
  }
  const stopDistance = Math.max(Math.abs(market.markPrice - timing.stop) / market.markPrice, 0.001)
  const signalStrength = timing.signalStrength ?? 0
  const sizingCapital = Math.max(account.equity ?? account.capital ?? 0, 0)
  const riskBudgetPct =
    executableProfile.riskMin + (executableProfile.riskMax - executableProfile.riskMin) * signalStrength
  const riskBudget = sizingCapital * riskBudgetPct
  const exposureCap =
    sizingCapital *
    (executableProfile.exposureMin + (executableProfile.exposureMax - executableProfile.exposureMin) * signalStrength)
  const buyCap = Math.min(account.cash, exposureCap, riskBudget / stopDistance)
  const sellCap = Math.min(account.base * market.markPrice, exposureCap)
  const maxNotional = timing.side === 'buy' ? buyCap : sellCap
  const addToPrice = timing.side === 'buy' ? (bands?.long.low ?? timing.stop) : (bands?.short.high ?? timing.stop)
  const exitTargetReturn = resolveExitTargetReturn(executableInputs)
  const targetByReturn = market.markPrice * (1 + exitTargetReturn)
  const plannedTarget = timing.side === 'buy' ? Math.max(timing.target, targetByReturn) : timing.target
  const horizonBinding = bindPositionHorizon({
    side: timing.side,
    targetPrice: plannedTarget,
    market,
    inputs: executableInputs,
  })
  if (!horizonBinding?.eligible) {
    return {
      ...emptyPosition(timing, account),
      action: '周期与目标不匹配',
      missingInputs: [horizonBinding?.reason ?? 'side-target-horizon-binding'],
      rule: '目标价、方向、冻结成本锚与周期未形成同一公式绑定，模拟挂单保持关闭。',
    }
  }
  return {
    action: timing.action,
    side: timing.side,
    maxNotional,
    firstNotional: maxNotional * executableProfile.firstWeight,
    reserveCash: Math.max(0, account.cash - (timing.side === 'buy' ? maxNotional : 0)),
    riskBudget,
    riskBudgetPct,
    stopDistance,
    stopPrice: timing.stop,
    targetPrice: plannedTarget,
    referenceTargetPrice: timing.target,
    exitTargetReturn,
    addToPrice,
    formulaHorizonSessions: horizonBinding.modelHorizonSessions,
    horizonBinding,
    executionStatus: 'simulation-only',
    sizingBasis: 'profile-scaled-by-normal-reference-extremeness',
    rule:
      timing.side === 'buy'
        ? `账户资金已配置；模拟挂单使用 ${pctFmt(executableProfile.firstWeight)} 首笔权重和失效线 ${fmt(timing.stop)}。`
        : `底仓已配置；模拟挂单使用独立 short-side 结构目标 ${fmt(timing.target)} 作为减仓观察价。`,
    missingInputs: [],
  }
}

export function buildExecutionPlan(position, bands, account, market) {
  if (!position?.side || position.maxNotional <= 0 || !bands) return emptyPlan()
  const prices =
    position.side === 'buy'
      ? uniqueSorted([market.markPrice, (market.markPrice + position.addToPrice) / 2, position.addToPrice], 'desc')
      : uniqueSorted([market.markPrice, (market.markPrice + position.addToPrice) / 2, position.addToPrice], 'asc')
  const primaryOrders = prices
    .map((price, index) =>
      orderRow({
        side: position.side,
        price,
        targetPrice: position.targetPrice,
        exitTargetReturn: position.exitTargetReturn,
        stopPrice: position.stopPrice,
        horizonBinding: position.horizonBinding,
        notional: position.maxNotional * LADDER_WEIGHTS[index],
        role: orderRole(position.side, index),
        reason: position.rule,
      }),
    )
    .filter(Boolean)
  return {
    buyOrders: position.side === 'buy' ? primaryOrders : [],
    sellOrders: position.side === 'sell' ? primaryOrders : [],
    primaryOrders,
    executionStatus: 'simulation-only',
    sizingBasis: position.sizingBasis,
    invalidation: {
      lower: position.side === 'buy' ? position.stopPrice : market.costLow,
      upper: position.side === 'sell' ? position.stopPrice : market.costHigh,
    },
  }
}

export function emptyPosition(timing, account = {}) {
  return {
    action: timing?.action ?? '未触发',
    side: timing?.side ?? null,
    maxNotional: null,
    firstNotional: null,
    reserveCash: Math.max(Number(account.cash ?? account.capital) || 0, 0),
    riskBudget: null,
    riskBudgetPct: null,
    stopDistance: null,
    stopPrice: timing?.stop ?? null,
    targetPrice: timing?.target ?? null,
    exitTargetReturn: null,
    formulaHorizonSessions: null,
    horizonBinding: null,
    addToPrice: null,
    executionStatus: 'blocked',
    sizingBasis: null,
    rule: timing?.reason ?? '信号条件未触发。',
    missingInputs: [],
  }
}

export function emptyPlan() {
  return {
    buyOrders: [],
    sellOrders: [],
    primaryOrders: [],
    executionStatus: 'blocked',
    sizingBasis: null,
    invalidation: { lower: null, upper: null },
  }
}

function orderRow({ side, price, targetPrice, exitTargetReturn, stopPrice, horizonBinding, notional, role, reason }) {
  const amount = price > 0 ? notional / price : 0
  const executionTarget = orderTargetPrice({ side, price, targetPrice, exitTargetReturn })
  const orderHorizonBinding = bindLimitOrderHorizon({
    side,
    limitPrice: price,
    targetPrice: executionTarget,
    binding: horizonBinding,
  })
  if (!orderHorizonBinding?.eligible) return null
  const expectedProfit = side === 'buy' ? (executionTarget - price) * amount : (price - executionTarget) * amount
  return {
    side,
    price,
    targetPrice: executionTarget,
    referenceTargetPrice: targetPrice,
    exitTargetReturn,
    stopPrice,
    formulaHorizonSessions: orderHorizonBinding.modelHorizonSessions,
    horizonBinding: orderHorizonBinding,
    notional,
    amount,
    expectedProfit,
    role,
    reason,
    executionStatus: 'simulation-only',
  }
}

function bindLimitOrderHorizon({ side, limitPrice, targetPrice, binding }) {
  if (!binding?.eligible) return null
  if (binding.mode === 'explicit-scenario') {
    return {
      ...binding,
      cycleStartPrice: limitPrice,
      targetPrice,
      targetSource: 'explicit-scenario-limit-order-target',
      rederivedForLimitScenario: false,
    }
  }
  const expectedSide = side === 'buy' ? 'long' : side === 'sell' ? 'short' : null
  if (!expectedSide || binding.side !== expectedSide) return null
  const recovery = deriveRecoveryHorizon({
    cycleStartPrice: limitPrice,
    anchorPrice: binding.anchorPrice,
    targetPrice,
    halfLifeSessions: binding.halfLifeSessions,
    side: expectedSide,
    availableAt: binding.availableAt,
  })
  if (!recovery.eligible) return recovery
  return {
    ...binding,
    ...recovery,
    mode: 'formula-derived',
    targetSource:
      Math.abs(targetPrice - binding.targetPrice) <= Math.max(targetPrice, 1) * 1e-12
        ? binding.targetSource
        : 'limit-order-exit-target-within-frozen-anchor',
    rederivedForLimitScenario: true,
    executionAuthority: 'none',
  }
}

function orderTargetPrice({ side, price, targetPrice, exitTargetReturn }) {
  const fallback = Number.isFinite(targetPrice) ? targetPrice : price
  if (!Number.isFinite(price) || price <= 0) return fallback
  const pct = Math.max(Number(exitTargetReturn) || 0, 0)
  if (side === 'buy') return Math.max(fallback, price * (1 + pct))
  if (side === 'sell') return fallback
  return fallback
}

function orderRole(side, index) {
  return side === 'sell' ? `模拟卖出 ${index + 1}` : `模拟买入 ${index + 1}`
}

function uniqueSorted(values, direction) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => (direction === 'desc' ? b - a : a - b))
  return sorted.filter((value, index) => index === 0 || Math.abs(value - sorted[index - 1]) > 1e-9)
}
