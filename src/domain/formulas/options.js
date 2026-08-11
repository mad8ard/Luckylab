import { normalCdf, normalPdf } from './probability.js'
import { defineLegacyAliasContract } from './legacyAliases.js'

const OPTION_GREEK_LEGACY_CONTRACT = defineLegacyAliasContract({
  delta: 'optionDelta',
  gamma: 'optionGamma',
  theta: 'optionThetaPerSession',
  thetaDaily: 'optionThetaPerSession',
  thetaAnnual: 'optionThetaAnnual',
  vega: 'optionVegaPerPct',
  rho: 'optionRhoPerPct',
})
const BACHELIER_GREEK_LEGACY_CONTRACT = defineLegacyAliasContract({
  delta: 'optionDelta',
  gamma: 'optionGamma',
  thetaDaily: 'optionThetaPerSession',
  vegaNormal: 'optionNormalVegaPerUnit',
})
const RISK_SURFACE_LEGACY_CONTRACT = defineLegacyAliasContract({
  delta: 'optionDelta',
  gamma: 'optionGamma',
  theta: 'optionThetaPerSession',
})

export const GET_DELTA_SOURCE = {
  id: '943334771f',
  title: '永久uni期权计算',
  status: 'implemented',
}

export function getDeltaBands({ entryPrice, formulaHorizonSessions, iv, deltaSlope, z = 1, tradingDaysPerYear }) {
  const d = deltaSlope
  if (![entryPrice, formulaHorizonSessions, iv, d, z, tradingDaysPerYear].every(Number.isFinite)) return null
  if (entryPrice <= 0 || formulaHorizonSessions <= 0 || iv <= 0 || z <= 0 || tradingDaysPerYear <= 0) return null

  const timeScale = Math.sqrt(formulaHorizonSessions / (tradingDaysPerYear * 2 * Math.PI))
  const wave = iv * timeScale
  if (!Number.isFinite(wave) || wave >= 1) return null

  const rawRatio = Math.pow(1 + wave, 2) / Math.pow(1 - wave, 2)
  const longRatio = rawRatio * z
  const longCost = (entryPrice * Math.pow(d * longRatio - d + 1, 2)) / longRatio
  const shortRatio = 1 / longRatio
  const shortCost = (entryPrice * Math.pow(d * shortRatio - d + 1, 2)) / shortRatio

  const long = {
    high: longCost * longRatio,
    cost: longCost,
    low: longCost / longRatio,
  }
  const short = {
    high: shortCost / shortRatio,
    cost: shortCost,
    low: shortCost * shortRatio,
  }
  return {
    sourceId: GET_DELTA_SOURCE.id,
    sourceTitle: GET_DELTA_SOURCE.title,
    status: GET_DELTA_SOURCE.status,
    variables: {
      P: entryPrice,
      T: formulaHorizonSessions,
      s: iv,
      d,
      tradingDaysPerYear,
    },
    timeScale,
    wave,
    rT: rawRatio,
    longRatio,
    long: {
      ...long,
      localSlopeAtEntry: getDeltaBandSlope({ price: entryPrice, cost: long.cost, ratio: longRatio }),
      payoffAtEntry: getDeltaBandValue({ price: entryPrice, cost: long.cost, ratio: longRatio }),
    },
    short: {
      ...short,
      localSlopeAtEntry: null,
      payoffAtEntry: null,
    },
  }
}

export function getDeltaBandValue({ price, cost, ratio }) {
  if (![price, cost, ratio].every(Number.isFinite)) return null
  if (price <= 0 || cost <= 0 || ratio <= 0 || ratio === 1) return null
  const low = cost / ratio
  const high = cost * ratio
  if (price <= low) return price
  if (price >= high) return cost
  return (2 * Math.sqrt(price * cost * ratio) - price - cost) / (ratio - 1)
}

export function getDeltaBandSlope({ price, cost, ratio }) {
  if (![price, cost, ratio].every(Number.isFinite)) return null
  if (price <= 0 || cost <= 0 || ratio <= 0 || ratio === 1) return null
  const low = cost / ratio
  const high = cost * ratio
  if (price <= low) return 1
  if (price >= high) return 0
  return (Math.sqrt((cost * ratio) / price) - 1) / (ratio - 1)
}

