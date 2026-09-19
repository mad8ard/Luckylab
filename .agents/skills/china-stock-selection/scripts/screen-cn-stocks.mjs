#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inferTdpy } from '../../../../src/domain/market-data/tdpy.js'
import { buildMarketStatePath, deriveWindows } from '../../../../src/domain/market-data/cost.js'
import {
  asianOption,
  bachelierOption,
  blackScholes,
  capitalEfficiency,
  deviationScore,
  deriveDrawdownFeatures,
  deriveDynamicHoldingState,
  fullRangeV2ImpermanentLoss,
  gammaPnl,
  getDeltaBands,
  liquidityFingerprint,
  lpResearchAttribution,
  meanReversionHalfLife,
  riskSurface,
  vixFix,
  volConfidence,
} from '../../../../src/domain/formulas/core.js'
import { ammCurve } from '../../../../src/domain/formulas/amm.js'
import { buildDecisionGraph } from '../../../../src/domain/strategy-planning/orderPlan.js'
import {
  CLAIM_CLASS_CONTRACT,
  SYNTHETIC_CK_GEOMETRY_DISCLOSURE,
  buildSyntheticCkGeometryState,
  canonicalizeFormulaSessionFields,
  deriveAdaptiveWindowSpec,
  empiricalDeviationStats,
  isPositiveMonotonicMeanReversion,
  loadNameMap,
  resolveInstrumentName,
  scoreFreshnessEvidence,
} from './selection-helpers.mjs'

const SCHEMA_VERSION = 'china-stock-selection.screen.v3'
const SUPPORTED_MARKETS = new Set(['A股', '港股'])
const SUPPORTED_FORMATS = new Set(['markdown', 'json'])
const SUPPORTED_FLAGS = new Set([
  'market', 'top', 'min-rows', 'option-tenor-sessions', 'format',
  'index', 'data-dir', 'name-map',
])
const BOOLEAN_FLAGS = new Set()
const RESEARCH_BOUNDARY = Object.freeze({
  status: 'research-only',
  executionStatus: 'blocked',
  reasons: ['local-daily-ohlcv-only', 'account-risk-budget-and-live-execution-inputs-unavailable'],
})
const STATE_CONTRACT = Object.freeze({
  dataState: ['ready', 'provisional', 'stale', 'invalid'],
  scoreStatus: ['diagnostic-high', 'diagnostic-medium', 'diagnostic-low'],
  candidateStatus: ['需刷新数据', '剔除', '等待', '观察'],
  executionStatus: ['blocked'],
})
const BASE_SCREEN_CLAIM_CLASSES = Object.freeze({
  score: 'scenario-proxy',
  costAnchor: 'sample-estimate',
  deviation: 'sample-estimate',
  empiricalDeviation: 'sample-estimate',
  realizedVolatility: 'sample-estimate',
  meanReversion: 'sample-estimate',
  deltaBands: 'scenario-proxy',
  syntheticCkGeometry: 'scenario-proxy',
  capitalEfficiency: 'exact-identity',
  fullRangeV2IlProxy: 'scenario-proxy',
  liquidityFingerprint: 'scenario-proxy',
  ammGeometry: 'scenario-proxy',
  fundingAndCarry: 'missing-input',
  vixFix: 'sample-estimate',
  dynamicHolding: 'scenario-proxy',
  orderPlan: 'scenario-proxy',
  execution: 'missing-input',
})

const ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const args = parseArgs(process.argv.slice(2), SUPPORTED_FLAGS, BOOLEAN_FLAGS)
const marketValues = parseMarkets(args.market ?? 'A股,港股')
const markets = new Set(marketValues)
const top = positiveIntArg(args.top, 20, 'top')
const explicitMinRows = optionalPositiveIntArg(args['min-rows'], 'min-rows')
const explicitOptionTenorSessions = optionalPositiveIntArg(args['option-tenor-sessions'], 'option-tenor-sessions')
const format = enumArg(args.format ?? 'markdown', SUPPORTED_FORMATS, 'format')
const indexInput = String(args.index ?? 'src/data/stock-index.json')
const dataDirInput = String(args['data-dir'] ?? 'public/data')
const nameMapInput = String(args['name-map'] ?? defaultNameMapPath())
const indexPath = resolvePath(indexInput)
const dataDir = resolvePath(dataDirInput)
const nameMapPath = resolvePath(nameMapInput)
const nameMap = loadNameMap(nameMapPath)
const SCREEN_CLAIM_CLASSES = Object.freeze({
  ...BASE_SCREEN_CLAIM_CLASSES,
  optionAndGreeks: explicitOptionTenorSessions === null ? 'missing-input' : 'scenario-proxy',
})

const index = readJson(indexPath)
if (!Array.isArray(index)) fail(`stock index must be an array: ${indexPath}`)

const candidates = []
const skipped = []
let considered = 0

for (const entry of index) {
  if (!markets.has(entry.market)) continue
  considered += 1
  const file = dataFileFor(entry)
  if (!existsSync(file)) {
    skipped.push(skipRecord(entry, 'missing-csv'))
    continue
  }
  const rows = parseCsv(readFileSync(file, 'utf8'))
  const tdpy = inferTdpy(entry)
  const adaptiveWindowSpec = deriveAdaptiveWindowSpec({
    tradingDaysPerYear: tdpy.value,
    visibleRows: rows.length,
  })
  const requiredRows = explicitMinRows ?? adaptiveWindowSpec.minimumRequiredRows
  const rowGate = {
    mode: explicitMinRows === null ? 'adaptive' : 'explicit-scenario',
    source: explicitMinRows === null ? adaptiveWindowSpec.source : 'cli:--min-rows',
    requiredRows,
    explicitMinimumRows: explicitMinRows,
    adaptiveMinimumRows: adaptiveWindowSpec.minimumRequiredRows,
  }
  if (rows.length < requiredRows) {
    skipped.push(skipRecord(entry, 'insufficient-rows', {
      rows: rows.length,
      requiredRows,
      rowGate,
      adaptiveWindowSpec,
    }))
    continue
  }
  candidates.push(profileInstrument(entry, rows, {
    tdpy,
    adaptiveWindowSpec,
    rowGate,
    optionTenorSessions: explicitOptionTenorSessions,
  }))
}

