import { deviationScore, getDeltaBands, resolveDeltaSlope, resolveExitTargetReturn } from '../formulas/core.js'
import { buildFormulaStrategyComposition } from './formulaStrategy.js'
import {
  resolveExecutableProfile,
  resolveProfile,
  scaleProfileToMarket,
  strategyProfileList,
  strategyProfiles,
} from './strategyProfile.js'

const LADDER_WEIGHTS = [0.2, 0.3, 0.5]

export {
  resolveExecutableProfile,
  resolveProfile,
  scaleProfileToMarket,
  strategyProfileList,
  strategyProfiles,
}

export function buildDecisionGraph({ market, input, account }) {
  if (!market) return emptyGraph()
  const executable = buildExecutableContext({ market, input })
  const profile = resolveExecutableProfile(input?.strategyProfile, market, input)
  const nextAccount = buildAccount({ account, input, markPrice: market.markPrice })
  const timing = buildEntryTiming(market, executable.deltaBands, profile, executable.inputs)
  const position = buildPositionPlan(timing, executable.deltaBands, nextAccount, profile, market, executable.inputs)
  const plan = buildExecutionPlan(position, executable.deltaBands, nextAccount, market)
  const formulaStrategy = buildFormulaStrategyComposition({ market, executable, timing, position, plan, account: nextAccount })

  return {
    ...executable,
    formulaStrategy,
    profile,
    account: nextAccount,
    position,
    decision: buildDecision({ market, timing, position, holdingDays: executable.inputs.holdingDays }),
    plan,
  }
}

