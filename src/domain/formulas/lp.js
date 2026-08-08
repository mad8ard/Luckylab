export function uniswapV2Inventory({ markPrice, startPrice, liquidity, hedgeSize, fees }) {
  if (![markPrice, startPrice, liquidity, hedgeSize, fees].every(Number.isFinite)) return null
  if (markPrice <= 0 || startPrice <= 0 || liquidity < 0) return null
  const unhedged = 2 * liquidity * (Math.sqrt(markPrice) - Math.sqrt(startPrice)) + fees
  const hedge = hedgeSize * (markPrice - startPrice)
  return {
    value: unhedged - hedge,
    unhedged,
    hedged: unhedged - hedge,
    inventoryDelta: liquidity / Math.sqrt(markPrice) - hedgeSize,
    delta: liquidity / Math.sqrt(markPrice) - hedgeSize,
    neutralHedgeAtStart: liquidity / Math.sqrt(startPrice),
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
    inventoryDelta: token0,
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

export function uniswapV3HedgedInventory({ markPrice, strikePrice, rangeFactor, liquidity, hedgeSize, fees }) {
  if (![markPrice, strikePrice, rangeFactor, liquidity, hedgeSize, fees].every(Number.isFinite)) return null
  if (markPrice <= 0 || strikePrice <= 0 || rangeFactor <= 1 || liquidity < 0) return null

  const currentPayoff = uniswapV3Payoff(markPrice, strikePrice, rangeFactor)
  const entryPayoff = uniswapV3Payoff(strikePrice, strikePrice, rangeFactor)
  if (!currentPayoff || !entryPayoff) return null

  const lpPnl = liquidity * (currentPayoff.value - entryPayoff.value)
  const hedgePnl = hedgeSize * (markPrice - strikePrice)
  const feeIncome = fees * strikePrice

  return {
    value: lpPnl - hedgePnl + feeIncome,
    lpPnl,
    hedgePnl,
    feeIncome,
    lowerPrice: strikePrice / rangeFactor,
    upperPrice: strikePrice * rangeFactor,
    zone: currentPayoff.zone,
  }
}

export function uniswapV3HedgedPosition({ markPrice, startPrice, lowerPrice, upperPrice, liquidity, hedgeSize = 0, fees = 0 }) {
  if (![markPrice, startPrice, lowerPrice, upperPrice, liquidity, hedgeSize, fees].every(Number.isFinite)) return null
  if (markPrice <= 0 || startPrice <= 0 || lowerPrice <= 0 || upperPrice <= lowerPrice || liquidity < 0) return null

  const current = uniswapV3Inventory({ markPrice, lowerPrice, upperPrice, liquidity })
  const entry = uniswapV3Inventory({ markPrice: startPrice, lowerPrice, upperPrice, liquidity })
  if (!current || !entry) return null

  const lpPnl = current.value - entry.value
  const hedgePnl = -hedgeSize * (markPrice - startPrice)
  const feeIncome = fees
  const combinedValue = lpPnl + hedgePnl + feeIncome
  return {
    value: combinedValue,
    combinedValue,
    lpPnl,
    hedgePnl,
    feeIncome,
    lowerPrice,
    upperPrice,
    startPrice,
    zone: markPrice <= lowerPrice ? 'token0' : markPrice >= upperPrice ? 'token1' : 'range',
    status: 'research-only',
  }
}

export function impermanentLoss({ markPrice, startPrice, liquidity }) {
  if (![markPrice, startPrice, liquidity].every(Number.isFinite)) return null
  if (markPrice <= 0 || startPrice <= 0 || liquidity < 0) return null

  const sqrtMark = Math.sqrt(markPrice)
  const sqrtStart = Math.sqrt(startPrice)
  const lpValue = 2 * liquidity * sqrtMark
  const holdValue = liquidity * sqrtStart + (liquidity / sqrtStart) * markPrice
  const lpEntryValue = 2 * liquidity * sqrtStart

  return {
    lpValue,
    holdValue,
    lpEntryValue,
    impermanentLoss: holdValue > 0 ? (lpValue - holdValue) / holdValue : 0,
    impermanentGain: holdValue > 0 ? -(lpValue - holdValue) / holdValue : 0,
    borrowedLpValue: -lpValue,
    borrowedHoldValue: -holdValue,
  }
}

export function hedgedLpPortfolioCurve({
  startPrice,
  lowerPrice,
  upperPrice,
  liquidity,
  hedgeSize = 0,
  optionPricer = null,
  optionWeight = 0,
  fees = 0,
  fundingCost = 0,
  steps = 80,
  minFactor = 0.55,
  maxFactor = 1.45,
}) {
  if (![startPrice, lowerPrice, upperPrice, liquidity, hedgeSize, optionWeight, fees, fundingCost].every(Number.isFinite)) return null
  if (startPrice <= 0 || lowerPrice <= 0 || upperPrice <= lowerPrice || liquidity < 0 || steps < 2) return null
  const baseLp = uniswapV3Inventory({ markPrice: startPrice, lowerPrice, upperPrice, liquidity })
  if (!baseLp) return null
  const min = Math.max(0.0001, Math.min(lowerPrice, startPrice) * minFactor)
  const max = Math.max(upperPrice, startPrice) * maxFactor
  const points = []
  for (let i = 0; i <= steps; i += 1) {
    const price = min + (max - min) * i / steps
    const lp = uniswapV3Inventory({ markPrice: price, lowerPrice, upperPrice, liquidity })
    if (!lp) continue
    const lpPnl = lp.value - baseLp.value
    const optionValue = typeof optionPricer === 'function' ? Number(optionPricer(price)) || 0 : 0
    const hedgePnl = -hedgeSize * (price - startPrice)
    const combined = lpPnl + optionWeight * optionValue + hedgePnl + fees - fundingCost
    points.push({ price, lpPnl, optionValue, hedgePnl, fees, fundingCost, combined })
  }
  return {
    points,
    min,
    max,
    startPrice,
    lowerPrice,
    upperPrice,
    note: 'research-only: LP + option + hedge + fees + funding curve',
  }
}

export function portfolioValue({ lpValue, optionValue, fundingCost }) {
  if (![lpValue, optionValue, fundingCost].every(Number.isFinite)) return null
  return lpValue + optionValue - fundingCost
}
