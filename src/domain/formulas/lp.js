import { defineLegacyAliasContract } from './legacyAliases.js'

const V2_INVENTORY_LEGACY_CONTRACT = defineLegacyAliasContract({
  inventoryDelta: 'netInventoryDeltaToken0',
  fees: 'feeIncomeQuote',
})
const V3_INVENTORY_LEGACY_CONTRACT = defineLegacyAliasContract({ inventoryDelta: 'inventoryDeltaToken0' })
const FEE_INCOME_LEGACY_CONTRACT = defineLegacyAliasContract({
  fees: 'feeIncomeQuote',
  feeIncome: 'feeIncomeQuote',
})
const PORTFOLIO_CURVE_LEGACY_CONTRACT = defineLegacyAliasContract(
  {
    fees: 'feeIncomeQuote',
    fundingCost: 'fundingCashflowQuote',
  },
  {
    fundingCost: 'negate-cost-positive-to-cashflow-positive',
  },
)
const FULL_RANGE_IL_LEGACY_CONTRACT = defineLegacyAliasContract({ impermanentLoss: 'fullRangeV2IlProxy' })

export function uniswapV2Inventory({ markPrice, startPrice, liquidity, hedgeSize, feeIncomeQuote, fees }) {
  const fee = resolveFeeIncomeQuote(feeIncomeQuote, fees)
  if (![markPrice, startPrice, liquidity, hedgeSize, fee.value].every(Number.isFinite)) return null
  if (markPrice <= 0 || startPrice <= 0 || liquidity < 0) return null
  const unhedged = 2 * liquidity * (Math.sqrt(markPrice) - Math.sqrt(startPrice)) + fee.value
  const hedge = hedgeSize * (markPrice - startPrice)
  const lpInventoryDeltaToken0 = liquidity / Math.sqrt(markPrice)
  const netInventoryDeltaToken0 = lpInventoryDeltaToken0 - hedgeSize
  return {
    value: unhedged - hedge,
    unhedged,
    hedged: unhedged - hedge,
    lpInventoryDeltaToken0,
    netInventoryDeltaToken0,
    // Deprecated compatibility alias. LP inventory sensitivity must not use the naked option-Greek name `delta`.
    inventoryDelta: netInventoryDeltaToken0,
    neutralHedgeAtStart: liquidity / Math.sqrt(startPrice),
    feeIncomeQuote: fee.value,
    feeInputSemantics: fee.semantics,
    feeIncomeUnit: 'quote-currency',
    ...V2_INVENTORY_LEGACY_CONTRACT,
  }
}

export function uniswapV3Inventory({ markPrice, lowerPrice, upperPrice, liquidity }) {
  if (![markPrice, lowerPrice, upperPrice, liquidity].every(Number.isFinite)) return null
  if (markPrice <= 0 || lowerPrice <= 0 || upperPrice <= lowerPrice || liquidity < 0) return null

  const sqrtP = Math.sqrt(markPrice)
  const sqrtLower = Math.sqrt(lowerPrice)
  const sqrtUpper = Math.sqrt(upperPrice)
  let token0 = 0
  let token1 = 0

  if (markPrice <= lowerPrice) {
    token0 = liquidity * (1 / sqrtLower - 1 / sqrtUpper)
  } else if (markPrice >= upperPrice) {
    token1 = liquidity * (sqrtUpper - sqrtLower)
  } else {
    token0 = liquidity * (1 / sqrtP - 1 / sqrtUpper)
    token1 = liquidity * (sqrtP - sqrtLower)
  }

  return {
    token0,
    token1,
    value: token0 * markPrice + token1,
    inventoryDeltaToken0: token0,
    // Deprecated compatibility alias. New consumers use the unit-bearing canonical field above.
    inventoryDelta: token0,
    ...V3_INVENTORY_LEGACY_CONTRACT,
    zone: markPrice <= lowerPrice ? 'token0' : markPrice >= upperPrice ? 'token1' : 'range',
    status: 'research-only',
  }
}

export function uniswapV3Payoff(price, strikePrice, rangeFactor) {
  if (![price, strikePrice, rangeFactor].every(Number.isFinite)) return null
  if (price <= 0 || strikePrice <= 0 || rangeFactor <= 1) return null
  const lower = strikePrice / rangeFactor
  const upper = strikePrice * rangeFactor
  if (price <= lower) return { value: price, zone: 'token0' }
  if (price >= upper) return { value: strikePrice, zone: 'token1' }
  return {
    value: (2 * Math.sqrt(price * strikePrice * rangeFactor) - price - strikePrice) / (rangeFactor - 1),
    zone: 'range',
  }
}

