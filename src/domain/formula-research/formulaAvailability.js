import { meanReversionHalfLife } from '../formulas/core.js'
import { formulaStages } from '../formulas/registry.js'
import { formatFormulaInputList, formatFormulaInputToken, formatFormulaReasonList } from './formulaInputLabels.js'

export {
  formatFormulaBlockReason,
  formatFormulaInputList,
  formatFormulaInputToken,
  formatFormulaReasonList,
} from './formulaInputLabels.js'
export { getFormulaStageRelations } from './formulaRelations.js'
export { buildOrderPlanReviewPresentation } from './formulaPresentation.js'
export { resolveDisplayedDeltaBand } from './formulaDeltaDisplay.js'

const STATUS_META = Object.freeze({
  viewable: {
    label: '可查看',
    tone: 'viewable',
    boundary: '当前输入足够生成研究视图；不代表可执行。',
  },
  'missing-input': {
    label: '待输入',
    tone: 'missing',
    boundary: '当前输入不足，不得用静态公式说明代替本次计算。',
  },
  'not-applicable': {
    label: '当前结构不适用',
    tone: 'not-applicable',
    boundary: '当前结构没有合法的前向目标；这不是要求手工填一个固定周期。',
  },
  'model-gate-failed': {
    label: '门禁未通过',
    tone: 'gate-failed',
    boundary: '当前样本未通过模型门禁；不得用经验周期替代。',
  },
  'research-only': {
    label: '仅研究',
    tone: 'research',
    boundary: '仅用于研究对照，不进入默认模拟挂单。',
  },
  'proxy-only': {
    label: '代理',
    tone: 'proxy',
    boundary: '只是条件代理；缺真实制度、路径或结算数据时不作执行结论。',
  },
  'protocol-unverified': {
    label: '未验证',
    tone: 'unverified',
    boundary: '协议口径或机制尚未验证，不作交易判断。',
  },
})

const IMPLEMENTATION_TO_STATE = Object.freeze({
  implemented: 'viewable',
  'research-only': 'research-only',
  'proxy-only': 'proxy-only',
  'protocol-unverified': 'protocol-unverified',
})

const STAGE_ACTIONS = Object.freeze({
  'delta-band': '先让方向、前向结构目标、成本锚与 AR 半衰期形成有限周期，再生成同周期 GetDelta 带。',
  'option-greeks': '填写独立的期权到期交易会话；不得复用持仓修复周期。',
  'asian-option': '先填写独立期权到期周期和波动口径，再比较 Asian / Bachelier 研究曲线。',
  funding: '补充永续/现货 TWAP、结算会话时长与同周期口径；完成后仍只是代理。',
  portfolio: '补齐期权权利金、LP 入场/标记、路径费用与资金结算，并统一币种、名义本金和期限。',
  'order-plan': '先补齐当前决策门禁的缺失输入；即使生成结果也仍是模拟挂单。',
  'risk-surface': '先生成 GetDelta 带，再填写独立期权到期周期。',
  'net-lp-efficiency': '补充同本金、同期限的路径手续费和 IL；CE 几何倍数不能直接与收益相加。',
  'net-carry': '补充真实资金费结算、持仓方向和共同名义本金/时间基。',
  'mean-reversion': '先积累至少 5 个可见会话的成本偏离序列。',
  'dynamic-holding-state': '等待单调 AR 衰减、前向结构目标和有限公式周期同时成立。',
  'gamma-pnl': '先补充独立期权周期并生成 Gamma，再指定价格变动与名义口径。',
  'vol-confidence': '先积累至少 5 个有效会话并生成历史已实现波动率。',
})