const candidateStatusPriority = new Map([
  ['观察', 0],
  ['等待', 1],
  ['剔除', 2],
  ['需刷新数据', 3],
])
const ranked = candidates
  .sort((a, b) => (candidateStatusPriority.get(a.candidateStatus) ?? 99) - (candidateStatusPriority.get(b.candidateStatus) ?? 99) || b.score - a.score)
  .slice(0, top)
const filters = {
  markets: marketValues,
}
const provenance = {
  runtime: '.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs',
  dataModel: 'local-daily-ohlcv',
  index: indexInput,
  dataDir: dataDirInput,
  nameMap: nameMapInput,
}
const rowGate = {
  mode: explicitMinRows === null ? 'adaptive' : 'explicit-scenario',
  source: explicitMinRows === null
    ? 'per-instrument adaptive window spec from tradingDaysPerYear and visible prefix'
    : 'cli:--min-rows',
  explicitMinimumRows: explicitMinRows,
  adaptiveFormula: 'ceil(sqrt(tradingDaysPerYear))',
}
const optionScenario = {
  mode: explicitOptionTenorSessions === null ? 'missing-input' : 'explicit-scenario',
  timeToExpirySessions: explicitOptionTenorSessions,
  source: explicitOptionTenorSessions === null ? 'missing-input' : 'cli:--option-tenor-sessions',
  executionAuthority: 'none',
}
const freshness = summarizeFreshness(candidates)
const audit = {
  considered,
  dataReady: candidates.length,
  emitted: ranked.length,
  skipped: skipped.length,
  skipReasons: countReasons(skipped),
}

if (format === 'json') {
  console.log(JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    markets: marketValues,
    top,
    rowGate,
    optionScenario,
    provenance,
    filters,
    freshness,
    audit,
    stateContract: STATE_CONTRACT,
    claimClassContract: CLAIM_CLASS_CONTRACT,
    claimClasses: SCREEN_CLAIM_CLASSES,
    researchBoundary: RESEARCH_BOUNDARY,
    syntheticCkGeometry: SYNTHETIC_CK_GEOMETRY_DISCLOSURE,
    ranked,
    skipped,
  }, null, 2))
} else {
  printMarkdown(ranked, {
    markets: marketValues,
    top,
    rowGate,
    optionScenario,
    skipped,
    filters,
    provenance,
    freshness,
    audit,
  })
}

// ── 单标的完整分析 ──

function profileInstrument(entry, rows, sampleContext) {
  const latest = rows.at(-1)
  const staleDays = ageInDays(latest.date)
  const formula = buildFormula(entry, rows, sampleContext)
  const nameInfo = resolveInstrumentName(entry, nameMap)
  const amounts = rows.map(r => r.close * r.volume)
  const amountWindowRows = formula.windowSpec?.marketRecentWindowRows
    ?? formula.windowSpec?.scenarioHorizonSessions
    ?? 1
  const avgAmountRecent = mean(amounts.slice(-amountWindowRows))

  const score = round(Math.min(100,
    scoreCostAnchor(formula) + scoreSyntheticCkGeometry(formula) + scoreDeviation(formula)
      + (scoreFreshnessEvidence({
        staleDays,
        totalRows: rows.length,
        tradingDaysPerYear: formula.tdpy.value,
        minimumRequiredRows: formula.windowSpec.minimumRequiredRows,
      })?.score ?? 0)
  ), 1)
  const source = entry.source ?? 'local csv'
  const freshness = freshnessRecord(latest.date, rows.length)
  const dataState = dataStateRecord(freshness)
  const scoreStatus = score >= 65 ? 'diagnostic-high'
    : score >= 40 ? 'diagnostic-medium'
    : 'diagnostic-low'
  const candidateDecision = resolveCandidateStatus({ dataState: dataState.status, scoreStatus, formula })

  return {
    symbol: entry.symbol,
    label: entry.label ?? entry.symbol,
    name: nameInfo.name,
    nameSource: nameInfo.source,
    market: entry.market,
    source,
    dataThrough: latest.date,
    rows: rows.length,
    close: round(latest.close, 3),
    dataState: dataState.status,
    dataStateReasons: dataState.reasons,
    score,
    scoreStatus,
    candidateStatus: candidateDecision.status,
    // Compatibility alias. New consumers must use candidateStatus.
    status: candidateDecision.status,
    statusReasons: candidateDecision.reasons,
    executionStatus: RESEARCH_BOUNDARY.executionStatus,
    executionReasons: uniqueStrings([
      ...RESEARCH_BOUNDARY.reasons,
      ...(formula.orderPlan?.missingInputs ?? []).map((input) => `missing-${input}`),
    ]),
    claimClasses: SCREEN_CLAIM_CLASSES,
    costNote: costNoteStr(formula),
    ckGeometryNote: ckGeometryNoteStr(formula),
    zNote: zNoteStr(formula),
    staleDays: freshness.staleDays,
    freshness,
    provenance: {
      marketSource: source,
      nameSource: nameInfo.source,
      dataThrough: latest.date,
      rows: rows.length,
      rowGate: sampleContext.rowGate,
      adaptiveWindowSpec: sampleContext.adaptiveWindowSpec,
    },
    avgAmountRecent: Math.round(avgAmountRecent),
    avgAmountWindowRows: amountWindowRows,
    formula,
  }
}

