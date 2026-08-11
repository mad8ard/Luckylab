import {
  blackScholes,
  capitalEfficiency,
  fullRangeV2ImpermanentLoss,
  estimateCumulativeFundingProxy,
  getDeltaBands,
  netCarry,
  rangeV3ImpermanentLoss,
  resolveDeltaSlope,
  uniswapV3Inventory,
} from '../formulas/core.js'
import { resolveLpValuationSpec } from '../lp/lpValuationSpec.js'
import { buildCostPath } from './cost.js'
import { buildFormulaModelContext, buildFormulaPointModelMetadata } from './modelVersion.js'
import { buildLpDataState } from './lpOnchain.js'
import { lpPoolCoverageMetrics } from './lpPoolMetrics.js'
import { classifyFormulaDeltaAvailability, classifyFormulaHorizonAvailability } from './formulaPathAvailability.js'
import { resolveFormulaPathHorizon } from './formulaPathHorizon.js'
import { deriveFormulaPathLpResearchRange } from './formulaPathLpResearchRange.js'
import { resolveFormulaPathVolatility } from './formulaPathVolatility.js'
export { FORMULA_PATH_CURVES, FORMULA_PATH_FIELDS } from './formulaPathFields.js'

export function buildFormulaPath(rows, input = {}) {
  if (!Array.isArray(rows) || rows.length < 2) return []
  const tdpy = positive(input.tradingDaysPerYear)
  const costPath = buildCostPath(rows, null, tdpy)
  const costDistancePath = costPath.map((cost, index) =>
    cost?.anchor > 0 && rows[index]?.close > 0 ? (rows[index].close - cost.anchor) / cost.anchor : null,
  )
  const lpDataState = buildLpDataState(input.lpOnchainSnapshot)
  const lpValuation = resolveLpValuationSpec({ input, lpDataState })
  const lpPoolMetrics = lpPoolCoverageMetrics(lpDataState.poolCoverage)
  return rows.map((row, index) => {
    const metadata = buildFormulaPointModelMetadata({ costPoint: costPath[index], row, tradingDaysPerYear: tdpy })
    const { modelVersion, bandAnchor } = metadata
    const volatility = resolveFormulaPathVolatility({
      rows,
      index,
      tradingDaysPerYear: tdpy,
      volWindow: metadata.modelContext.windowSpec.vol,
      scenarioIv: input.pathUsesScenarioInputs ? input.iv : null,
    })
    const iv = volatility.value
    const horizon = resolveFormulaPathHorizon({ rows, index, costPath, costDistancePath, input, tdpy })
    const formulaHorizonSessions = horizon?.eligible ? horizon.modelHorizonSessions : null
    const horizonAvailability = classifyFormulaHorizonAvailability(horizon)
    const deltaSlope = resolveDeltaSlope(input)
    const deltaBands = formulaHorizonSessions
      ? getDeltaBands({
          entryPrice: bandAnchor,
          formulaHorizonSessions,
          iv,
          deltaSlope,
          tradingDaysPerYear: tdpy,
        })
      : null
    const deltaAvailability = classifyFormulaDeltaAvailability({
      deltaBands,
      horizonAvailability,
      volatilityAvailability: volatility,
      tradingDaysPerYear: tdpy,
      deltaSlope,
    })
    const modelContext = buildFormulaModelContext(metadata, {
      iv,
      ivSource:
        volatility.status === 'model-gate-failed' ? 'rolling-log-return-volatility-degenerate-zero' : volatility.source,
      deltaSlope,
      deltaSlopeSource: Number.isFinite(deltaSlope) ? 'input' : 'missing',
      formulaHorizonSessions,
      horizon,
    })
    const horizonState = fieldState({
      source: 'dynamic-holding-state',
      status: horizonAvailability.status,
      inputMode: horizon?.mode ?? 'formula-derived',
      missingInputs: horizonAvailability.missingInputs,
      blockedReasons: horizonAvailability.blockedReasons,
      isSynthetic: true,
      context: horizon ? { ...horizon, modelVersion, ...modelContext } : null,
    })
    const deltaState = fieldState({
      source: 'delta-band',
      status: deltaAvailability.status,
      inputMode: horizon?.mode ?? 'formula-derived',
      missingInputs: deltaAvailability.missingInputs,
      blockedReasons: deltaAvailability.blockedReasons,
      isSynthetic: true,
      context: { horizon: horizon ?? null, modelVersion, ...modelContext },
    })
    const scenarioStrike = input.pathUsesScenarioInputs ? positive(input.strikePrice) : null
    const scenarioOptionTenorSessions = input.pathUsesScenarioInputs ? positive(input.optionTenorSessions) : null
    const optionScenarioReady = Boolean(scenarioStrike && scenarioOptionTenorSessions && iv && tdpy)
    const optionState = fieldState({
      source: 'option-greeks',
      status: optionScenarioReady ? 'research-only' : 'missing-input',
      inputMode: optionScenarioReady ? 'scenario' : 'missing-input',
      missingInputs: [
        'real-option-leg',
        scenarioStrike ? null : 'scenario-strike',
        scenarioOptionTenorSessions ? null : 'explicit-option-tenor-sessions',
        iv ? null : 'realized-volatility',
        tdpy ? null : 'trading-days-per-year',
      ].filter(Boolean),
    })
    const option = optionScenarioReady
      ? blackScholes({
          entryPrice: row.close,
          strikePrice: scenarioStrike,
          timeToExpirySessions: scenarioOptionTenorSessions,
          iv,
          riskFreeRate: Number(input.riskFreeRate) || 0,
          type: input.optionType,
          tradingDaysPerYear: tdpy,
        })
      : null
    const lpResearchRange = deriveFormulaPathLpResearchRange({
      bandAnchor,
      deltaBands,
      horizon,
      iv,
      tradingDaysPerYear: tdpy,
      deltaAvailability,
    })
    const lpDisplayRange = lpValuation.available
      ? {
          status: 'research-only',
          available: true,
          source: 'lp-inventory',
          inputMode: lpValuation.mode,
          isSynthetic: lpValuation.isSynthetic,
          missingInputs: [],
          executionAuthority: 'none',
          claimClass: 'scenario-proxy',
          lowerPrice: lpValuation.lowerPrice,
          upperPrice: lpValuation.upperPrice,
          availableAt: lpValuation.availableAt,
          valuationBasis: lpValuation.valuationBasis,
        }
      : lpResearchRange
    const rangeSpec = lpValuation.rangeSpec
    const positionLowerPrice = lpValuation.lowerPrice
    const positionUpperPrice = lpValuation.upperPrice
    const liquidity = lpValuation.liquidity
    // Pool snapshots are observed at one fetch time, not a historical price
    // series.  Writing the same quote into every candle would manufacture a
    // non-causal divergence curve, so expose it only on the observed row.
    const observedLpSnapshot = index === rows.length - 1
    const lpRealPrice = observedLpSnapshot ? positive(lpDataState.quotePrice) : null
    const lpPoolTurnover24h = observedLpSnapshot ? lpPoolMetrics.turnover24h : null
    const lpPoolTopReserveShare = observedLpSnapshot ? lpPoolMetrics.topReserveShare : null
    const lpState = fieldState({
      source: 'lp-inventory',
      status: lpValuation.available ? 'research-only' : 'missing-input',
      inputMode: lpValuation.mode,
      isSynthetic: lpValuation.isSynthetic,
      missingInputs: lpValuation.missingInputs,
      context: {
        valuationBasis: lpValuation.valuationBasis,
        availableAt: lpValuation.availableAt,
        declaredScenario: input.lpScenarioEnabled === true,
        pool: lpDataState.pool,
        blockNumber: lpDataState.blockNumber,
        fetchedAt: lpDataState.fetchedAt,
        quotePrice: lpDataState.quotePrice,
        quoteSymbol: lpDataState.quoteSymbol,
        poolCoverage: lpDataState.poolCoverage,
      },
    })
    const lpRangeState = fieldState({
      source: lpDisplayRange.source,
      status: lpDisplayRange.status,
      inputMode: lpDisplayRange.inputMode,
      isSynthetic: lpDisplayRange.isSynthetic,
      missingInputs: lpDisplayRange.missingInputs,
      blockedReasons: lpDisplayRange.blockedReasons,
      context: {
        ...lpDisplayRange,
        notAPosition: !lpValuation.available,
        valuationAuthority: 'none',
      },
    })
    const lpPoolState = fieldState({
      source: 'lp-pool-coverage',
      status: 'research-only',
      inputMode: lpDataState.inputMode,
      isSynthetic: lpDataState.inputMode === 'fallback',
      missingInputs: [
        lpDataState.inputMode === 'fallback' ? 'real-lp-pool' : null,
        'tick-liquidity-history',
        'lp-add-remove-events',
      ].filter(Boolean),
      context: {
        poolCoverage: lpDataState.poolCoverage,
        fetchedAt: lpDataState.fetchedAt,
        blockNumber: lpDataState.blockNumber,
      },
    })
    const lp = lpValuation.available
      ? uniswapV3Inventory({
          markPrice: row.close,
          lowerPrice: positionLowerPrice,
          upperPrice: positionUpperPrice,
          liquidity,
        })
      : null
    const ce = lpValuation.available
      ? capitalEfficiency({ rangeWidth: rangeSpec.rangeWidth, skew: rangeSpec.skew })
      : null
    const ilStartPrice = lpValuation.startPrice
    const fullRangeV2Il = lpValuation.available
      ? fullRangeV2ImpermanentLoss({
          markPrice: row.close,
          startPrice: ilStartPrice,
          liquidity,
        })
      : null
    const rangeV3Il = lpValuation.available
      ? rangeV3ImpermanentLoss({
          markPrice: row.close,
          startPrice: ilStartPrice,
          lowerPrice: positionLowerPrice,
          upperPrice: positionUpperPrice,
          liquidity,
        })
      : null
    const hasPerpTwap = positive(input.perpTwap) !== null
    const hasSpotTwap = positive(input.spotTwap) !== null
    const hasFundingInputs = hasPerpTwap && hasSpotTwap
    const fundingSessionDurationHours = positive(input.fundingSessionDurationHours)
    const fundingSessionCalendarId = nonEmptyString(input.fundingSessionCalendarId)
    const fundingPositionSide = ['long', 'short'].includes(input.fundingPositionSide) ? input.fundingPositionSide : null
    const recoveryNotionalBasis = nonEmptyString(input.recoveryNotionalBasis)
    const fundingNotionalBasis = nonEmptyString(input.fundingNotionalBasis)
    const fundingState = fieldState({
      source: 'funding',
      status: 'proxy-only',
      inputMode: hasFundingInputs ? 'real' : 'fallback',
      missingInputs: [
        'exchange-schedule',
        'settlement-history',
        hasPerpTwap ? null : 'perpTwap',
        hasSpotTwap ? null : 'spotTwap',
        formulaHorizonSessions ? null : 'formula-derived-horizon',
        fundingSessionDurationHours ? null : 'funding-session-duration-hours',
      ].filter(Boolean),
    })
    const funding =
      hasFundingInputs && formulaHorizonSessions && fundingSessionDurationHours
        ? estimateCumulativeFundingProxy({
            perpTwap: positive(input.perpTwap),
            spotTwap: positive(input.spotTwap),
            horizonHours: formulaHorizonSessions * fundingSessionDurationHours,
          })
        : null
    const carry = funding
      ? netCarry({
          cycleStartPrice: horizon?.cycleStartPrice,
          targetPrice: horizon?.targetPrice,
          side: horizon?.side,
          cumulativeFundingProxy: funding.cumulativeFundingProxy,
          fundingPositionSide,
          recoveryNotionalBasis,
          fundingNotionalBasis,
          fundingHorizonHours: funding.horizonHours,
          comparisonHorizon: {
            sessions: formulaHorizonSessions,
            sessionDurationHours: fundingSessionDurationHours,
            sessionCalendarId: fundingSessionCalendarId,
            source: horizon?.targetSource ?? horizon?.mode,
            availableAt: horizon?.availableAt,
          },
        })
      : null
    const carryState = fieldState({
      source: 'net-carry',
      status: carry ? 'proxy-only' : 'missing-input',
      inputMode: carry ? 'explicit-scenario' : 'missing-input',
      missingInputs: [
        funding ? null : 'cumulative-funding-proxy',
        horizon?.targetPrice ? null : 'target-price',
        horizon?.side ? null : 'recovery-side',
        fundingPositionSide ? null : 'funding-position-side',
        fundingSessionCalendarId ? null : 'funding-session-calendar-id',
        recoveryNotionalBasis ? null : 'recovery-notional-basis',
        recoveryNotionalBasis && recoveryNotionalBasis === fundingNotionalBasis ? null : 'common-notional-basis',
      ].filter(Boolean),
      context: carry?.comparisonHorizon ?? null,
    })

    const fieldStates = buildFieldStates({
      volatilityState: fieldState({
        source: 'volatility',
        status: volatility.status,
        inputMode: volatility.inputMode,
        missingInputs: volatility.missingInputs,
        blockedReasons: volatility.blockedReasons,
        isSynthetic: volatility.isSynthetic,
        context: volatility,
      }),
      horizonState,
      deltaState,
      optionState,
      lpRangeState,
      lpState,
      lpPoolState,
      fundingState,
      carryState,
    })
    return {
      modelVersion,
      modelContext,
      date: row.date,
      bandAnchor: finite(bandAnchor),
      costAnchor: finite(costPath[index]?.anchor),
      costUpper: finite(costPath[index]?.upper),
      costLower: finite(costPath[index]?.lower),
      iv: finite(iv),
      formulaHorizonSessions: finite(formulaHorizonSessions),
      recoveryFraction: finite(horizon?.recoveryFraction),
      deltaLower: finite(deltaBands?.long.low),
      deltaCost: finite(deltaBands?.long.cost),
      deltaUpper: finite(deltaBands?.long.high),
      optionDelta: finite(option?.optionDelta),
      optionGamma: finite(option?.optionGamma),
      optionThetaPerSession: finite(option?.optionThetaPerSession),
      lpLowerPrice: finite(lpDisplayRange.lowerPrice),
      lpUpperPrice: finite(lpDisplayRange.upperPrice),
      lpValue: finite(lp?.value),
      lpInventoryDeltaToken0: finite(lp?.inventoryDeltaToken0),
      lpNormalizedDelta: finite(normalizeInventory(lp, row.close)),
      lpRealPrice: finite(lpRealPrice),
      lpRealDivergence: finite(lpRealPrice ? (row.close - lpRealPrice) / lpRealPrice : null),
      lpPoolTurnover24h: finite(lpPoolTurnover24h),
      lpPoolTopReserveShare: finite(lpPoolTopReserveShare),
      capitalEfficiency: finite(ce?.efficiency),
      fullRangeV2IlProxy: finite(fullRangeV2Il?.fullRangeV2IlProxy),
      rangeV3Il: finite(rangeV3Il?.rangeV3Il),
      netLpEfficiency: null,
      fundingBasis: finite(funding?.basisFraction),
      cumulativeFundingProxy: finite(funding?.cumulativeFundingProxy),
      netCarry: finite(carry?.netReturn),
      breakEvenFundingNetCostReturn: finite(carry?.breakEvenFundingNetCostReturn),
      status: buildFormulaPathStatus({
        horizonState,
        deltaState,
        optionState,
        fundingState,
        lpRangeState,
        lpState,
        lpPoolState,
      }),
      fieldStates,
    }
  })
}
function normalizeInventory(lp, markPrice) {
  if (!lp || !Number.isFinite(lp.value) || lp.value <= 0 || markPrice <= 0) return null
  return (lp.inventoryDeltaToken0 * markPrice) / lp.value
}
function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}
function finite(value) {
  return Number.isFinite(value) ? value : null
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function fieldState({
  source,
  status,
  inputMode,
  missingInputs = [],
  blockedReasons = [],
  context = null,
  isSynthetic = inputMode !== 'real',
}) {
  return {
    source,
    status,
    inputMode,
    missingInputs,
    blockedReasons,
    isSynthetic,
    ...(context ? { context } : {}),
  }
}

function buildFieldStates({
  volatilityState,
  horizonState,
  deltaState,
  optionState,
  lpRangeState,
  lpState,
  lpPoolState,
  fundingState,
  carryState,
}) {
  const base = {
    bandAnchor: fieldState({ source: 'cost', status: 'implemented', inputMode: 'real' }),
    costAnchor: fieldState({ source: 'cost', status: 'implemented', inputMode: 'real' }),
    costUpper: fieldState({ source: 'cost', status: 'implemented', inputMode: 'real' }),
    costLower: fieldState({ source: 'cost', status: 'implemented', inputMode: 'real' }),
    iv: volatilityState,
    formulaHorizonSessions: horizonState,
    recoveryFraction: horizonState,
    deltaLower: deltaState,
    deltaCost: deltaState,
    deltaUpper: deltaState,
  }
  for (const field of ['optionDelta', 'optionGamma', 'optionThetaPerSession']) base[field] = optionState
  for (const field of ['lpLowerPrice', 'lpUpperPrice']) base[field] = lpRangeState
  for (const field of [
    'lpValue',
    'lpInventoryDeltaToken0',
    'lpNormalizedDelta',
    'fullRangeV2IlProxy',
    'rangeV3Il',
    'capitalEfficiency',
    'netLpEfficiency',
  ])
    base[field] = lpState
  for (const field of ['lpRealPrice', 'lpRealDivergence', 'lpPoolTurnover24h', 'lpPoolTopReserveShare'])
    base[field] = lpPoolState
  for (const field of ['fundingBasis', 'cumulativeFundingProxy']) base[field] = fundingState
  for (const field of ['netCarry', 'breakEvenFundingNetCostReturn']) base[field] = carryState
  return base
}

function buildFormulaPathStatus({
  horizonState,
  deltaState,
  optionState,
  fundingState,
  lpRangeState,
  lpState,
  lpPoolState,
}) {
  const statuses = new Set()
  for (const state of [horizonState, deltaState, optionState, fundingState, lpRangeState, lpState, lpPoolState]) {
    if (state?.status) statuses.add(state.status)
    if (state?.missingInputs?.length) statuses.add('missing-input')
    if (state?.isSynthetic) statuses.add(`${state.inputMode}-input`)
  }
  return [...statuses]
}