const AVAILABILITY_RULES = Object.freeze({
  path: (ctx) => (ctx.activeRows.length ? [] : ['ohlcv-history']),
  cost: (ctx) =>
    compact([
      finite(ctx.market?.markPrice) ? null : 'mark-price',
      finite(ctx.market?.costAnchor) ? null : 'cost-anchor',
      [ctx.market?.costLow, ctx.market?.costHigh].every(finite) ? null : 'cost-band',
    ]),
  volatility: (ctx) =>
    compact([
      positive(ctx.market?.annualVol) ? null : 'realized-volatility',
      finite(ctx.market?.atrPercent) ? null : 'atr-percent',
      positive(ctx.graph?.inputs?.tradingDaysPerYear) ? null : 'trading-days-per-year',
    ]),
  'delta-band': deltaBandMissing,
  'option-greeks': optionMissing,
  'asian-option': asianMissing,
  'lp-inventory': lpInventoryMissing,
  'liquidity-fingerprint': (ctx) =>
    ctx.graph?.liquidityFingerprint?.prices?.length
      ? []
      : compact([
          positive(ctx.market?.markPrice ?? ctx.graph?.inputs?.entryPrice) ? null : 'mark-price',
          positive(ctx.market?.annualVol ?? ctx.graph?.inputs?.iv) ? null : 'realized-volatility',
          positive(ctx.graph?.inputs?.tradingDaysPerYear) ? null : 'trading-days-per-year',
          'liquidity-fingerprint-output',
        ]),
  'lp-pool-coverage': lpPoolCoverageMissing,
  'amm-geometry': (ctx) => (positive(ctx.market?.markPrice ?? ctx.graph?.inputs?.entryPrice) ? [] : ['mark-price']),
  'capital-efficiency': lpCapitalEfficiencyMissing,
  funding: fundingMissing,
  portfolio: portfolioMissing,
  'order-plan': orderPlanMissing,
  'deviation-score': deviationMissing,
  'risk-surface': riskSurfaceMissing,
  'net-lp-efficiency': netLpMissing,
  'net-carry': netCarryMissing,
  'mean-reversion': (ctx) => (ctx.meanReversion ? [] : ['cost-distance-series']),
  'dynamic-holding-state': dynamicHoldingMissing,
  'gamma-pnl': gammaMissing,
  'vol-confidence': (ctx) =>
    compact([
      positive(ctx.market?.annualVol ?? ctx.graph?.inputs?.iv) ? null : 'realized-volatility',
      ctx.activeRows.length >= 5 ? null : 'volatility-sample-size',
    ]),
})

export function buildFormulaAvailabilityMap(context = {}) {
  const ctx = normalizeContext(context)
  return Object.fromEntries(formulaStages.map((stage) => [stage.id, resolveStageAvailability(stage, ctx)]))
}

export function getFormulaAvailability(formulaId, context = {}) {
  const stage = formulaStages.find((item) => item.id === formulaId)
  if (!stage) return unknownFormulaAvailability(formulaId)
  return resolveStageAvailability(stage, normalizeContext(context))
}

function resolveStageAvailability(stage, ctx) {
  const rule = AVAILABILITY_RULES[stage.id]
  const result = normalizeRuleResult(rule ? rule(ctx) : ['current-formula-output'])
  const missingInputs = unique(result.missingInputs)
  const blockedReasons = unique(result.blockedReasons)
  const state =
    result.state ??
    (missingInputs.length ? 'missing-input' : (IMPLEMENTATION_TO_STATE[stage.status] ?? 'missing-input'))
  const meta = STATUS_META[state]
  return {
    id: stage.id,
    state,
    label: meta.label,
    tone: meta.tone,
    canRender: !['missing-input', 'not-applicable', 'model-gate-failed'].includes(state),
    implementationStatus: stage.status,
    missingInputs,
    missingInputLabels: missingInputs.map(formatFormulaInputToken),
    missingText: formatFormulaInputList(missingInputs),
    blockedReasons,
    blockedReasonLabels: blockedReasons.map((reason) => formatFormulaReasonList([reason])),
    reasonText: formatFormulaReasonList(blockedReasons),
    nextStep: nextStep(stage.id, state, missingInputs),
    boundary: meta.boundary,
    executionAuthority: 'none',
  }
}