// ── 完整公式计算 ──

function buildFormula(entry, rows, sampleContext) {
  const tdpy = sampleContext?.tdpy ?? inferTdpy(entry)
  const adaptiveWindowSpec = sampleContext?.adaptiveWindowSpec ?? deriveAdaptiveWindowSpec({
    tradingDaysPerYear: tdpy.value,
    visibleRows: rows.length,
  })
  const marketPath = buildMarketStatePath(rows, tdpy.value)
  const market = marketPath.at(-1)
  const latest = rows.at(-1)
  const iv = Math.max(market?.annualVol ?? 0, 0.01)
  const formulaHorizonSessions = adaptiveWindowSpec.scenarioHorizonSessions
  const timeToExpirySessions = sampleContext?.optionTenorSessions ?? null
  const deltaSlope = 0.08

  // 成本锚
  const cost = market ? {
    claimClass: 'sample-estimate',
    anchor: round(market.costAnchor, 3),
    low: round(market.costLow, 3),
    high: round(market.costHigh, 3),
    distancePct: round((market.costDistance ?? 0) * 100, 2),
    slopeRecentPct: round((market.costSlopeRecent ?? 0) * 100, 2),
    slopeWindowRows: market.windowSpec?.recent ?? null,
  } : null

  // z-score 偏离
  const deviation = deviationScore({
    costDistance: market?.costDistance ?? 0,
    annualVol: iv,
    formulaHorizonSessions,
    tradingDaysPerYear: tdpy.value,
  })
  const deviationDistribution = empiricalDeviationStats(
    marketPath.slice(-adaptiveWindowSpec.empiricalDeviationWindowRows).map((item) => item?.costDistance),
    market?.costDistance,
  )

  // Delta 成本带
  const deltaBands = getDeltaBands({
    entryPrice: latest.close,
    formulaHorizonSessions,
    iv,
    deltaSlope,
    tradingDaysPerYear: tdpy.value,
  })

  // 期权 + 亚式 + Bachelier
  const strikePrice = latest.close * 1.05
  const optArgs = timeToExpirySessions === null ? null : {
    entryPrice: latest.close,
    strikePrice,
    timeToExpirySessions,
    iv,
    type: 'call',
    tradingDaysPerYear: tdpy.value,
  }
  const option = optArgs ? blackScholes(optArgs) : null
  const asian = optArgs ? asianOption(optArgs) : null
  const bachelier = optArgs ? bachelierOption({ ...optArgs, normalVol: iv * latest.close }) : null

  // 风险曲面
  const surface = deltaBands && timeToExpirySessions !== null ? riskSurface({
    entryPrice: latest.close,
    strikePrice,
    timeToExpirySessions,
    iv,
    bandLow: deltaBands.long.low, bandHigh: deltaBands.short.high,
    steps: 12, tradingDaysPerYear: tdpy.value,
  }) : null

  // Gamma PnL
  const gamma = option ? gammaPnl({
    gamma: option.optionGamma,
    markPrice: latest.close,
    priceChange: market?.atr ?? 0,
    positionSize: 1,
  }) : null

  // CK / Uniswap v3 几何 (L=1 合成模式，不代表真实 LP 仓位或股票囤货)
  const syntheticCkGeometry = buildSyntheticCkGeometryState(market, latest)
  const synRW = syntheticCkGeometry?.rangeWidth ?? Math.min(Math.max(market?.atrPercent ?? 0.05, 0.03), 0.5)
  const synLower = syntheticCkGeometry?.lowerPrice ?? (market?.costAnchor ?? latest.close) * Math.max(1 - synRW, 0.001)
  const synUpper = syntheticCkGeometry?.upperPrice ?? (market?.costAnchor ?? latest.close) * (1 + synRW)

  // 合成几何值的历史分位数；这是形状排名，不是持仓量、收益或价格概率。
  const ckGeometryValues = []
  for (
    let i = Math.max(0, marketPath.length - adaptiveWindowSpec.ckGeometryRankWindowRows);
    i < marketPath.length;
    i += 1
  ) {
    const m = marketPath[i]
    const r = rows[i]
    if (!m || !r) continue
    const geometry = buildSyntheticCkGeometryState(m, r)
    if (Number.isFinite(geometry?.normalizedValue)) ckGeometryValues.push(geometry.normalizedValue)
  }
  ckGeometryValues.sort((a, b) => a - b)
  const ckGeometryPercentile = ckGeometryValues.length > 0
    && Number.isFinite(syntheticCkGeometry?.normalizedValue)
    ? round(ckGeometryValues.filter((value) => value <= syntheticCkGeometry.normalizedValue).length / ckGeometryValues.length * 100, 1)
    : null

  // 流动性指纹
  const fingerprint = liquidityFingerprint({
    entryPrice: market?.costAnchor ?? latest.close, priceGrid: 40,
    lowerFactor: 1 - Math.min(synRW * 2, 0.5),
    upperFactor: 1 + Math.min(synRW * 2, 0.5), segmentCount: 6,
    volatility: market?.annualVol,
    tradingDaysPerYear: tdpy.value,
  })

  // AMM 几何 (合成)
  const synAmm = ammCurve({ price: latest.close, invariant: latest.close * latest.close, n: 2, c: 0.003 })

  // CK 几何诊断：CE 是精确几何恒等式；这里的 IL 仅是 full-range v2 代理，
  // 不消费 synthetic v3 区间上下界，不能解释成该区间的 v3 IL。
  const ce = capitalEfficiency({ rangeWidth: synRW, skew: 1 })
  const fullRangeV2IlProxy = fullRangeV2ImpermanentLoss({
    markPrice: latest.close,
    startPrice: market?.costAnchor ?? latest.close,
    liquidity: 1,
  })
  const geometryResearchAttribution = ce ? lpResearchAttribution({
    capitalEfficiency: ce.efficiency,
    lpIlFraction: fullRangeV2IlProxy?.fullRangeV2IlProxy,
    ilModel: fullRangeV2IlProxy?.model ?? 'constant-product-v2-full-range-no-fees',
    capitalBasis: 'full-range-v2-entry-hold-value-at-current-mark',
    startPrice: market?.costAnchor ?? latest.close,
    markPrice: latest.close,
    feeReturn: null,
    feeSource: null,
    feeTreatment: null,
    horizonSessions: null,
  }) : null

  // 资金费率 + 持仓净收益 (合成, 无 perp/spot TWAP 则 null)
  const hasFunding = false // A 股无 perp 数据

  // 波动率置信
  const volSampleSize = Math.min(deriveWindows(rows.length).vol, Math.max(rows.length - 1, 5))
  const vci = volConfidence({ annualVol: iv, sampleSize: volSampleSize, confidenceLevel: 0.68 })

  // 均值回归
  const costSeries = marketPath.map(x => x.costDistance).filter(Number.isFinite)
  const mr = meanReversionHalfLife({
    costDistanceSeries: costSeries.slice(-adaptiveWindowSpec.meanReversionWindowRows),
    tradingDaysPerYear: tdpy.value,
  })
  const drawdown = deriveDrawdownFeatures({ rows })
  const rawDynamicHolding = isPositiveMonotonicMeanReversion(mr) && market
    ? deriveDynamicHoldingState({
      zScore: deviation.z,
      halfLifeSessions: mr.halfLifeSessions,
      entryPrice: latest.close,
      anchorPrice: market.costAnchor,
      targetPrices: { costLower: market.costLow, anchor: market.costAnchor },
      drawdown,
      costSlopePct: (market.costSlopeRecent ?? 0) * 100,
    })
    : null
  const dynamicHolding = canonicalizeFormulaSessionFields(rawDynamicHolding)

  // VIX Fix
  const vixWindow = rows.slice(-adaptiveWindowSpec.vixFixWindowRows)
  const vix = vixFix({ highestClose: Math.max(...vixWindow.map(r => r.close)), low: latest.low })

  // 订单决策
  const decisionGraph = buildDecisionGraph({
    market,
    input: {
      entryPrice: latest.close,
      formulaHorizonSessions,
      iv,
      ivSource: 'historical-realized-scenario',
      deltaSlope,
      tradingDaysPerYear: tdpy.value,
      strategyProfile: 'balanced',
    },
    account: null,
  })

  return {
    tdpy,
    windowSpec: {
      ...adaptiveWindowSpec,
      marketCostWindowRows: market?.windowSpec?.cost ?? null,
      marketRecentWindowRows: market?.windowSpec?.recent ?? null,
      marketVolWindowRows: market?.windowSpec?.vol ?? null,
      marketWindowMode: market?.windowSpec?.mode ?? null,
      rowGate: sampleContext?.rowGate ?? null,
    },
    cost,
    deviation: {
      claimClass: 'sample-estimate',
      formulaHorizonSessions,
      z: round(deviation.z, 2),
      regime: deviation.regime,
      strength: deviation.strength,
      deviationPercentilePct: round(deviation.deviationPercentile * 100, 1),
      twoSidedTailProbabilityPct: round(deviation.twoSidedTailProbability * 100, 1),
      probabilitySemantics: deviation.probabilitySemantics,
      empiricalPercentilePct: deviationDistribution ? round(deviationDistribution.percentilePct, 1) : null,
      empiricalLowerTailPct: deviationDistribution ? round(deviationDistribution.lowerTailPct, 1) : null,
      empiricalUpperTailPct: deviationDistribution ? round(deviationDistribution.upperTailPct, 1) : null,
      empiricalTwoSidedTailPct: deviationDistribution ? round(deviationDistribution.twoSidedTailPct, 1) : null,
      empiricalSampleSize: deviationDistribution?.sampleSize ?? 0,
      empiricalInterpretation: deviationDistribution?.interpretation ?? 'historical distribution unavailable',
    },
    deltaBands: deltaBands ? {
      claimClass: 'scenario-proxy',
      formulaHorizonSessions,
      longLow: round(deltaBands.long.low, 3),
      longCost: round(deltaBands.long.cost, 3),
      longHigh: round(deltaBands.long.high, 3),
      shortLow: round(deltaBands.short.low, 3),
      shortCost: round(deltaBands.short.cost, 3),
      shortHigh: round(deltaBands.short.high, 3),
    } : null,
    options: {
      status: option ? 'research-only' : 'missing-input',
      claimClass: option ? 'scenario-proxy' : 'missing-input',
      model: 'scenario-pricing-not-market-option-quote',
      horizonMode: option ? 'explicit-scenario' : 'missing-input',
      timeToExpirySessions,
      timeToExpirySource: option ? 'cli:--option-tenor-sessions' : 'missing-input',
      volatilitySource: 'historical-realized-scenario',
      isMarketIv: false,
      missingInputs: [
        timeToExpirySessions === null ? 'explicit-option-tenor-sessions' : null,
        'option-chain-quote',
        'bid-ask',
        'contract-multiplier',
        'settlement-rules',
        'market-implied-volatility',
      ].filter(Boolean),
      optionDelta: option ? round(option.optionDelta, 3) : null,
      optionGamma: option ? round(option.optionGamma, 6) : null,
      optionThetaPerSession: option ? round(option.optionThetaPerSession, 6) : null,
      asianPrice: asian ? round(asian.price, 3) : null,
      bachelierPrice: bachelier ? round(bachelier.price, 3) : null,
      riskSurfacePoints: surface?.points?.length ?? 0,
      positionGamma: gamma ? round(gamma.positionGamma, 8) : null,
      dollarGamma: gamma ? round(gamma.dollarGamma, 6) : null,
      gammaPnl: gamma ? round(gamma.gammaPnl, 6) : null,
    },
    gammaConvexity: gamma ? {
      claimClass: 'scenario-proxy',
      model: 'synthetic Black-Scholes call',
      strikePrice: round(strikePrice, 3),
      timeToExpirySessions,
      timeToExpirySource: 'cli:--option-tenor-sessions',
      positionSize: 1,
      positionGamma: round(gamma.positionGamma, 8),
      dollarGamma: round(gamma.dollarGamma, 6),
      shockType: 'one-ATR absolute price move',
      priceChange: round(gamma.priceChange, 6),
      priceChangePct: round(gamma.priceChangePct * 100, 4),
      gammaPnl: round(gamma.gammaPnl, 6),
      convexityNote: gamma.convexityNote,
      formula: '0.5 × positionGamma × ΔP² = 0.5 × dollarGamma × (ΔP/P)²',
      unitNote: 'positionSize=1 的合成期权单位情景值，不是实际人民币持仓收益',
    } : null,
    syntheticCkGeometry: {
      ...SYNTHETIC_CK_GEOMETRY_DISCLOSURE,
      claimClass: 'scenario-proxy',
      normalizedValue: Number.isFinite(syntheticCkGeometry?.normalizedValue)
        ? round(syntheticCkGeometry.normalizedValue, 4)
        : null,
      unitLiquidityValue: Number.isFinite(syntheticCkGeometry?.unitLiquidityValue)
        ? round(syntheticCkGeometry.unitLiquidityValue, 4)
        : null,
      anchorReferenceValue: Number.isFinite(syntheticCkGeometry?.anchorReferenceValue)
        ? round(syntheticCkGeometry.anchorReferenceValue, 4)
        : null,
      region: syntheticCkGeometry?.region ?? null,
      lowerPrice: round(synLower, 3),
      upperPrice: round(synUpper, 3),
      rangeWidthPct: round(synRW * 100, 2),
      percentilePct: ckGeometryPercentile,
      sampleSessions: ckGeometryValues.length,
      capitalEfficiencyMultiple: ce ? round(ce.efficiency, 2) : null,
      capitalEfficiencyClaimClass: ce?.claimClass ?? 'missing-input',
      capitalEfficiencyValuationBasis: ce?.efficiencyValuationBasis ?? null,
      capitalEfficiencyAtArithmeticCenterMultiple: ce
        ? round(ce.efficiencyAtArithmeticCenter, 2)
        : null,
      arithmeticReferenceIsValuationPrice: ce?.arithmeticReferenceIsValuationPrice ?? null,
      valuationBasisNote: ce
        ? 'endpoint-ratio capital efficiency is valued at the range geometric midpoint; normalized current-versus-anchor geometry is a separate basis'
        : null,
      fullRangeV2IlProxyPct: fullRangeV2IlProxy
        ? round((fullRangeV2IlProxy.fullRangeV2IlProxy ?? 0) * 100, 2)
        : null,
      fullRangeV2IlProxyBasis: 'constant-product-v2-current-price-versus-cost-anchor; does-not-consume-v3-range-bounds',
      fullRangeV2IlProxyClaimClass: 'scenario-proxy',
      researchAttribution: geometryResearchAttribution ? {
        ...geometryResearchAttribution,
        inputMode: 'synthetic-geometry-scenario',
        researchBoundary: 'research-only',
        executionStatus: 'blocked',
        geometry: {
          ...geometryResearchAttribution.geometry,
          claimClass: 'exact-identity',
          valuationBasis: ce.efficiencyValuationBasis,
        },
        returns: {
          ...geometryResearchAttribution.returns,
          unit: 'full-range-v2-relative-return-proxy',
          lpIlBasis: 'full-range-v2-proxy-current-price-versus-cost-anchor',
          commonV3RangeAndCapitalBasisVerified: false,
          isV3RangeIl: false,
        },
        comparisonStatus: 'basis-separated-not-comparable-or-additive',
        aggregationAllowed: false,
        missingInputs: uniqueStrings([
          ...geometryResearchAttribution.missingInputs,
          'same-range-same-capital-v3-entry-and-mark-valuation',
        ]),
        relation: 'separate-geometry-and-full-range-v2-proxy-no-aggregation',
      } : null,
    },
    fingerprint: fingerprint
      ? {
          claimClass: 'scenario-proxy',
          status: fingerprint.status,
          segments: fingerprint.segments.length,
          entropy: fingerprint.stats?.entropy ?? null,
          inputMode: 'synthetic-model-density',
          missingInputs: fingerprint.missingInputs,
          interpretation: 'normalized model allocation mass; not a price probability or real order book',
        }
      : {
          claimClass: 'missing-input',
          status: 'blocked',
          segments: 0,
          entropy: null,
          inputMode: 'missing-input',
          missingInputs: [
            Number.isFinite(market?.annualVol) && market.annualVol > 0 ? null : 'realized-volatility',
            Number.isFinite(tdpy.value) && tdpy.value > 0 ? null : 'tradingDaysPerYear',
          ].filter(Boolean),
          interpretation: 'fingerprint unavailable until volatility and trading-session basis are known',
        },
    amm: synAmm ? {
      claimClass: 'scenario-proxy',
      reserveX: round(synAmm.currentX, 3),
      reserveY: round(synAmm.currentY, 3),
      k: round(synAmm.invariant, 3),
      status: synAmm.status,
      inputMode: 'synthetic-geometry',
    } : null,
    funding: { claimClass: 'missing-input', hasFunding, basisEstimate: null, cumulativeFunding: null },
    netCarry: null,
    volConfidence: vci ? {
      claimClass: 'sample-estimate',
      annualVolPct: round(vci.annualVol * 100, 2),
      standardErrorPct: round(vci.se * 100, 2),
      lowerPct: round(vci.lower * 100, 2),
      upperPct: round(vci.upper * 100, 2),
      relativeUncertaintyPct: round(vci.relativeUncertainty * 100, 2),
      confidenceLevelPct: round(vci.confidenceLevel * 100, 1),
      zCritical: round(vci.zScore, 4),
      sampleSize: vci.sampleSize,
      quality: vci.quality,
    } : null,
    meanReversion: mr ? {
      claimClass: 'sample-estimate',
      arCoefficient: round(mr.arCoefficient, 6),
      arDecayRatePerStep: mr.arDecayRatePerStep === null ? null : round(mr.arDecayRatePerStep, 6),
      halfLifeSessions: mr.halfLifeSessions === null ? null : round(mr.halfLifeSessions, 2),
      speed: mr.speed,
      isMeanReverting: mr.isMeanReverting,
      decayMode: mr.decayMode,
      eligibleForDynamicHolding: isPositiveMonotonicMeanReversion(mr),
      sampleSize: mr.sampleSize,
      periodNote: mr.periodNote,
    } : null,
    dynamicHolding: dynamicHolding ? {
      ...dynamicHolding,
      claimClass: 'scenario-proxy',
      zBasisSessions: formulaHorizonSessions,
      targetInputMode: 'cost-band-and-anchor-only',
      syntheticCkGeometryUsedAsTarget: false,
    } : null,
    vixFix: vix !== null && vix !== undefined ? round(Number(vix) * 100, 2) : null,
    orderPlan: {
      claimClass: 'scenario-proxy',
      state: decisionGraph.decision?.state ?? '等待',
      blockedReasons: decisionGraph.decision?.blockedReasons ?? [],
      missingInputs: decisionGraph.decision?.missingInputs ?? [],
      signalSemantics: decisionGraph.decision?.signalSemantics ?? 'normal-reference-extremeness-not-confidence-or-win-probability',
    },
  }
}

