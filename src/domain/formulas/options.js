import { normalCdf, normalPdf } from './probability.js'

export const GET_DELTA_SOURCE = {
  id: '943334771f',
  title: '永久uni期权计算',
  status: 'implemented',
}

export function getDeltaBands({ entryPrice, holdingDays, iv, targetReturn, z = 1, tradingDaysPerYear = 365 }) {
  if (![entryPrice, holdingDays, iv, targetReturn, z, tradingDaysPerYear].every(Number.isFinite)) return null
  if (entryPrice <= 0 || holdingDays <= 0 || iv <= 0 || z <= 0 || tradingDaysPerYear <= 0) return null

  const timeScale = Math.sqrt(holdingDays / (tradingDaysPerYear * 2 * Math.PI))
  const wave = iv * timeScale
  if (!Number.isFinite(wave) || wave >= 1) return null

  const rawRatio = Math.pow(1 + wave, 2) / Math.pow(1 - wave, 2)
  const longRatio = rawRatio * z
  const longCost = entryPrice * Math.pow(targetReturn * longRatio - targetReturn + 1, 2) / longRatio
  const shortRatio = 1 / longRatio
  const shortCost = entryPrice * Math.pow(targetReturn * shortRatio - targetReturn + 1, 2) / shortRatio

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
      T: holdingDays,
      s: iv,
      d: targetReturn,
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
  holdingDays,
  iv,
  riskFreeRate = 0,
  dividendYield = 0,
  type = 'put',
  tradingDaysPerYear = 365,
}) {
  const time = holdingDays / tradingDaysPerYear
  if (![entryPrice, strikePrice, holdingDays, iv, riskFreeRate, dividendYield].every(Number.isFinite)) return null
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
  const gamma = Math.exp(-dividendYield * time) * normalPdf(d1) / (entryPrice * iv * sqrtT)
  const thetaAnnualCall =
    -(discountS * normalPdf(d1) * iv) / (2 * sqrtT) -
    riskFreeRate * discountK * nd2 +
    dividendYield * discountS * nd1
  const thetaAnnualPut =
    -(discountS * normalPdf(d1) * iv) / (2 * sqrtT) +
    riskFreeRate * discountK * normalCdf(-d2) -
    dividendYield * discountS * normalCdf(-d1)
  const rhoCall = strikePrice * time * Math.exp(-riskFreeRate * time) * nd2 / 100
  const rhoPut = -strikePrice * time * Math.exp(-riskFreeRate * time) * normalCdf(-d2) / 100

  return {
    d1,
    d2,
    price: Math.max(0, isPut ? putPrice : callPrice),
    delta: isPut ? Math.exp(-dividendYield * time) * (nd1 - 1) : Math.exp(-dividendYield * time) * nd1,
    gamma,
    theta: (isPut ? thetaAnnualPut : thetaAnnualCall) / tradingDaysPerYear,
    thetaDaily: (isPut ? thetaAnnualPut : thetaAnnualCall) / tradingDaysPerYear,
    thetaAnnual: isPut ? thetaAnnualPut : thetaAnnualCall,
    vega: entryPrice * Math.exp(-dividendYield * time) * normalPdf(d1) * sqrtT / 100,
    rho: isPut ? rhoPut : rhoCall,
    dividendYield,
    probabilityOfTouch: Math.min(0.999, Math.abs((isPut ? nd1 - 1 : nd1) * 2)),
  }
}

export function asianOption({ entryPrice, strikePrice, holdingDays, iv, riskFreeRate = 0, type = 'put', tradingDaysPerYear = 365 }) {
  if (![entryPrice, strikePrice, holdingDays, iv, riskFreeRate].every(Number.isFinite)) return null
  if (entryPrice <= 0 || strikePrice <= 0 || holdingDays <= 0 || iv <= 0) return null
  const sigmaGeo = iv / Math.sqrt(3)
  const b = 0.5 * (riskFreeRate - (sigmaGeo * sigmaGeo) / 2)
  const option = blackScholes({
    entryPrice,
    strikePrice,
    holdingDays,
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

export function bachelierOption({ entryPrice, strikePrice, holdingDays, normalVol, riskFreeRate = 0, type = 'put', tradingDaysPerYear = 365 }) {
  const time = holdingDays / tradingDaysPerYear
  if (![entryPrice, strikePrice, holdingDays, normalVol, riskFreeRate].every(Number.isFinite)) return null
  if (holdingDays <= 0 || normalVol <= 0 || time <= 0) return null
  const std = normalVol * Math.sqrt(time)
  if (std <= 0) return null
  const d = (entryPrice - strikePrice) / std
  const discount = Math.exp(-riskFreeRate * time)
  const call = discount * ((entryPrice - strikePrice) * normalCdf(d) + std * normalPdf(d))
  const put = discount * ((strikePrice - entryPrice) * normalCdf(-d) + std * normalPdf(d))
  const isPut = type === 'put'
  return {
    d,
    price: Math.max(0, isPut ? put : call),
    delta: discount * (isPut ? normalCdf(d) - 1 : normalCdf(d)),
    gamma: discount * normalPdf(d) / std,
    vegaNormal: discount * Math.sqrt(time) * normalPdf(d),
    thetaDaily: null,
    normalVol,
    note: 'research-only: Bachelier normal-vol option approximation',
  }
}

export function riskSurface({ entryPrice, strikePrice, holdingDays, iv, riskFreeRate = 0, bandLow, bandHigh, steps = 40, tradingDaysPerYear = 365 }) {
  if (![entryPrice, strikePrice, holdingDays, iv, bandLow, bandHigh].every(Number.isFinite)) return null
  if (entryPrice <= 0 || holdingDays <= 0 || iv <= 0 || bandLow <= 0 || bandLow >= bandHigh) return null
  const points = []
  for (let i = 0; i <= steps; i += 1) {
    const price = bandLow + (bandHigh - bandLow) * i / steps
    const option = blackScholes({ entryPrice: price, strikePrice, holdingDays, iv, riskFreeRate, type: 'call', tradingDaysPerYear })
    if (option) points.push({ price, delta: option.delta, gamma: option.gamma, theta: option.theta })
  }
  return { points, entryPrice, strikePrice, bandLow, bandHigh }
}