function unknownFormulaAvailability(formulaId) {
  const meta = STATUS_META['missing-input']
  return {
    id: formulaId ?? '',
    state: 'missing-input',
    label: meta.label,
    tone: meta.tone,
    canRender: false,
    implementationStatus: 'unknown',
    missingInputs: ['current-formula-output'],
    missingInputLabels: ['当前公式输出'],
    missingText: '当前公式输出',
    blockedReasons: [],
    blockedReasonLabels: [],
    reasonText: '无',
    nextStep: '检查公式标识和当前输入。',
    boundary: meta.boundary,
    executionAuthority: 'none',
  }
}

function normalizeContext(context) {
  const rows = Array.isArray(context.rows) ? context.rows : []
  const costPath = Array.isArray(context.costPath) ? context.costPath : []
  const formulaPath = Array.isArray(context.formulaPath) ? context.formulaPath : []
  const activeLength = costPath.length ? Math.min(rows.length, costPath.length) : rows.length
  const activeRows = rows.slice(0, activeLength)
  const activeCosts = costPath.slice(0, activeLength)
  const costDistanceSeries = activeCosts
    .map((cost, index) =>
      positive(cost?.anchor) && positive(activeRows[index]?.close)
        ? (activeRows[index].close - cost.anchor) / cost.anchor
        : null,
    )
    .filter(finite)
  return {
    graph: context.graph ?? {},
    market: context.market ?? null,
    rows,
    activeRows,
    costPath: activeCosts,
    formulaPath,
    latestFormulaRow: formulaPath.at(-1) ?? null,
    meanReversion: meanReversionHalfLife({ costDistanceSeries }),
  }
}

function deltaBandMissing(ctx) {
  const fieldState = ctx.latestFormulaRow?.fieldStates?.deltaUpper
  if (['not-applicable', 'model-gate-failed'].includes(fieldState?.status)) {
    return {
      state: fieldState.status,
      missingInputs: fieldState.missingInputs ?? [],
      blockedReasons: fieldState.blockedReasons ?? [],
    }
  }
  if (fieldState?.status === 'missing-input') {
    return {
      state: 'missing-input',
      missingInputs: fieldState.missingInputs?.length ? fieldState.missingInputs : ['formula-horizon-inputs'],
      blockedReasons: fieldState.blockedReasons ?? [],
    }
  }
  const long = ctx.graph?.deltaBands?.long
  if (long && [long.low, long.cost, long.high].every(finite)) return []
  return unique(
    compact([
      positive(ctx.graph?.inputs?.entryPrice ?? ctx.market?.markPrice) ? null : 'entry-price',
      positive(ctx.graph?.inputs?.formulaHorizonSessions) ? null : 'formula-derived-horizon',
      positive(ctx.graph?.inputs?.iv ?? ctx.market?.annualVol) ? null : 'realized-volatility',
      positive(ctx.graph?.inputs?.tradingDaysPerYear) ? null : 'trading-days-per-year',
      ...fieldMissing(ctx, 'deltaUpper'),
    ]),
  )
}

function optionMissing(ctx) {
  const portfolioReady = finite(ctx.graph?.optionPortfolio?.value)
  const singleReady = finite(ctx.graph?.option?.price)
  if (portfolioReady || singleReady) return []
  const missing = commonOptionMissing(ctx)
  return missing.length ? missing : ['option-model-output']
}

function asianMissing(ctx) {
  if (finite(ctx.graph?.asian?.price) && finite(ctx.graph?.bachelier?.price)) return []
  const missing = commonOptionMissing(ctx)
  return missing.length ? missing : ['option-model-output']
}

function commonOptionMissing(ctx) {
  return compact([
    positive(ctx.graph?.inputs?.entryPrice ?? ctx.market?.markPrice) ? null : 'entry-price',
    positive(ctx.graph?.researchInputs?.strikePrice ?? ctx.graph?.inputs?.entryPrice) ? null : 'strike-price',
    positive(ctx.graph?.researchInputs?.optionTenorSessions) ? null : 'option-tenor-sessions',
    positive(ctx.graph?.inputs?.iv ?? ctx.market?.annualVol) ? null : 'realized-volatility',
    positive(ctx.graph?.inputs?.tradingDaysPerYear) ? null : 'trading-days-per-year',
  ])
}