function resolveCandidateStatus({ dataState, scoreStatus, formula }) {
  if (dataState === 'stale' || dataState === 'invalid') {
    return { status: '需刷新数据', reasons: [`data-state-${dataState}`] }
  }
  if (scoreStatus === 'diagnostic-low') {
    return { status: '剔除', reasons: ['raw-score-below-40'] }
  }
  const holdingStatus = formula.dynamicHolding?.status
  const planBlocked = (formula.orderPlan?.blockedReasons?.length ?? 0) > 0
  if (formula.meanReversion?.eligibleForDynamicHolding !== true) {
    return { status: '等待', reasons: ['mean-reversion-not-positive-monotonic'] }
  }
  const phase = formula.dynamicHolding?.phase
  if (!['repair-start', 'mean-reverting'].includes(phase)) {
    return { status: '等待', reasons: [`phase-${phase ?? 'unknown'}-not-observation-gate`] }
  }
  if (holdingStatus === '剔除') {
    return {
      status: '剔除',
      reasons: uniqueStrings(['dynamic-holding-excluded', ...(formula.dynamicHolding?.blockedReasons ?? [])]),
    }
  }
  if (holdingStatus !== '观察') {
    return {
      status: '等待',
      reasons: uniqueStrings(['dynamic-holding-not-observe', ...(formula.dynamicHolding?.blockedReasons ?? [])]),
    }
  }
  if (planBlocked) {
    return {
      status: '等待',
      reasons: uniqueStrings(['order-plan-blocked', ...formula.orderPlan.blockedReasons]),
    }
  }
  if (scoreStatus !== 'diagnostic-high') {
    return { status: '等待', reasons: ['raw-score-below-65'] }
  }
  return { status: '观察', reasons: ['all-research-gates-passed'] }
}