export function buildEntryTiming(market, bands, profile = strategyProfiles.balanced, inputs = {}) {
  const executableProfile = ensureExecutableProfile(profile, market)
  const atr = market.atrPercent || 0
  const deviation = deviationScore({
    costDistance: market.costDistance,
    annualVol: market.annualVol,
    holdingDays: inputs.holdingDays || 1,
    tradingDaysPerYear: inputs.tradingDaysPerYear || 365,
  })
  const periodVol = deviation?.periodVol ?? (market.annualVol > 0 ? market.annualVol * Math.sqrt(1 / 365) : 0.01)
  const zScore = deviation?.z ?? (periodVol > 0 ? market.costDistance / periodVol : 0)
  const zAbs = Math.abs(zScore)

  const signalStrength = clamp(zAbs < 8 ? 1 - 2 * (1 - (0.5 + 0.5 * erfApprox(zAbs / Math.sqrt(2)))) : 1, 0, 1)

  // Dynamic edge: actual distance from cost, normalized by ATR
  const minEdge = Math.max(atr * executableProfile.edgeAtr, executableProfile.minEdge)
  const buyEdge = market.costAnchor > market.markPrice ? (market.costAnchor - market.markPrice) / market.markPrice : 0
  const sellEdge = market.markPrice > market.costAnchor ? (market.markPrice - market.costAnchor) / market.markPrice : 0

  const belowCost = market.markPrice < market.costLow
  const aboveCost = market.markPrice > market.costHigh
  const insideLongBand = !bands || market.markPrice >= bands.long.low
  const insideShortBand = !bands || market.markPrice <= bands.short.high
  const costStillFalling = market.costSlope5 < -Math.max(atr * executableProfile.costSlopeAtr, executableProfile.costSlopeMin)
  const momentumRising = market.momentum5 > executableProfile.momentumMin

  const regimeLabel = belowCost ? '折价区' : aboveCost ? '溢价区' : '成本回归区'
  const zLabel = zAbs < 0.5 ? '弱' : zAbs < 1.5 ? '中' : '强'
  const momThresh = Math.max(atr * 0.5, 0.005)
  const momentumLabel = market.momentum5 > momThresh ? '↑' : market.momentum5 < -momThresh ? '↓' : '→'
  const slopeThresh = Math.max(atr * 0.2, 0.002)
  const costTrendLabel = market.costSlope5 < -slopeThresh ? '↓降' : market.costSlope5 > slopeThresh ? '↑升' : '→平'

  const confHigh = Math.max(0.6, 1 - atr * 12)
  const confMid = Math.max(0.3, 1 - atr * 24)
  const baseFacts = {
    regime: regimeLabel,
    zScore,
    zStrength: zLabel,
    costDistance: market.costDistance,
    signalStrength,
    triggeredConditions: [],
    blockedReasons: [],
    missingInputs: [],
  }

  function buildReason() {
    const parts = [`${regimeLabel} · Z=${zScore.toFixed(2)}σ · ${zLabel}`, `动量 ${momentumLabel}`, `成本 ${costTrendLabel}`]
    if (belowCost && momentumRising && !costStillFalling) parts.push('动量止跌条件满足')
    if (belowCost && (costStillFalling || !momentumRising)) parts.push('止跌条件未满足')
    if (aboveCost) parts.push('处于成本带上方')
    return parts.join(' · ')
  }

  if (belowCost && !insideLongBand) {
    return waitTiming({
      state: '低于波动带',
      reason: `价格 ${fmt(market.markPrice)} 低于波动带下沿 ${fmt(bands?.long?.low)}。`,
      facts: withFacts(baseFacts, {
        triggeredConditions: ['价格低于成本带', '价格低于 GetDelta 下沿'],
        blockedReasons: ['超出当前默认入场带，需要额外风控输入'],
      }),
    })
  }
  if (belowCost && (costStillFalling || !momentumRising)) {
    return waitTiming({
      state: '低于成本带',
      reason: `价格低于成本带 ${pctFmt(Math.abs(market.costDistance))}，但止跌条件未同时满足。`,
      facts: withFacts(baseFacts, {
        triggeredConditions: ['价格低于成本带'],
        blockedReasons: [
          costStillFalling ? '成本锚仍在下降' : null,
          !momentumRising ? '5 日动量未越过策略档位阈值' : null,
        ].filter(Boolean),
      }),
    })
  }
  if (belowCost && buyEdge >= minEdge) {
    return activeTiming({
      state: '低于成本带',
      side: 'buy',
      action: signalStrength > confHigh ? '条件满足' : signalStrength > confMid ? '条件部分满足' : '条件观察',
      reason: buildReason(),
      signalStrength,
      edge: buyEdge,
      stop: Math.min(market.costLow, bands?.long.low ?? market.costLow),
      target: market.costAnchor,
      ...withFacts(baseFacts, {
        triggeredConditions: ['价格低于成本带', '成本未继续下行', '5 日动量满足策略档位阈值', '折价幅度达到策略档位阈值'],
      }),
    })
  }
  if (aboveCost && !insideShortBand) {
    return waitTiming({
      state: '高于波动带',
      reason: `价格 ${fmt(market.markPrice)} 高于波动带上沿 ${fmt(bands?.short?.high)}。`,
      facts: withFacts(baseFacts, {
        triggeredConditions: ['价格高于成本带', '价格高于 GetDelta 上沿'],
        blockedReasons: ['模拟挂单不把研究层或高位状态翻译成追价动作'],
      }),
    })
  }
  if (aboveCost && sellEdge >= minEdge) {
    return activeTiming({
      state: '高于成本带',
      side: 'sell',
      action: signalStrength > confHigh ? '条件满足' : '条件部分满足',
      reason: buildReason(),
      signalStrength,
      edge: sellEdge,
      stop: Math.max(market.costHigh, bands?.short.high ?? market.costHigh),
      target: market.costAnchor,
      ...withFacts(baseFacts, {
        triggeredConditions: ['价格高于成本带', '溢价幅度达到策略档位阈值'],
      }),
    })
  }
  if (zAbs < 0.5) {
    return waitTiming({
      state: '成本带内',
      reason: `偏离 ${zScore.toFixed(2)}σ，未达到信号条件。`,
      facts: withFacts(baseFacts, { blockedReasons: ['偏离幅度低于 0.5σ'] }),
    })
  }
  return waitTiming({
    state: regimeLabel,
    reason: `${regimeLabel} · 偏离 ${pctFmt(market.costDistance)} · 未达到信号条件`,
    facts: withFacts(baseFacts, { blockedReasons: ['价格位置或动量条件未同时满足'] }),
  })
}

function erfApprox(x) {
  const sign = x < 0 ? -1 : 1; const z = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * z)
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429]
  const poly = ((((a[4] * t + a[3]) * t + a[2]) * t + a[1]) * t + a[0]) * t
  return sign * (1 - poly * Math.exp(-z * z))
}

