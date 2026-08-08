import { blackScholes, capitalEfficiency, fundingRate, getDeltaBands, impermanentLoss, netCarry, netLpEfficiency, resolveDeltaSlope, uniswapV3Inventory } from '../formulas/core.js'
import { buildCostPath, deriveWindows } from './cost.js'
import { buildLpDataState } from './lpOnchain.js'
import { lpPoolCoverageMetrics } from './lpPoolMetrics.js'

export const FORMULA_PATH_FIELDS = {
  bandAnchor: { source: 'cost', unit: 'price', pane: 'priceBands', status: 'implemented', drawable: false },
  costAnchor: { source: 'cost', unit: 'price', pane: 'priceBands', status: 'implemented', drawable: true },
  costUpper: { source: 'cost', unit: 'price', pane: 'priceBands', status: 'implemented', drawable: true },
  costLower: { source: 'cost', unit: 'price', pane: 'priceBands', status: 'implemented', drawable: true },
  iv: { source: 'volatility', unit: 'return', pane: 'greeksPane', status: 'implemented', drawable: false },
  deltaLower: { source: 'delta-band', unit: 'price', pane: 'priceBands', status: 'implemented', drawable: true },
  deltaCost: { source: 'delta-band', unit: 'price', pane: 'priceBands', status: 'implemented', drawable: false },
  deltaUpper: { source: 'delta-band', unit: 'price', pane: 'priceBands', status: 'implemented', drawable: true },
  optionDelta: { source: 'option-greeks', unit: 'delta', pane: 'greeksPane', status: 'research-only', drawable: true },
  optionGamma: { source: 'option-greeks', unit: 'gamma', pane: 'greeksPane', status: 'research-only', drawable: true },
  optionThetaDaily: { source: 'option-greeks', unit: 'theta/day', pane: 'greeksPane', status: 'research-only', drawable: true },
  lpLowerPrice: { source: 'lp-inventory', unit: 'price', pane: 'priceBands', status: 'research-only', drawable: true },
  lpUpperPrice: { source: 'lp-inventory', unit: 'price', pane: 'priceBands', status: 'research-only', drawable: true },
  lpValue: { source: 'lp-inventory', unit: 'quote', pane: 'lpPane', status: 'research-only', drawable: true },
  lpInventoryDelta: { source: 'lp-inventory', unit: 'base', pane: 'lpPane', status: 'research-only', drawable: false },
  lpNormalizedDelta: { source: 'lp-inventory', unit: 'ratio', pane: 'lpPane', status: 'research-only', drawable: true },
  lpRealPrice: { source: 'lp-inventory', unit: 'price', pane: 'priceBands', status: 'research-only', drawable: true },
  lpRealDivergence: { source: 'lp-inventory', unit: 'return', pane: 'lpPane', status: 'research-only', drawable: true },
  lpPoolTurnover24h: { source: 'lp-pool-coverage', unit: 'return', pane: 'lpPane', status: 'research-only', drawable: true },
  lpPoolTopReserveShare: { source: 'lp-pool-coverage', unit: 'ratio', pane: 'lpPane', status: 'research-only', drawable: true },
  capitalEfficiency: { source: 'capital-efficiency', unit: 'multiple', pane: 'lpPane', status: 'research-only', drawable: true },
  impermanentLoss: { source: 'lp-inventory', unit: 'return', pane: 'lpPane', status: 'research-only', drawable: false },
  netLpEfficiency: { source: 'net-lp-efficiency', unit: 'return', pane: 'lpPane', status: 'research-only', drawable: false },
  fundingBasis: { source: 'funding', unit: 'return', pane: 'carryPane', status: 'proxy-only', drawable: false },
  fundingProxy: { source: 'funding', unit: 'return', pane: 'carryPane', status: 'proxy-only', drawable: true },
  netCarry: { source: 'net-carry', unit: 'return', pane: 'carryPane', status: 'proxy-only', drawable: true },
  breakEvenFunding: { source: 'net-carry', unit: 'return', pane: 'carryPane', status: 'proxy-only', drawable: false },
  status: { source: 'formula-path', unit: 'label', pane: 'researchMarkers', status: 'implemented', drawable: false, numeric: false },
  fieldStates: { source: 'formula-path', unit: 'metadata', pane: 'researchMarkers', status: 'implemented', drawable: false, numeric: false },
}

export const FORMULA_PATH_CURVES = Object.fromEntries(
  Object.entries(FORMULA_PATH_FIELDS).filter(([, meta]) => meta.drawable),
)