// ── 评分：成本锚 (30) + 合成 CK 几何 (35) + 偏离分布 (25) + 数据质量 (10) ──
// 合成几何只描述标准化形状位置；不代表真实 LP 持仓、股票囤货或收益。

function scoreCostAnchor(formula) {
  let s = 0
  const c = formula.cost
  if (!c) return 0
  // 锚方向 — 确认信号 (0-14)
  if (c.slopeRecentPct > 0) s += 14
  else if (c.slopeRecentPct > -0.5) s += 10
  else if (c.slopeRecentPct > -1.5) s += 5
  else if (c.slopeRecentPct > -2.5) s += 2
  // 价格位置 (0-10)
  if (c.distancePct >= -3 && c.distancePct <= 15) s += 10
  else if (c.distancePct >= -8 && c.distancePct <= 25) s += 7
  // 带内加成 (0-6)
  if (c.distancePct >= 0 && c.distancePct <= 15) s += 6
  return s
}

function scoreSyntheticCkGeometry(formula) {
  let s = 0
  const geometry = formula.syntheticCkGeometry
  if (!geometry || geometry.normalizedValue === null) return 0
  const percentile = geometry.percentilePct
  // 标准化几何值的历史位置 (0-25)，不是价格概率或真实库存量。
  if (percentile !== null && percentile < 5) s += 25
  else if (percentile !== null && percentile < 10) s += 21
  else if (percentile !== null && percentile < 25) s += 15
  else if (percentile !== null && percentile < 50) s += 8
  else if (percentile !== null) s += 2
  // V3 分段几何区域 (0-10)，只用于形状分类。
  if (geometry.region === 'range') s += 10
  else if (geometry.region === 'token0' && percentile !== null && percentile < 25) s += 10
  else if (geometry.region === 'token0') s += 4
  return s
}