function pctFmt(v) { return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—' }
function fmt(v) { return Number.isFinite(v) ? Math.round(v).toLocaleString('zh-CN') : '—' }

export function buildPositionPlan(timing, bands, account, profile, market, executableInputs = {}) {
  const executableProfile = ensureExecutableProfile(profile, market)
  if (!account.isConfigured) {
    return {
      ...emptyPosition(timing, account),
      action: '缺少账户输入',
      missingInputs: ['account.capital'],
      rule: '缺少账户资金输入，模拟挂单不生成名义金额。',
    }
  }
  if (!timing?.side) return emptyPosition(timing, account)
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
  const riskBudgetPct = executableProfile.riskMin + (executableProfile.riskMax - executableProfile.riskMin) * signalStrength
  const riskBudget = sizingCapital * riskBudgetPct
  const exposureCap = sizingCapital * (executableProfile.exposureMin + (executableProfile.exposureMax - executableProfile.exposureMin) * signalStrength)
  const buyCap = Math.min(account.cash, exposureCap, riskBudget / stopDistance)
  const sellCap = Math.min(account.base * market.markPrice, exposureCap)
  const maxNotional = timing.side === 'buy' ? buyCap : sellCap
  const addToPrice = timing.side === 'buy' ? (bands?.long.low ?? timing.stop) : (bands?.short.high ?? timing.stop)
  const exitTargetReturn = resolveExitTargetReturn(executableInputs)
  const targetByReturn = market.markPrice * (1 + exitTargetReturn)
  const plannedTarget = timing.side === 'buy' ? Math.max(timing.target, targetByReturn) : timing.target
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
    targetReturn: exitTargetReturn,
    exitTargetReturn,
    addToPrice,
    holdDays: account.holdingDays,
    rule: timing.side === 'buy'
      ? `账户资金已配置；模拟挂单使用 ${pctFmt(executableProfile.firstWeight)} 首笔权重和失效线 ${fmt(timing.stop)}。`
      : `底仓已配置；模拟挂单使用成本锚 ${fmt(timing.target)} 作为减仓观察价。`,
    missingInputs: [],
  }
}

export function buildExecutionPlan(position, bands, account, market) {
  if (!position?.side || position.maxNotional <= 0 || !bands) return emptyPlan()
  const prices = position.side === 'buy'
    ? uniqueSorted([market.markPrice, (market.markPrice + position.addToPrice) / 2, position.addToPrice], 'desc')
    : uniqueSorted([market.markPrice, (market.markPrice + position.addToPrice) / 2, position.addToPrice], 'asc')
  const primaryOrders = prices.map((price, index) => orderRow({
    side: position.side,
    price,
    targetPrice: position.targetPrice,
    targetReturn: position.targetReturn,
    stopPrice: position.stopPrice,
    holdDays: position.holdDays,
    notional: position.maxNotional * LADDER_WEIGHTS[index],
    role: orderRole(position.side, index),
    reason: position.rule,
  }))
  return {
    buyOrders: position.side === 'buy' ? primaryOrders : [],
    sellOrders: position.side === 'sell' ? primaryOrders : [],
    primaryOrders,
    invalidation: {
      lower: position.side === 'buy' ? position.stopPrice : market.costLow,
      upper: position.side === 'sell' ? position.stopPrice : market.costHigh,
    },
  }
}

function ensureExecutableProfile(profile, market) {
  if (Number.isFinite(profile?.minEdge) && Number.isFinite(profile?.riskMin)) return profile
  return scaleProfileToMarket(profile ?? strategyProfiles.balanced, market)
}

function buildExecutableContext({ market, input }) {
  const entryPrice = positive(input.entryPrice) || market.markPrice
  const holdingDays = Math.max(Number(input.holdingDays) || 1, 1)
  const iv = Math.max(Number(input.iv) || market.annualVol || 0.01, 0.01)
  const deltaSlope = resolveDeltaSlope(input)
  const exitTargetReturn = resolveExitTargetReturn(input)
  const capital = Math.max(Number(input.capital) || 0, 0)
  const tdpy = Number(input.tradingDaysPerYear) || 365
  const deltaBands = getDeltaBands({ entryPrice, holdingDays, iv, targetReturn: deltaSlope, tradingDaysPerYear: tdpy })

  return {
    inputs: { entryPrice, holdingDays, iv, deltaSlope, exitTargetReturn, targetReturn: deltaSlope, capital, costAnchor: market.costAnchor, tradingDaysPerYear: tdpy },
    deltaBands,
  }
}

