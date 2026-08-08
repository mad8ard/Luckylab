import { bachelierOption, blackScholes } from './options.js'

const DEFAULT_STEPS = 80

export function buildOptionPortfolio({
  entryPrice,
  holdingDays,
  iv,
  riskFreeRate = 0,
  dividendYield = 0,
  tradingDaysPerYear = 365,
  legs = [],
  contractMultiplier = 1,
  steps = DEFAULT_STEPS,
  minFactor = 0.65,
  maxFactor = 1.35,
}) {
  if (![entryPrice, holdingDays, iv, riskFreeRate, dividendYield, tradingDaysPerYear, contractMultiplier].every(Number.isFinite)) return null
  if (entryPrice <= 0 || holdingDays <= 0 || iv <= 0 || tradingDaysPerYear <= 0 || contractMultiplier <= 0) return null

  const normalized = normalizeOptionLegs(legs)
  if (!normalized.length) return null

  const pricedLegs = normalized.map((leg) => priceLeg({
    leg,
    price: entryPrice,
    entryPrice,
    holdingDays,
    iv,
    riskFreeRate,
    dividendYield,
    tradingDaysPerYear,
    contractMultiplier,
  })).filter(Boolean)
  if (!pricedLegs.length) return null

  const totals = aggregateLegs(pricedLegs)
  const min = Math.max(0.0001, entryPrice * minFactor)
  const max = entryPrice * maxFactor
  const points = []
  for (let i = 0; i <= steps; i += 1) {
    const price = min + (max - min) * i / steps
    const modelPnl = pricedLegs.reduce((sum, leg) => sum + scenarioLegPnl({ leg, price, holdingDays, iv, riskFreeRate, dividendYield, tradingDaysPerYear, contractMultiplier }), 0)
    const expiryPnl = pricedLegs.reduce((sum, leg) => sum + expiryLegPnl(leg, price, contractMultiplier), 0)
    points.push({ price, modelPnl, expiryPnl })
  }

  return {
    status: 'research-only',
    legs: pricedLegs,
    points,
    ...totals,
    strategyClass: classifyOptionPortfolio(totals),
    missingInputs: pricedLegs.some((leg) => leg.premiumSource === 'model') ? ['option-leg-premium'] : [],
    scope: 'listed-options-or-research; LP replication only applies to crypto/self-liquidity contexts',
  }
}

export function optionLegsFromTemplate({
  strategy = 'single',
  side = 'long',
  optionType = 'put',
  entryPrice,
  strikePrice,
  strikePrice2,
  quantity = 1,
  widthPct = 0.05,
  premium = null,
}) {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return []
  const k1 = positive(strikePrice) ?? entryPrice
  const width = Math.max(Number(widthPct) || 0.05, 0.001)
  const k2 = positive(strikePrice2) ?? (optionType === 'call' ? k1 * (1 + width) : k1 * (1 - width))
  const qty = Math.max(Number(quantity) || 1, 0)
  const longShort = side === 'short' ? 'short' : 'long'
  const opposite = longShort === 'long' ? 'short' : 'long'

  if (strategy === 'straddle') {
    return [
      leg({ type: 'call', side: longShort, strikePrice: k1, quantity: qty, premium }),
      leg({ type: 'put', side: longShort, strikePrice: k1, quantity: qty, premium: null }),
    ]
  }
  if (strategy === 'strangle') {
    const low = Math.min(k1, k2)
    const high = Math.max(k1, k2)
    return [
      leg({ type: 'put', side: longShort, strikePrice: low, quantity: qty, premium }),
      leg({ type: 'call', side: longShort, strikePrice: high, quantity: qty, premium: null }),
    ]
  }
  if (strategy === 'vertical') {
    return [
      leg({ type: optionType, side: longShort, strikePrice: k1, quantity: qty, premium }),
      leg({ type: optionType, side: opposite, strikePrice: k2, quantity: qty, premium: null }),
    ]
  }
  if (strategy === 'collar') {
    return [
      leg({ type: 'put', side: 'long', strikePrice: Math.min(k1, k2), quantity: qty, premium }),
      leg({ type: 'call', side: 'short', strikePrice: Math.max(k1, k2), quantity: qty, premium: null }),
    ]
  }
  return [leg({ type: optionType, side: longShort, strikePrice: k1, quantity: qty, premium })]
}