function scoreDeviation(formula) {
  let s = 0
  const d = formula.deviation
  if (!d) return 0
  // 正态参考双侧尾部 (0-12)：只描述标准化偏离的极端程度，不是回归概率。
  const tail = d.twoSidedTailProbabilityPct
  if (d.z < 0 && tail !== null && tail <= 5) s += 12
  else if (d.z < 0 && tail !== null && tail <= 10) s += 10
  else if (d.z < 0 && tail !== null && tail <= 25) s += 7
  else if (d.z < 0 && tail !== null && tail <= 50) s += 4
  else if (d.z < 0 && tail !== null) s += 1
  // 标准化折价深度 (0-13)，仍不是未来回归概率。
  const z = d.z
  if (z <= -3) s += 13
  else if (z <= -2) s += 10
  else if (z <= -1) s += 7
  else if (z < 0) s += 3
  return s
}

// ── 三列输出文本 ──

function costNoteStr(f) {
  const c = f.cost
  if (!c) return 'n/a'
  const dir = c.slopeRecentPct > 0.5 ? '↑' : c.slopeRecentPct < -0.5 ? '↓' : '→'
  return `${c.distancePct > 0 ? '+' : ''}${c.distancePct}% ${dir} [${c.low}-${c.high}]`
}

function ckGeometryNoteStr(f) {
  const geometry = f.syntheticCkGeometry
  if (!geometry || geometry.normalizedValue === null) return 'n/a'
  const percentile = geometry.percentilePct !== null ? `P${geometry.percentilePct}` : '?'
  return `${geometry.region} shape=${geometry.normalizedValue} ${percentile} synthetic-only`
}