export function buildFormulaPath(rows, input) {
  if (!Array.isArray(rows) || rows.length < 2) return []
  const windows = deriveWindows(rows.length)
  const costPath = buildCostPath(rows, windows)
  const tdpy = Number(input.tradingDaysPerYear) || 365
  return rows.map((row, index) => {
    const iv = rollingAnnualVol(rows, index, tdpy, windows.vol) || Number(input.iv) || 0
    const bandAnchor = costPath[index]?.anchor || row.close
    const deltaSlope = resolveDeltaSlope(input)
    const deltaBands = getDeltaBands({
      entryPrice: bandAnchor,
      holdingDays: positive(input.holdingDays) || 30,
      iv,
      targetReturn: deltaSlope,
      tradingDaysPerYear: tdpy,
    })
    const scenarioStrike = input.pathUsesScenarioInputs ? positive(input.strikePrice) : null
    const scenarioStart = input.pathUsesScenarioInputs ? positive(input.startPrice) : null
    const optionState = fieldState({
      source: 'option-greeks',
      status: 'research-only',
      inputMode: scenarioStrike ? 'real' : 'inferred',
      missingInputs: scenarioStrike ? ['real-option-leg'] : ['real-option-leg', 'scenario-strike'],
    })
    const option = blackScholes({
      entryPrice: row.close,
      strikePrice: scenarioStrike || bandAnchor,
      holdingDays: positive(input.holdingDays) || 30,
      iv: iv || 0.01,
      riskFreeRate: Number(input.riskFreeRate) || 0,
      type: input.optionType,
      tradingDaysPerYear: tdpy,
    })
    const lowerPrice = lpLower(input, scenarioStart || bandAnchor)
    const upperPrice = lpUpper(input, scenarioStart || bandAnchor)
    const hasLiquidity = positive(input.liquidity) !== null
    const liquidity = positive(input.liquidity) ?? 1
    const lpDataState = buildLpDataState(input.lpOnchainSnapshot)
    const lpRealPrice = positive(lpDataState.quotePrice)
    const lpPoolMetrics = lpPoolCoverageMetrics(lpDataState.poolCoverage)
    const lpState = fieldState({
      source: 'lp-inventory',
      status: 'research-only',
      inputMode: lpDataState.inputMode,
      isSynthetic: lpDataState.isSynthetic,
      missingInputs: [
        ...lpDataState.missingInputs,
        hasLiquidity ? null : 'liquidity',
        scenarioStart ? null : 'startPrice',
      ].filter(Boolean),
      context: {
        pool: lpDataState.pool,
        blockNumber: lpDataState.blockNumber,
        fetchedAt: lpDataState.fetchedAt,
        quotePrice: lpDataState.quotePrice,
        quoteSymbol: lpDataState.quoteSymbol,
        poolCoverage: lpDataState.poolCoverage,
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
    const lp = uniswapV3Inventory({
      markPrice: row.close,
      lowerPrice,
      upperPrice,
      liquidity,
    })
    const ce = capitalEfficiency({ rangeWidth: rangeWidth(input), skew: Math.max(Number(input.skew) || 1, 0.01) })
    const il = impermanentLoss({ markPrice: row.close, startPrice: scenarioStart || bandAnchor, liquidity })
    const hasPerpTwap = positive(input.perpTwap) !== null
    const hasSpotTwap = positive(input.spotTwap) !== null
    const hasFundingInputs = hasPerpTwap && hasSpotTwap
    const fundingState = fieldState({
      source: 'funding',
      status: 'proxy-only',
      inputMode: hasFundingInputs ? 'real' : 'fallback',
      missingInputs: [
        'exchange-schedule',
        'settlement-history',
        hasPerpTwap ? null : 'perpTwap',
        hasSpotTwap ? null : 'spotTwap',
      ].filter(Boolean),
    })
    const funding = hasFundingInputs
      ? fundingRate({
        perpTwap: positive(input.perpTwap),
        spotTwap: positive(input.spotTwap),
        hours: (positive(input.holdingDays) || 30) * 24,
      })
      : null
    const carry = funding
      ? netCarry({ costDistance: bandAnchor > 0 ? (row.close - bandAnchor) / bandAnchor : 0, fundingRate: funding.cumulativeFundingEstimate, holdingDays: positive(input.holdingDays) || 30, tradingDaysPerYear: tdpy })
      : null
    const netLp = netLpEfficiency({ capitalEfficiency: ce?.efficiency, impermanentLoss: il?.impermanentLoss, feeRate: 0.003 })

    const fieldStates = buildFieldStates({ optionState, lpState, lpPoolState, fundingState })
    return {
      date: row.date,
      bandAnchor: finite(bandAnchor),
      costAnchor: finite(costPath[index]?.anchor),
      costUpper: finite(costPath[index]?.upper),
      costLower: finite(costPath[index]?.lower),
      iv: finite(iv),
      deltaLower: finite(deltaBands?.long.low),
      deltaCost: finite(deltaBands?.long.cost),
      deltaUpper: finite(deltaBands?.long.high),
      optionDelta: finite(option?.delta),
      optionGamma: finite(option?.gamma),
      optionThetaDaily: finite(option?.thetaDaily),
      lpLowerPrice: finite(lowerPrice),
      lpUpperPrice: finite(upperPrice),
      lpValue: finite(lp?.value),
      lpInventoryDelta: finite(lp?.inventoryDelta),
      lpNormalizedDelta: finite(normalizeInventory(lp, row.close)),
      lpRealPrice: finite(lpRealPrice),
      lpRealDivergence: finite(lpRealPrice ? (row.close - lpRealPrice) / lpRealPrice : null),
      lpPoolTurnover24h: finite(lpPoolMetrics.turnover24h),
      lpPoolTopReserveShare: finite(lpPoolMetrics.topReserveShare),
      capitalEfficiency: finite(ce?.efficiency),
      impermanentLoss: finite(il?.impermanentLoss),
      netLpEfficiency: finite(netLp?.totalNet),
      fundingBasis: finite(funding?.basisEstimate),
      fundingProxy: finite(funding?.cumulativeFundingEstimate),
      netCarry: finite(carry?.netReturn),
      breakEvenFunding: finite(carry?.breakEven),
      status: buildFormulaPathStatus({ optionState, fundingState, lpState, lpPoolState }),
      fieldStates,
    }
  })
}

function rollingAnnualVol(rows, index, tradingDaysPerYear = 365, volWindow = 60) {
  if (index < 2) return null
  const start = Math.max(1, index - volWindow + 1)
  const returns = []
  for (let i = start; i <= index; i += 1) {
    const previous = rows[i - 1]?.close
    const current = rows[i]?.close
    if (previous > 0 && current > 0) returns.push(Math.log(current / previous))
  }
  if (returns.length < 5) return null
  return standardDeviation(returns) * Math.sqrt(tradingDaysPerYear)
}

function lpLower(input, start) {
  const width = rangeWidth(input)
  return start * Math.max(1 - width, 0.001)
}

function lpUpper(input, start) {
  const width = rangeWidth(input)
  const skew = Math.max(Number(input.skew) || 1, 0.01)
  return start * (1 + width * skew)
}

function rangeWidth(input) {
  return Math.min(Math.max(Number(input.rangeWidth) || 0.1, 0.001), 0.95)
}

function normalizeInventory(lp, markPrice) {
  if (!lp || !Number.isFinite(lp.value) || lp.value <= 0 || markPrice <= 0) return null
  return (lp.inventoryDelta * markPrice) / lp.value
}

function standardDeviation(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(values.length - 1, 1)
  return Math.sqrt(variance)
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function finite(value) {
  return Number.isFinite(value) ? value : null
}

function fieldState({ source, status, inputMode, missingInputs = [], context = null, isSynthetic = inputMode !== 'real' }) {
  return {
    source,
    status,
    inputMode,
    missingInputs,
    isSynthetic,
    ...(context ? { context } : {}),
  }
}

function buildFieldStates({ optionState, lpState, lpPoolState, fundingState }) {
  const base = {
    bandAnchor: fieldState({ source: 'cost', status: 'implemented', inputMode: 'real' }),
    costAnchor: fieldState({ source: 'cost', status: 'implemented', inputMode: 'real' }),
    costUpper: fieldState({ source: 'cost', status: 'implemented', inputMode: 'real' }),
    costLower: fieldState({ source: 'cost', status: 'implemented', inputMode: 'real' }),
    iv: fieldState({ source: 'volatility', status: 'implemented', inputMode: 'real' }),
    deltaLower: fieldState({ source: 'delta-band', status: 'implemented', inputMode: 'real' }),
    deltaCost: fieldState({ source: 'delta-band', status: 'implemented', inputMode: 'real' }),
    deltaUpper: fieldState({ source: 'delta-band', status: 'implemented', inputMode: 'real' }),
  }
  for (const field of ['optionDelta', 'optionGamma', 'optionThetaDaily']) base[field] = optionState
  for (const field of ['lpLowerPrice', 'lpUpperPrice', 'lpValue', 'lpInventoryDelta', 'lpNormalizedDelta', 'lpRealPrice', 'lpRealDivergence', 'impermanentLoss', 'capitalEfficiency', 'netLpEfficiency']) base[field] = lpState
  for (const field of ['lpPoolTurnover24h', 'lpPoolTopReserveShare']) base[field] = lpPoolState
  for (const field of ['fundingBasis', 'fundingProxy', 'netCarry', 'breakEvenFunding']) base[field] = fundingState
  return base
}

function buildFormulaPathStatus({ optionState, fundingState, lpState, lpPoolState }) {
  const statuses = new Set()
  for (const state of [optionState, fundingState, lpState, lpPoolState]) {
    if (state?.status) statuses.add(state.status)
    if (state?.missingInputs?.length) statuses.add('missing-input')
    if (state?.isSynthetic) statuses.add(`${state.inputMode}-input`)
  }
  return [...statuses]
}