export function blackScholes({
  entryPrice,
  strikePrice,
  timeToExpirySessions,
  iv,
  riskFreeRate = 0,
  dividendYield = 0,
  type = 'put',
  tradingDaysPerYear,
}) {
  const time = timeToExpirySessions / tradingDaysPerYear
  if (
    ![entryPrice, strikePrice, timeToExpirySessions, iv, riskFreeRate, dividendYield, tradingDaysPerYear].every(
      Number.isFinite,
    )
  )
    return null
  if (entryPrice <= 0 || strikePrice <= 0 || time <= 0 || iv <= 0) return null

  const sqrtT = Math.sqrt(time)
  const d1 = (Math.log(entryPrice / strikePrice) + (riskFreeRate - dividendYield + (iv * iv) / 2) * time) / (iv * sqrtT)
  const d2 = d1 - iv * sqrtT
  const nd1 = normalCdf(d1)
  const nd2 = normalCdf(d2)
  const discountS = entryPrice * Math.exp(-dividendYield * time)
  const discountK = strikePrice * Math.exp(-riskFreeRate * time)
  const callPrice = discountS * nd1 - discountK * nd2
  const putPrice = discountK * normalCdf(-d2) - discountS * normalCdf(-d1)
  const isPut = type === 'put'
  const optionDelta = isPut ? Math.exp(-dividendYield * time) * (nd1 - 1) : Math.exp(-dividendYield * time) * nd1
  const optionGamma = (Math.exp(-dividendYield * time) * normalPdf(d1)) / (entryPrice * iv * sqrtT)
  const thetaAnnualCall =
    -(discountS * normalPdf(d1) * iv) / (2 * sqrtT) - riskFreeRate * discountK * nd2 + dividendYield * discountS * nd1
  const thetaAnnualPut =
    -(discountS * normalPdf(d1) * iv) / (2 * sqrtT) +
    riskFreeRate * discountK * normalCdf(-d2) -
    dividendYield * discountS * normalCdf(-d1)
  const rhoCall = (strikePrice * time * Math.exp(-riskFreeRate * time) * nd2) / 100
  const rhoPut = (-strikePrice * time * Math.exp(-riskFreeRate * time) * normalCdf(-d2)) / 100
  const optionThetaAnnual = isPut ? thetaAnnualPut : thetaAnnualCall
  const optionThetaPerSession = optionThetaAnnual / tradingDaysPerYear
  const optionVegaPerPct = (entryPrice * Math.exp(-dividendYield * time) * normalPdf(d1) * sqrtT) / 100
  const optionRhoPerPct = isPut ? rhoPut : rhoCall

  return {
    d1,
    d2,
    price: Math.max(0, isPut ? putPrice : callPrice),
    optionDelta,
    optionGamma,
    optionThetaPerSession,
    optionThetaAnnual,
    optionVegaPerPct,
    optionRhoPerPct,
    // Deprecated compatibility aliases. New consumers must use the unit-bearing fields above.
    delta: optionDelta,
    gamma: optionGamma,
    theta: optionThetaPerSession,
    thetaDaily: optionThetaPerSession,
    thetaAnnual: optionThetaAnnual,
    vega: optionVegaPerPct,
    rho: optionRhoPerPct,
    ...OPTION_GREEK_LEGACY_CONTRACT,
    dividendYield,
    touchProbabilityProxy: Math.min(0.999, Math.abs((isPut ? nd1 - 1 : nd1) * 2)),
    touchProbabilityStatus: 'delta-based-proxy-not-calibrated-hitting-probability',
  }
}

export function asianOption({
  entryPrice,
  strikePrice,
  timeToExpirySessions,
  iv,
  riskFreeRate = 0,
  type = 'put',
  tradingDaysPerYear,
}) {
  if (![entryPrice, strikePrice, timeToExpirySessions, iv, riskFreeRate, tradingDaysPerYear].every(Number.isFinite))
    return null
  if (entryPrice <= 0 || strikePrice <= 0 || timeToExpirySessions <= 0 || iv <= 0 || tradingDaysPerYear <= 0)
    return null
  const sigmaGeo = iv / Math.sqrt(3)
  const b = 0.5 * (riskFreeRate - (sigmaGeo * sigmaGeo) / 2)
  const option = blackScholes({
    entryPrice,
    strikePrice,
    timeToExpirySessions,
    iv: sigmaGeo,
    riskFreeRate,
    dividendYield: riskFreeRate - b,
    type,
    tradingDaysPerYear,
  })
  if (!option) return null
  return {
    ...option,
    sigmaGeo,
    b,
    regularIv: iv,
    note: 'research-only: geometric Asian approximation for payoff fit, not a listed contract model',
  }
}