function zNoteStr(f) {
  const d = f.deviation
  if (!d) return 'n/a'
  const percentile = d.deviationPercentilePct !== null ? `normal-ref P${d.deviationPercentilePct}` : 'normal-ref P?'
  const tail = d.twoSidedTailProbabilityPct !== null ? `two-tail ${d.twoSidedTailProbabilityPct}%` : 'tail ?'
  const empirical = d.empiricalPercentilePct !== null ? `empirical P${d.empiricalPercentilePct}` : 'empirical P?'
  const empiricalTail = d.empiricalTwoSidedTailPct !== null ? `emp-tail ${d.empiricalTwoSidedTailPct}%` : 'emp-tail ?'
  return `${d.z > 0 ? '+' : ''}${d.z}σ ${d.regime} ${percentile} ${tail} ${empirical} ${empiricalTail}`
}

// ── Markdown ──

function printMarkdown(rows, meta) {
  console.log(`# 国内股票筛选 (成本锚 / 合成 CK 几何 / 偏离分布)`)
  console.log(``)
  console.log(`Markets: ${meta.markets.join(', ')} | top: ${meta.top} | rowGate: ${meta.rowGate.mode} (${meta.rowGate.source})`)
  console.log(`Option tenor: ${meta.optionScenario.timeToExpirySessions ?? 'missing'} sessions | mode: ${meta.optionScenario.mode} | source: ${meta.optionScenario.source}`)
  console.log(`Source: ${meta.provenance.index} + ${meta.provenance.dataDir} | freshness: ${freshnessText(meta.freshness)}`)
  console.log(`公式栈: 价格路径→成本→Δ带→期权→合成CK几何→AMM→经验偏离分布→曲面→回归 (无RSI/KDJ/EMA/MA)`)
  console.log(``)
  console.log(`| symbol | name | market | source | through / rows / age | status | reason | score | 成本锚 | CK几何(合成) | 偏离分布 |`)
  console.log(`| --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- |`)
  for (const r of rows) {
    console.log(`| ${cell(r.symbol)} | ${cell(r.name)} | ${cell(r.market)} | ${cell(r.source)} | ${cell(`${r.dataThrough} / ${r.rows} / ${r.staleDays ?? '?'}d`)} | ${cell(r.status)} | ${cell(r.statusReasons.join(','))} | ${r.score} | ${cell(r.costNote)} | ${cell(r.ckGeometryNote)} | ${cell(r.zNote)} |`)
  }
  console.log(``)
  console.log(`评分: 成本锚(0-30) + 合成CK几何(0-35) + 偏离分布(0-25) + 数据质量(0-10)`)
  console.log(`偏离分布: normal-reference deviation percentile/two-sided tail + empirical rank；只描述极端程度，不是回归概率`)
  console.log(`合成CK几何: liquidity=1、ATR动态区间；不是实际LP仓位、股票囤货、手续费或收益`)
  console.log(`完整JSON: --format json 含全量公式字段 (options/gammaConvexity/dynamicHolding/meanReversion/volConfidence/orderPlan)`)
  console.log(`本报告仅基于本地OHLCV的研究筛选，不构成投资建议。`)
  if (meta.skipped.length) console.log(`跳过: ${meta.skipped.length}；${reasonSummary(meta.audit.skipReasons)}`)
}