export function uniswapV3HedgedInventory({
  markPrice,
  strikePrice,
  rangeFactor,
  liquidity,
  hedgeSize,
  feeIncomeQuote,
  fees,
}) {
  const fee = resolveFeeIncomeQuote(feeIncomeQuote, fees)
  if (![markPrice, strikePrice, rangeFactor, liquidity, hedgeSize, fee.value].every(Number.isFinite)) return null
  if (markPrice <= 0 || strikePrice <= 0 || rangeFactor <= 1 || liquidity < 0) return null

  const currentPayoff = uniswapV3Payoff(markPrice, strikePrice, rangeFactor)
  const entryPayoff = uniswapV3Payoff(strikePrice, strikePrice, rangeFactor)
  if (!currentPayoff || !entryPayoff) return null

  const lpPnl = liquidity * (currentPayoff.value - entryPayoff.value)
  const hedgePnl = hedgeSize * (markPrice - strikePrice)
  const feeIncome = fee.value

  return {
    value: lpPnl - hedgePnl + feeIncome,
    lpPnl,
    hedgePnl,
    feeIncome,
    feeIncomeQuote: fee.value,
    feeInputSemantics: fee.semantics,
    feeIncomeUnit: 'quote-currency',
    ...FEE_INCOME_LEGACY_CONTRACT,
    lowerPrice: strikePrice / rangeFactor,
    upperPrice: strikePrice * rangeFactor,
    zone: currentPayoff.zone,
  }
}

export function uniswapV3HedgedPosition({
  markPrice,
  startPrice,
  lowerPrice,
  upperPrice,
  liquidity,
  hedgeSize = 0,
  feeIncomeQuote,
  fees,
}) {
  const fee = resolveFeeIncomeQuote(feeIncomeQuote, fees)
  if (![markPrice, startPrice, lowerPrice, upperPrice, liquidity, hedgeSize, fee.value].every(Number.isFinite))
    return null
  if (markPrice <= 0 || startPrice <= 0 || lowerPrice <= 0 || upperPrice <= lowerPrice || liquidity < 0) return null

  const current = uniswapV3Inventory({ markPrice, lowerPrice, upperPrice, liquidity })
  const entry = uniswapV3Inventory({ markPrice: startPrice, lowerPrice, upperPrice, liquidity })
  if (!current || !entry) return null

  const lpPnl = current.value - entry.value
  const hedgePnl = -hedgeSize * (markPrice - startPrice)
  const feeIncome = fee.value
  const combinedValue = lpPnl + hedgePnl + feeIncome
  return {
    value: combinedValue,
    combinedValue,
    lpPnl,
    hedgePnl,
    feeIncome,
    feeIncomeQuote: fee.value,
    feeInputSemantics: fee.semantics,
    feeIncomeUnit: 'quote-currency',
    ...FEE_INCOME_LEGACY_CONTRACT,
    lowerPrice,
    upperPrice,
    startPrice,
    zone: markPrice <= lowerPrice ? 'token0' : markPrice >= upperPrice ? 'token1' : 'range',
    status: 'research-only',
  }
}

export function fullRangeV2ImpermanentLoss({ markPrice, startPrice, liquidity }) {
  if (![markPrice, startPrice, liquidity].every(Number.isFinite)) return null
  if (markPrice <= 0 || startPrice <= 0 || liquidity <= 0) return null

  const sqrtMark = Math.sqrt(markPrice)
  const sqrtStart = Math.sqrt(startPrice)
  const lpValue = 2 * liquidity * sqrtMark
  const holdValue = liquidity * sqrtStart + (liquidity / sqrtStart) * markPrice
  const lpEntryValue = 2 * liquidity * sqrtStart

  const fullRangeV2IlProxy = (lpValue - holdValue) / holdValue
  return {
    lpValue,
    holdValue,
    lpEntryValue,
    fullRangeV2IlProxy,
    impermanentGain: -fullRangeV2IlProxy,
    borrowedLpValue: -lpValue,
    borrowedHoldValue: -holdValue,
    model: 'constant-product-v2-full-range-no-fees',
    claimClass: 'scenario-proxy',
  }
}

export function rangeV3ImpermanentLoss({ markPrice, startPrice, lowerPrice, upperPrice, liquidity }) {
  if (![markPrice, startPrice, lowerPrice, upperPrice, liquidity].every(Number.isFinite)) return null
  if (markPrice <= 0 || startPrice <= 0 || lowerPrice <= 0 || upperPrice <= lowerPrice || liquidity <= 0) return null

  const entry = uniswapV3Inventory({ markPrice: startPrice, lowerPrice, upperPrice, liquidity })
  const current = uniswapV3Inventory({ markPrice, lowerPrice, upperPrice, liquidity })
  if (!entry || !current) return null
  const holdValue = entry.token0 * markPrice + entry.token1
  const rangeV3Il = holdValue > 0 ? (current.value - holdValue) / holdValue : null
  return {
    rangeV3Il,
    lpValue: current.value,
    holdValue,
    lpEntryValue: entry.value,
    entryInventory: { token0: entry.token0, token1: entry.token1 },
    currentInventory: { token0: current.token0, token1: current.token1 },
    lowerPrice,
    upperPrice,
    startPrice,
    markPrice,
    model: 'uniswap-v3-same-range-same-entry-inventory-no-fees',
    claimClass: 'scenario-proxy',
  }
}