function buildDecision({ market, timing, position, holdingDays }) {
  const invalidations = timing?.side
    ? [`收盘价越过失效线 ${formatPrice(position.stopPrice)}`, `目标价 ${formatPrice(position.targetPrice)}`, `${holdingDays} 天后未触发则到期`]
    : [`价格低于成本下沿 ${formatPrice(market.costLow)}`, `价格高于成本上沿 ${formatPrice(market.costHigh)}`, `偏离阈值参考 ${pctFmt(Math.max(market.atrPercent * 1.5, 0.015))}`]
  return {
    state: timing?.state ?? '等待',
    path: timing?.path ?? '等待路径',
    timing,
    position,
    signalStrength: timing?.signalStrength ?? 0,
    holdingWindow: `${holdingDays} 天`,
    invalidations,
    regime: timing?.regime ?? null,
    triggeredConditions: timing?.triggeredConditions ?? [],
    blockedReasons: timing?.blockedReasons ?? [],
    missingInputs: [...new Set([...(timing?.missingInputs ?? []), ...(position?.missingInputs ?? [])])],
  }
}

function buildAccount({ account, input, markPrice }) {
  const rawCapital = Number(input.capital)
  const hasCapitalInput = Number.isFinite(rawCapital) && rawCapital > 0
  const capital = hasCapitalInput ? rawCapital : 0
  const baseNotional = Math.max(Number(input.baseNotional) || 0, 0)
  const hasBaseInput = baseNotional > 0
  const base = account?.base ?? (markPrice > 0 ? baseNotional / markPrice : 0)
  const cash = account?.cash ?? capital
  const equity = Math.max(cash + base * markPrice, 0)
  return {
    cash,
    base,
    costBasis: account?.costBasis ?? baseNotional,
    capital,
    equity,
    holdingDays: Math.max(Number(input.holdingDays) || 1, 1),
    isConfigured: Boolean(account) || hasCapitalInput || hasBaseInput,
  }
}

function activeTiming(timing) {
  return { ...timing, path: timing.side === 'buy' ? '低于成本带条件链' : '高于成本带条件链' }
}

function waitTiming({ state, reason, facts }) {
  return { state, side: null, action: '未触发', path: '信号条件未触发', edge: 0, stop: null, target: null, reason, ...facts }
}

function orderRow({ side, price, targetPrice, targetReturn, stopPrice, holdDays, notional, role, reason }) {
  const amount = price > 0 ? notional / price : 0
  const executionTarget = orderTargetPrice({ side, price, targetPrice, targetReturn })
  const expectedProfit = side === 'buy' ? (executionTarget - price) * amount : (price - executionTarget) * amount
  return { side, price, targetPrice: executionTarget, referenceTargetPrice: targetPrice, targetReturn, stopPrice, holdDays, notional, amount, expectedProfit, role, reason }
}

function orderTargetPrice({ side, price, targetPrice, targetReturn }) {
  const fallback = Number.isFinite(targetPrice) ? targetPrice : price
  if (!Number.isFinite(price) || price <= 0) return fallback
  const pct = Math.max(Number(targetReturn) || 0, 0)
  if (side === 'buy') return Math.max(fallback, price * (1 + pct))
  if (side === 'sell') return fallback
  return fallback
}

function orderRole(side, index) {
  return side === 'sell' ? `模拟卖出 ${index + 1}` : `模拟买入 ${index + 1}`
}

function emptyPosition(timing, account = {}) {
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
    targetReturn: null,
    addToPrice: null,
    rule: timing?.reason ?? '信号条件未触发。',
    missingInputs: [],
  }
}

function emptyPlan() {
  return { buyOrders: [], sellOrders: [], primaryOrders: [], invalidation: { lower: null, upper: null } }
}

function emptyGraph() {
  return {
    inputs: null,
    deltaBands: null,
    profile: strategyProfiles.balanced,
    account: null,
    position: emptyPosition(null),
    decision: null,
    plan: emptyPlan(),
  }
}

function uniqueSorted(values, direction) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => direction === 'desc' ? b - a : a - b)
  return sorted.filter((value, index) => index === 0 || Math.abs(value - sorted[index - 1]) > 1e-9)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function formatPrice(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('zh-CN') : '未知'
}

function withFacts(baseFacts, patch = {}) {
  return {
    ...baseFacts,
    ...patch,
    triggeredConditions: patch.triggeredConditions ?? baseFacts.triggeredConditions,
    blockedReasons: patch.blockedReasons ?? baseFacts.blockedReasons,
    missingInputs: patch.missingInputs ?? baseFacts.missingInputs,
  }
}
