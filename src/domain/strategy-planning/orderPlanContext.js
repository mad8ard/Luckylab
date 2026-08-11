import { getDeltaBands, resolveDeltaSlope, resolveExitTargetReturn } from '../formulas/core.js'
import { formatPrice, pctFmt, positive } from './orderPlanUtils.js'
import { emptyPlan, emptyPosition } from './orderPlanExecution.js'
import { strategyProfiles } from './strategyProfile.js'

export function buildExecutableContext({ market, input }) {
  const entryPrice = positive(input.entryPrice) || market.markPrice
  const formulaHorizonSessions = positive(input.formulaHorizonSessions)
  const iv = positive(input.iv) || positive(market.annualVol)
  const deltaSlope = resolveDeltaSlope(input)
  const exitTargetReturn = resolveExitTargetReturn(input)
  const capital = Math.max(Number(input.capital) || 0, 0)
  const tdpy = positive(input.tradingDaysPerYear)
  const horizonContext = input.formulaHorizonState?.context ?? null
  const horizonMode = horizonContext?.mode ?? input.horizonMode ?? 'formula-derived'
  const formulaHorizonSide = horizonContext?.side ?? (horizonMode === 'explicit-scenario' ? 'scenario-neutral' : null)
  const horizonReason = horizonContext?.reason ?? input.formulaHorizonState?.missingInputs?.[0] ?? null
  const deltaBands =
    formulaHorizonSessions && tdpy
      ? getDeltaBands({ entryPrice, formulaHorizonSessions, iv, deltaSlope, tradingDaysPerYear: tdpy })
      : null

  return {
    inputs: {
      entryPrice,
      formulaHorizonSessions,
      horizonMode,
      formulaHorizonSide,
      horizonAnchorPrice: positive(horizonContext?.anchorPrice),
      horizonTargetPrice: positive(horizonContext?.targetPrice),
      horizonCycleStartPrice: positive(horizonContext?.cycleStartPrice),
      horizonHalfLifeSessions: positive(
        horizonContext?.halfLifeSessions ?? horizonContext?.meanReversion?.halfLifeSessions,
      ),
      horizonTargetSource: horizonContext?.targetSource ?? null,
      horizonAvailableAt: horizonContext?.availableAt ?? null,
      horizonExecutionAuthority: horizonContext?.executionAuthority ?? 'none',
      horizonStatus: horizonContext?.status ?? input.formulaHorizonState?.status ?? null,
      horizonReason,
      modelVersion: typeof input.modelVersion === 'string' ? input.modelVersion : null,
      dynamicHoldingGate: input.dynamicHoldingGate ?? null,
      iv,
      deltaSlope,
      exitTargetReturn,
      capital,
      costAnchor: market.costAnchor,
      tradingDaysPerYear: tdpy,
    },
    deltaBands,
  }
}

export function buildDecision({ market, timing, diagnosticTiming, position, formulaHorizonSessions }) {
  const hasDirectionalThesis = Boolean(timing?.side)
  const invalidations = hasDirectionalThesis
    ? [
        `收盘价越过失效线 ${formatPrice(position.stopPrice)}`,
        `目标价 ${formatPrice(position.targetPrice)}`,
        Number.isFinite(formulaHorizonSessions)
          ? `${formulaHorizonSessions} 个交易会话后未触发则到期`
          : '等待执行方向绑定的公式周期',
      ]
    : []
  const reviewConditions = hasDirectionalThesis
    ? []
    : [
        `收盘价跌破届时成本下沿（当前 ${formatPrice(market.costLow)}，逐 K 线重算）`,
        `收盘价突破届时成本上沿（当前 ${formatPrice(market.costHigh)}，逐 K 线重算）`,
        `成本锚、结构目标或 AR 门禁发生变化`,
        `偏离阈值参考 ${pctFmt(Math.max(market.atrPercent * 1.5, 0.015))}`,
      ]
  return {
    state: timing?.state ?? '等待',
    path: timing?.path ?? '等待路径',
    timing,
    diagnosticTiming: diagnosticTiming ?? timing ?? null,
    position,
    signalStrength: timing?.signalStrength ?? 0,
    signalSemantics: timing?.signalSemantics ?? 'normal-reference-extremeness-not-confidence-or-win-probability',
    executionStatus: position?.executionStatus ?? 'blocked',
    candidateStatus: timing?.candidateStatus ?? '等待',
    holdingWindow: !hasDirectionalThesis
      ? Number.isFinite(formulaHorizonSessions)
        ? `无执行方向；研究周期 ${formulaHorizonSessions} 个交易会话（公式推导）`
        : '当前无执行方向；研究周期待公式推导'
      : Number.isFinite(formulaHorizonSessions)
        ? `${formulaHorizonSessions} 个交易会话（执行方向/目标绑定）`
        : '执行方向周期待公式推导',
    invalidations,
    reviewConditions,
    regime: timing?.regime ?? null,
    triggeredConditions: timing?.triggeredConditions ?? [],
    blockedReasons: timing?.blockedReasons ?? [],
    missingInputs: [...new Set([...(timing?.missingInputs ?? []), ...(position?.missingInputs ?? [])])],
  }
}

export function buildAccount({ account, input, markPrice }) {
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
    formulaHorizonSessions: positive(input.formulaHorizonSessions),
    isConfigured: Boolean(account) || hasCapitalInput || hasBaseInput,
  }
}

export function emptyGraph() {
  return {
    inputs: null,
    deltaBands: null,
    dynamicHolding: null,
    profile: strategyProfiles.balanced,
    account: null,
    position: emptyPosition(null),
    decision: null,
    plan: emptyPlan(),
  }
}