/** @deprecated Use fullRangeV2ImpermanentLoss and read fullRangeV2IlProxy. */
export function impermanentLoss(input) {
  const canonical = fullRangeV2ImpermanentLoss(input)
  return canonical
    ? {
        ...canonical,
        impermanentLoss: canonical.fullRangeV2IlProxy,
        ...FULL_RANGE_IL_LEGACY_CONTRACT,
      }
    : null
}

export function hedgedLpPortfolioCurve({
  startPrice,
  lowerPrice,
  upperPrice,
  liquidity,
  hedgeSize = 0,
  optionPricer = null,
  optionWeight = 0,
  feeIncomeQuote,
  fees,
  fundingCashflowQuote,
  fundingCashflowSource,
  fundingCost: legacyFundingCost,
  steps = 80,
  minFactor = 0.55,
  maxFactor = 1.45,
}) {
  const fee = resolveFeeIncomeQuote(feeIncomeQuote, fees)
  const funding = resolveFundingCashflowQuote({
    fundingCashflowQuote,
    fundingCashflowSource,
    legacyFundingCost,
  })
  if (
    ![startPrice, lowerPrice, upperPrice, liquidity, hedgeSize, optionWeight, fee.value, funding.value].every(
      Number.isFinite,
    )
  )
    return null
  if (startPrice <= 0 || lowerPrice <= 0 || upperPrice <= lowerPrice || liquidity < 0 || steps < 2) return null
  const baseLp = uniswapV3Inventory({ markPrice: startPrice, lowerPrice, upperPrice, liquidity })
  if (!baseLp) return null
  const min = Math.max(0.0001, Math.min(lowerPrice, startPrice) * minFactor)
  const max = Math.max(upperPrice, startPrice) * maxFactor
  const points = []
  for (let i = 0; i <= steps; i += 1) {
    const price = min + ((max - min) * i) / steps
    const lp = uniswapV3Inventory({ markPrice: price, lowerPrice, upperPrice, liquidity })
    if (!lp) continue
    const lpPnl = lp.value - baseLp.value
    const optionValue = typeof optionPricer === 'function' ? Number(optionPricer(price)) || 0 : 0
    const hedgePnl = -hedgeSize * (price - startPrice)
    const combined = lpPnl + optionWeight * optionValue + hedgePnl + fee.value + funding.value
    points.push({
      price,
      lpPnl,
      optionValue,
      hedgePnl,
      feeIncomeQuote: fee.value,
      fundingCashflowQuote: funding.value,
      combined,
    })
  }
  return {
    points,
    min,
    max,
    startPrice,
    lowerPrice,
    upperPrice,
    feeIncomeQuote: fee.value,
    feeInputSemantics: fee.semantics,
    feeIncomeUnit: 'quote-currency',
    fundingCashflowQuote: funding.value,
    fundingCashflowSource: funding.source,
    fundingInputSemantics: funding.semantics,
    fundingCashflowUnit: 'quote-currency-signed-positive-receipt',
    // Deprecated cost-positive output retained only at this adapter boundary.
    fundingCost: -funding.value,
    ...PORTFOLIO_CURVE_LEGACY_CONTRACT,
    note: 'research-only: LP + option + hedge + quote-currency fee income + signed funding cashflow curve',
  }
}

export function portfolioValue({ lpValue, optionValue, fundingCashflowQuote }) {
  if (![lpValue, optionValue, fundingCashflowQuote].every(Number.isFinite)) return null
  return lpValue + optionValue + fundingCashflowQuote
}

function resolveFeeIncomeQuote(feeIncomeQuote, legacyFees) {
  if (Number.isFinite(feeIncomeQuote)) {
    return { value: feeIncomeQuote, semantics: 'canonical-fee-income-quote' }
  }
  if (Number.isFinite(legacyFees)) {
    return { value: legacyFees, semantics: 'deprecated-legacy-fees-as-quote-currency' }
  }
  return { value: null, semantics: 'missing-fee-income-quote' }
}

function resolveFundingCashflowQuote({ fundingCashflowQuote, fundingCashflowSource, legacyFundingCost }) {
  const validCanonicalSource = ['observed-settlement', 'explicit-scenario'].includes(fundingCashflowSource)
  if (Number.isFinite(fundingCashflowQuote) && validCanonicalSource) {
    return {
      value: fundingCashflowQuote,
      source: fundingCashflowSource,
      semantics: 'canonical-signed-funding-cashflow-quote',
    }
  }
  if (Number.isFinite(legacyFundingCost)) {
    return {
      value: -legacyFundingCost,
      source: 'deprecated-legacy-funding-cost',
      semantics: 'deprecated-cost-positive-fundingCost-negated-to-signed-cashflow',
    }
  }
  return { value: null, source: null, semantics: 'missing-signed-funding-cashflow-and-source' }
}