export function bachelierOption({
  entryPrice,
  strikePrice,
  timeToExpirySessions,
  normalVol,
  riskFreeRate = 0,
  type = 'put',
  tradingDaysPerYear,
}) {
  const time = timeToExpirySessions / tradingDaysPerYear
  if (
    ![entryPrice, strikePrice, timeToExpirySessions, normalVol, riskFreeRate, tradingDaysPerYear].every(Number.isFinite)
  )
    return null
  if (timeToExpirySessions <= 0 || normalVol <= 0 || time <= 0 || tradingDaysPerYear <= 0) return null
  const std = normalVol * Math.sqrt(time)
  if (std <= 0) return null
  const d = (entryPrice - strikePrice) / std
  const discount = Math.exp(-riskFreeRate * time)
  const call = discount * ((entryPrice - strikePrice) * normalCdf(d) + std * normalPdf(d))
  const put = discount * ((strikePrice - entryPrice) * normalCdf(-d) + std * normalPdf(d))
  const isPut = type === 'put'
  const optionDelta = discount * (isPut ? normalCdf(d) - 1 : normalCdf(d))
  const optionGamma = (discount * normalPdf(d)) / std
  const optionNormalVegaPerUnit = discount * Math.sqrt(time) * normalPdf(d)
  return {
    d,
    price: Math.max(0, isPut ? put : call),
    optionDelta,
    optionGamma,
    optionThetaPerSession: null,
    optionThetaAnnual: null,
    // normalVol is price / sqrt(year); without a normalized quote convention it has no percent-point Vega.
    optionVegaPerPct: null,
    optionRhoPerPct: null,
    optionNormalVegaPerUnit,
    // Deprecated compatibility aliases. Bachelier does not implement Theta or Rho here.
    delta: optionDelta,
    gamma: optionGamma,
    vegaNormal: optionNormalVegaPerUnit,
    thetaDaily: null,
    ...BACHELIER_GREEK_LEGACY_CONTRACT,
    normalVol,
    note: 'research-only: Bachelier normal-vol option approximation',
  }
}

export function riskSurface({
  entryPrice,
  strikePrice,
  timeToExpirySessions,
  iv,
  riskFreeRate = 0,
  bandLow,
  bandHigh,
  steps = 40,
  tradingDaysPerYear,
}) {
  if (
    ![entryPrice, strikePrice, timeToExpirySessions, iv, bandLow, bandHigh, tradingDaysPerYear].every(Number.isFinite)
  )
    return null
  if (
    entryPrice <= 0 ||
    timeToExpirySessions <= 0 ||
    iv <= 0 ||
    bandLow <= 0 ||
    bandLow >= bandHigh ||
    tradingDaysPerYear <= 0
  )
    return null
  const points = []
  for (let i = 0; i <= steps; i += 1) {
    const price = bandLow + ((bandHigh - bandLow) * i) / steps
    const option = blackScholes({
      entryPrice: price,
      strikePrice,
      timeToExpirySessions,
      iv,
      riskFreeRate,
      type: 'call',
      tradingDaysPerYear,
    })
    if (
      option &&
      Number.isFinite(option.optionDelta) &&
      Number.isFinite(option.optionGamma) &&
      Number.isFinite(option.optionThetaPerSession)
    ) {
      points.push({
        price,
        optionDelta: option.optionDelta,
        optionGamma: option.optionGamma,
        optionThetaPerSession: option.optionThetaPerSession,
        // Deprecated compatibility aliases.
        delta: option.optionDelta,
        gamma: option.optionGamma,
        theta: option.optionThetaPerSession,
        ...RISK_SURFACE_LEGACY_CONTRACT,
      })
    }
  }
  return { points, entryPrice, strikePrice, bandLow, bandHigh }
}