function lpInventoryMissing(ctx) {
  if (finite(ctx.graph?.lpV3?.value) && positive(ctx.graph?.researchInputs?.liquidity)) return []
  return lpValuationMissing(ctx)
}

function lpCapitalEfficiencyMissing(ctx) {
  if (finite(ctx.graph?.efficiency?.efficiency)) return []
  return lpValuationMissing(ctx)
}

function lpValuationMissing(ctx) {
  const declared = ctx.graph?.researchInputs?.lpValuationMissingInputs
  if (Array.isArray(declared) && declared.length) return unique(declared)
  return ['declared-lp-scenario-or-complete-position']
}

function lpPoolCoverageMissing(ctx) {
  const row = ctx.latestFormulaRow
  if ([row?.lpPoolTurnover24h, row?.lpPoolTopReserveShare].some(finite)) return []
  const missing = fieldMissing(ctx, 'lpPoolTurnover24h')
  return missing.length ? missing : ['pool-coverage-snapshot']
}

function fundingMissing(ctx) {
  if ([ctx.graph?.funding?.basisFraction, ctx.graph?.funding?.cumulativeFundingProxy].every(finite)) return []
  const horizonGate = dependentHorizonGate(ctx)
  if (horizonGate) return horizonGate
  return unique(
    compact([
      positive(ctx.graph?.researchInputs?.formulaHorizonSessions ?? ctx.graph?.inputs?.formulaHorizonSessions)
        ? null
        : 'formula-derived-horizon',
      ...fieldMissing(ctx, 'cumulativeFundingProxy'),
    ]),
  )
}

function portfolioMissing(ctx) {
  if (finite(ctx.graph?.portfolioResearch?.pnl?.scenarioTotal)) return []
  const missing = ctx.graph?.portfolioResearch?.missingInputs ?? []
  return missing.length ? missing : ['portfolio-ledger-inputs']
}

function orderPlanMissing(ctx) {
  if (!ctx.graph?.decision) return ['decision-state']
  return unique(ctx.graph.decision.missingInputs ?? [])
}

function deviationMissing(ctx) {
  const horizonGate = dependentHorizonGate(ctx)
  if (horizonGate) return horizonGate
  return compact([
    finite(ctx.market?.costDistance) ? null : 'cost-anchor',
    positive(ctx.market?.annualVol ?? ctx.graph?.inputs?.iv) ? null : 'realized-volatility',
    positive(ctx.graph?.inputs?.formulaHorizonSessions) ? null : 'formula-derived-horizon',
    positive(ctx.graph?.inputs?.tradingDaysPerYear) ? null : 'trading-days-per-year',
  ])
}

function riskSurfaceMissing(ctx) {
  const delta = deltaBandMissing(ctx)
  if (!Array.isArray(delta)) return delta
  return unique([...delta, ...commonOptionMissing(ctx)])
}

function netLpMissing(ctx) {
  const horizonGate = dependentHorizonGate(ctx)
  if (horizonGate) return horizonGate
  return compact([
    finite(ctx.graph?.efficiency?.efficiency) ? null : lpValuationMissing(ctx)[0],
    finite(ctx.graph?.rangeV3Il?.rangeV3Il) ? null : 'same-horizon-impermanent-loss',
    'realized-or-path-fee-return',
    'path-fee-source',
    positive(ctx.graph?.inputs?.formulaHorizonSessions) ? null : 'fee-and-il-horizon',
  ])
}

function netCarryMissing(ctx) {
  if (finite(ctx.graph?.netCarry?.netReturn)) return []
  const horizonGate = dependentHorizonGate(ctx)
  if (horizonGate) return horizonGate
  const missing = fieldMissing(ctx, 'netCarry')
  return missing.length
    ? missing
    : ['cumulative-funding-proxy', 'target-price', 'funding-position-side', 'common-notional-basis']
}