export function normalizeOptionLegs(legs) {
  if (!Array.isArray(legs)) return []
  return legs.map((item) => {
    const strike = positive(item?.strikePrice)
    const quantity = Math.max(Number(item?.quantity) || 0, 0)
    if (!strike || quantity <= 0) return null
    return leg({
      type: item.type === 'call' ? 'call' : 'put',
      side: item.side === 'short' ? 'short' : 'long',
      strikePrice: strike,
      quantity,
      premium: Number.isFinite(Number(item.premium)) ? Number(item.premium) : null,
      model: item.model === 'bachelier' ? 'bachelier' : 'black-scholes',
      normalVol: Number(item.normalVol),
    })
  }).filter(Boolean)
}

function leg({ type, side, strikePrice, quantity, premium, model = 'black-scholes', normalVol = null }) {
  return { type, side, strikePrice, quantity, premium, model, normalVol }
}

function priceLeg({ leg, price, holdingDays, iv, riskFreeRate, dividendYield, tradingDaysPerYear, contractMultiplier }) {
  const quote = leg.model === 'bachelier'
    ? bachelierOption({ entryPrice: price, strikePrice: leg.strikePrice, holdingDays, normalVol: positive(leg.normalVol) ?? iv * price, riskFreeRate, type: leg.type, tradingDaysPerYear })
    : blackScholes({ entryPrice: price, strikePrice: leg.strikePrice, holdingDays, iv, riskFreeRate, dividendYield, type: leg.type, tradingDaysPerYear })
  if (!quote) return null
  const direction = leg.side === 'short' ? -1 : 1
  const signedQuantity = direction * leg.quantity * contractMultiplier
  const premium = Number.isFinite(leg.premium) ? leg.premium : quote.price
  return {
    ...leg,
    quote,
    direction,
    signedQuantity,
    premium,
    premiumSource: Number.isFinite(leg.premium) ? 'input' : 'model',
    value: signedQuantity * quote.price,
    entryCost: signedQuantity * premium,
    pnl: signedQuantity * (quote.price - premium),
    delta: signedQuantity * (quote.delta ?? 0),
    gamma: signedQuantity * (quote.gamma ?? 0),
    thetaDaily: signedQuantity * (quote.thetaDaily ?? quote.theta ?? 0),
    vega: signedQuantity * (quote.vega ?? quote.vegaNormal ?? 0),
    rho: signedQuantity * (quote.rho ?? 0),
  }
}

function aggregateLegs(legs) {
  return legs.reduce((acc, item) => ({
    value: acc.value + item.value,
    entryCost: acc.entryCost + item.entryCost,
    pnl: acc.pnl + item.pnl,
    delta: acc.delta + item.delta,
    gamma: acc.gamma + item.gamma,
    thetaDaily: acc.thetaDaily + item.thetaDaily,
    vega: acc.vega + item.vega,
    rho: acc.rho + item.rho,
  }), { value: 0, entryCost: 0, pnl: 0, delta: 0, gamma: 0, thetaDaily: 0, vega: 0, rho: 0 })
}

function scenarioLegPnl({ leg, price, holdingDays, iv, riskFreeRate, dividendYield, tradingDaysPerYear, contractMultiplier }) {
  const priced = priceLeg({ leg, price, holdingDays, iv, riskFreeRate, dividendYield, tradingDaysPerYear, contractMultiplier })
  return priced?.pnl ?? 0
}

function expiryLegPnl(leg, price, contractMultiplier) {
  const intrinsic = leg.type === 'call'
    ? Math.max(price - leg.strikePrice, 0)
    : Math.max(leg.strikePrice - price, 0)
  return leg.direction * leg.quantity * contractMultiplier * (intrinsic - leg.premium)
}

function classifyOptionPortfolio(totals) {
  const delta = Math.abs(totals.delta) < 1e-6 ? 'delta-neutral' : totals.delta > 0 ? 'positive-delta' : 'negative-delta'
  const gamma = Math.abs(totals.gamma) < 1e-8 ? 'flat-gamma' : totals.gamma > 0 ? 'long-convexity' : 'short-convexity'
  return `${delta}/${gamma}`
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}