// ── 工具函数 ──

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  const rows = []
  for (const line of lines.slice(1)) {
    const [date, open, high, low, close, volume] = line.split(',')
    const row = { date, open: +open, high: +high, low: +low, close: +close, volume: +volume }
    if (row.date && [row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite) && row.close > 0) rows.push(row)
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

function dataFileFor(entry) {
  return join(dataDir, String(entry.url ?? '').split('/').at(-1))
}

function skipRecord(entry, reason, detail = {}) {
  return {
    symbol: entry.symbol,
    market: entry.market,
    source: entry.source ?? 'local csv',
    reason,
    ...detail,
  }
}

function freshnessRecord(dataThrough, rows) {
  const staleDays = ageInDays(dataThrough)
  return {
    status: !Number.isFinite(staleDays) ? 'invalid-date' : staleDays > 10 ? 'stale' : 'current-enough-for-research',
    dataThrough,
    rows,
    staleDays: Number.isFinite(staleDays) ? staleDays : null,
    basis: 'calendar-days-from-latest-local-row',
    staleThresholdDays: 10,
  }
}

function dataStateRecord(freshness) {
  if (freshness.status === 'invalid-date') {
    return { status: 'invalid', reasons: ['latest-local-row-date-invalid'] }
  }
  if (freshness.status === 'stale') {
    return { status: 'stale', reasons: ['data-stale-over-10-calendar-days'] }
  }
  return {
    status: 'provisional',
    reasons: ['local-daily-ohlcv-path-only; corporate-actions-and-live-execution-state-not-verified'],
  }
}

function summarizeFreshness(rows) {
  if (!rows.length) {
    return {
      status: 'no-data-ready-instruments',
      basis: 'calendar-days-from-latest-local-row',
      staleThresholdDays: 10,
      staleCandidates: 0,
    }
  }
  const dates = rows.map((row) => row.dataThrough).filter(Boolean).sort()
  const staleValues = rows.map((row) => row.staleDays).filter(Number.isFinite)
  const staleCandidates = rows.filter((row) => row.freshness.status !== 'current-enough-for-research').length
  return {
    status: staleCandidates > 0 ? 'contains-stale-or-invalid-data' : 'current-enough-for-research',
    oldestDataThrough: dates[0] ?? null,
    newestDataThrough: dates.at(-1) ?? null,
    maxStaleDays: staleValues.length ? Math.max(...staleValues) : null,
    basis: 'calendar-days-from-latest-local-row',
    staleThresholdDays: 10,
    staleCandidates,
  }
}

function countReasons(rows) {
  const counts = {}
  for (const row of rows) counts[row.reason] = (counts[row.reason] ?? 0) + 1
  return counts
}

function ageInDays(dateText) {
  const d = new Date(`${dateText}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return Number.POSITIVE_INFINITY
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

function mean(arr) {
  const v = arr.filter(Number.isFinite)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
}

function round(v, d = 2) { const f = 10 ** d; return Math.round(v * f) / f }
function cell(v) { return String(v ?? '').replace(/\|/g, '/') }

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch (e) { fail(`cannot read ${path}: ${e.message}`) }
}

function defaultNameMapPath() {
  const candidates = [
    'skills/china-stock-selection/references/stock-names.json',
    '.agents/skills/china-stock-selection/references/stock-names.json',
    '.claude/skills/china-stock-selection/references/stock-names.json',
  ]
  return candidates.find((candidate) => existsSync(resolvePath(candidate))) ?? candidates[1]
}

function resolvePath(p) { return resolve(ROOT, String(p)) }
function positiveIntArg(value, fallback, name) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) fail(`invalid --${name} value "${value}", expected a positive integer`)
  return parsed
}

function optionalPositiveIntArg(value, name) {
  return value === undefined ? null : positiveIntArg(value, null, name)
}

function parseMarkets(value) {
  const parsed = [...new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean))]
  if (!parsed.length) fail('market must contain A股 or 港股')
  const invalid = parsed.filter((market) => !SUPPORTED_MARKETS.has(market))
  if (invalid.length) fail(`unknown market "${invalid.join(',')}", expected A股, 港股, or A股,港股`)
  return parsed
}

function enumArg(value, supported, name) {
  const normalized = String(value)
  if (!supported.has(normalized)) fail(`unknown ${name} "${normalized}", expected ${[...supported].join(' or ')}`)
  return normalized
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))]
}

function freshnessText(freshness) {
  if (freshness.status === 'no-data-ready-instruments') return freshness.status
  return `${freshness.status}, ${freshness.oldestDataThrough}..${freshness.newestDataThrough}, maxAge=${freshness.maxStaleDays ?? '?'}d`
}

function reasonSummary(reasons) {
  return Object.entries(reasons).map(([reason, count]) => `${reason}=${count}`).join(', ')
}

function parseArgs(values, supported, booleanFlags) {
  const parsed = {}
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!v.startsWith('--')) fail(`unexpected positional argument "${v}"`)
    const key = v.slice(2)
    if (!supported.has(key)) fail(`unknown option --${key}`)
    const next = values[i + 1]
    if (!next || next.startsWith('--')) {
      if (!booleanFlags.has(key)) fail(`missing value for --${key}`)
      parsed[key] = true
      continue
    }
    parsed[key] = next
    i += 1
  }
  return parsed
}

function fail(msg) { console.error(msg); process.exit(1) }