function dynamicHoldingMissing(ctx) {
  if (ctx.graph?.dynamicHolding?.missingInputs?.length) return ctx.graph.dynamicHolding.missingInputs
  if (ctx.graph?.dynamicHolding?.status && ctx.graph.dynamicHolding.status !== '需刷新数据') return []
  const horizon = ctx.latestFormulaRow?.formulaHorizonSessions ?? ctx.graph?.inputs?.formulaHorizonSessions
  if (positive(horizon) && ctx.meanReversion?.decayMode === 'monotonic-decay') return []
  const fieldState = ctx.latestFormulaRow?.fieldStates?.formulaHorizonSessions
  if (['not-applicable', 'model-gate-failed'].includes(fieldState?.status)) {
    return {
      state: fieldState.status,
      missingInputs: fieldState.missingInputs ?? [],
      blockedReasons: fieldState.blockedReasons ?? [],
    }
  }
  if (fieldState?.status === 'missing-input') {
    return {
      state: 'missing-input',
      missingInputs: fieldState.missingInputs?.length ? fieldState.missingInputs : ['formula-horizon-inputs'],
      blockedReasons: fieldState.blockedReasons ?? [],
    }
  }
  return unique(
    compact([
      ctx.meanReversion?.decayMode === 'monotonic-decay' ? null : 'monotonic-mean-reversion',
      positive(horizon) ? null : 'formula-derived-horizon',
      ...fieldMissing(ctx, 'formulaHorizonSessions'),
    ]),
  )
}

function gammaMissing(ctx) {
  return compact([
    finite(ctx.graph?.option?.optionGamma) ? null : 'option-gamma',
    positive(ctx.market?.markPrice) ? null : 'mark-price',
    finite(ctx.market?.costDistance) ? null : 'price-change-scenario',
  ])
}

function fieldMissing(ctx, field) {
  const values = ctx.latestFormulaRow?.fieldStates?.[field]?.missingInputs
  return Array.isArray(values) ? values : []
}

function dependentHorizonGate(ctx) {
  const state = ctx.latestFormulaRow?.fieldStates?.formulaHorizonSessions
  if (!['not-applicable', 'model-gate-failed'].includes(state?.status)) return null
  return {
    state: state.status,
    missingInputs: state.missingInputs ?? [],
    blockedReasons: state.blockedReasons ?? [],
  }
}

function normalizeRuleResult(result) {
  if (Array.isArray(result)) return { state: null, missingInputs: result, blockedReasons: [] }
  return {
    state: result?.state ?? null,
    missingInputs: Array.isArray(result?.missingInputs) ? result.missingInputs : [],
    blockedReasons: Array.isArray(result?.blockedReasons) ? result.blockedReasons : [],
  }
}

function nextStep(stageId, state, missingInputs) {
  if (state === 'missing-input') {
    return STAGE_ACTIONS[stageId] ?? `先补充${formatFormulaInputList(missingInputs)}，再重新计算。`
  }
  if (state === 'not-applicable') return '等待价格、成本锚或前向结构目标变化后自动重算；不手工填固定周期。'
  if (state === 'model-gate-failed') return '继续积累样本并等待 AR 单调衰减门禁成立；不引入未来参数。'
  if (state === 'research-only') return '保持研究层标记；如需升级，必须补齐真实市场输入、统计校准和执行门禁。'
  if (state === 'proxy-only') return '核对真实路径与结算制度；未校准前不升级为收益或执行结论。'
  if (state === 'protocol-unverified') return '先完成协议原文、合约实现和数值交叉验证。'
  return '继续检查样本、单位和门禁；当前可查看不代表可执行。'
}

function finite(value) {
  return Number.isFinite(value)
}

function positive(value) {
  return Number.isFinite(value) && value > 0
}

function compact(values) {
  return values.filter(Boolean)
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length))]
}
