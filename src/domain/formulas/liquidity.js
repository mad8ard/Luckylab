import { integrateTrapezoid, normalCdf, inverseNormalCdf } from './probability.js'

const MIN_SIGMA = 1e-6

export function normalDensity(x, { mu = 0, sigma = 1 } = {}) {
  if (![x, mu, sigma].every(Number.isFinite) || sigma <= 0) return null
  const z = (x - mu) / Math.max(MIN_SIGMA, sigma)
  return Math.exp(-0.5 * z * z) / (Math.sqrt(2 * Math.PI) * sigma)
}

export function laplaceDensity(x, { mu = 0, lambda = 1, kappa = 1 } = {}) {
  if (!Number.isFinite(x) || lambda <= 0 || kappa <= 0) return null
  const s = x >= mu ? 1 : -1
  const norm = lambda / (kappa + 1 / kappa)
  return norm * Math.exp(-Math.abs(x - mu) * lambda * (s === 1 ? kappa : 1 / kappa))
}

export function logLaplaceDensity(price, { mu = 0, lambda = 1, kappa = 1, lower = null, upper = null } = {}) {
  if (!Number.isFinite(price) || price <= 0) return null
  if (lower !== null && price < lower) return 0
  if (upper !== null && price > upper) return 0
  return logDensityToPriceDensity(price, laplaceDensity(Math.log(price), { mu, lambda, kappa }))
}

export function coveredCallFit(price, { strikePrice, iv = 1, lower = 0, upper = Infinity } = {}) {
  if (![price, strikePrice, iv].every(Number.isFinite) || price <= 0 || strikePrice <= 0 || iv <= 0) return null
  if (price < lower || price > upper) return 0
  const floor = Math.max(1e-9, normalCdf(-iv / 2) ?? 1e-9)
  const quantileInput = (normalCdf(-iv / 2) ?? 0.3) * (price / strikePrice)
  const q = inverseNormalCdf(Math.min(0.999999, Math.max(0.000001, quantileInput))) ?? 0
  return Math.max(0, normalCdf(-q - iv) / floor)
}

export function liquidityFingerprint({
  entryPrice,
  priceGrid,
  distribution = 'log-laplace',
  mu,
  lambda,
  kappa,
  activePrice,
  costAnchor,
  targetRange,
  lowerPrice,
  upperPrice,
  orderLevels = [],
  volatility,
  baseWeight = 1,
  activeWeight = 0.35,
  costWeight = 0.28,
  orderWeight = 0.24,
  rangeWeight = 0.22,
  lowerFactor = 0.2,
  upperFactor = 5,
  segmentCount = 8,
  integrationSteps = 256,
}) {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null
  const lower = entryPrice * lowerFactor
  const upper = entryPrice * upperFactor
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) return null
  const n = priceGrid && priceGrid > 2 ? Math.round(priceGrid) : 60
  const prices = Array.from({ length: n }, (_, i) => lower + (upper - lower) * i / (n - 1))
  const logMu = mu ?? Math.log(entryPrice)
  const lam = lambda ?? 2
  const kap = kappa ?? 1

  const rawComponents = buildDensityComponents({
    entryPrice,
    distribution,
    logMu,
    lambda: lam,
    kappa: kap,
    lower,
    upper,
    activePrice,
    costAnchor,
    targetRange,
    lowerPrice,
    upperPrice,
    orderLevels,
    volatility,
    weights: { baseWeight, activeWeight, costWeight, orderWeight, rangeWeight },
  })
  const components = normalizeComponents(rawComponents, lower, upper, integrationSteps)
  const density = (price) => components.reduce((sum, component) => sum + componentDensity(component, price), 0)

  const values = prices.map((price) => {
    const componentValues = Object.fromEntries(components.map((component) => [component.id, componentDensity(component, price)]))
    return {
      price,
      density: Object.values(componentValues).reduce((sum, value) => sum + value, 0),
      baseDensity: componentValues.base ?? 0,
      activeDensity: componentValues.active ?? 0,
      costDensity: componentValues.cost ?? 0,
      orderDensity: componentValues.orders ?? 0,
      rangeDensity: componentValues.range ?? 0,
      componentDensity: componentValues,
    }
  })
  const maxDensity = Math.max(...values.map((v) => v.density), 0)
  const totalIntegral = integrateTrapezoid(density, lower, upper, integrationSteps) ?? 0
  const count = Math.max(1, Math.round(segmentCount))
  const rawSegments = Array.from({ length: count }, (_, i) => {
    const lo = lower + (upper - lower) * i / count
    const hi = lower + (upper - lower) * (i + 1) / count
    const mass = integrateTrapezoid(density, lo, hi, Math.max(16, Math.round(integrationSteps / count))) ?? 0
    const componentMass = componentMasses(components, lo, hi, Math.max(16, Math.round(integrationSteps / count)))
    return {
      lower: lo,
      upper: hi,
      mid: (lo + hi) / 2,
      mass,
      weight: totalIntegral > 0 ? mass / totalIntegral : 1 / count,
      componentMass,
      dominantComponent: dominantComponent(componentMass),
      side: sideOf((lo + hi) / 2, activePrice ?? entryPrice),
      overlapsActiveRange: overlapsRange(lo, hi, targetRange ?? { lower: lowerPrice, upper: upperPrice }),
    }
  })
  const segmentTotal = rawSegments.reduce((sum, item) => sum + item.weight, 0)
  const segments = rawSegments.map((item) => ({
    ...item,
    weight: segmentTotal > 0 ? item.weight / segmentTotal : 1 / count,
  }))

  return {
    entryPrice,
    lower,
    upper,
    prices: values,
    maxDensity,
    totalIntegral,
    segments,
    components: components.map(({ fn, ...component }) => component),
    stats: fingerprintStats({ prices: values, segments, components, activePrice: activePrice ?? entryPrice }),
    status: 'research-only',
    inputMode: components.length > 1 ? 'hybrid-model' : 'model-only',
    missingInputs: ['real-ticks', 'lp-nft-weights', 'order-book-depth'],
    params: { distribution, mu: logMu, lambda: lam, kappa: kap, segmentCount: count },
    note: 'research-only: hybrid model density normalized by component integration, then discretized into LP interval weights',
  }
}

export function buildDensityComponents({
  entryPrice,
  distribution,
  logMu,
  lambda,
  kappa,
  lower,
  upper,
  activePrice,
  costAnchor,
  targetRange,
  lowerPrice,
  upperPrice,
  orderLevels,
  volatility,
  weights,
}) {
  const vol = Math.max(0.02, Math.min(2, Number(volatility) || 0.35))
  const logSigma = Math.max(0.015, vol / Math.sqrt(365) * 4)
  const components = [
    {
      id: 'base',
      label: 'base target density',
      kind: distribution,
      weight: weights.baseWeight,
      fn: distribution === 'log-laplace'
        ? (p) => logLaplaceDensity(p, { mu: logMu, lambda, kappa, lower, upper }) ?? 0
        : distribution === 'covered-call-fit'
          ? (p) => coveredCallFit(p, { strikePrice: entryPrice, iv: 1 / Math.max(lambda, 0.001), lower, upper }) ?? 0
          : (p) => laplaceDensity(p, { mu: entryPrice, lambda, kappa }) ?? 0,
    },
  ]

  if (validPrice(activePrice)) {
    components.push({
      id: 'active',
      label: 'active price bump',
      kind: 'log-normal-bump',
      weight: weights.activeWeight,
      anchor: activePrice,
      fn: (p) => validPrice(p) ? logDensityToPriceDensity(p, normalDensity(Math.log(p), { mu: Math.log(activePrice), sigma: logSigma })) : 0,
    })
  }
  if (validPrice(costAnchor)) {
    components.push({
      id: 'cost',
      label: 'cost anchor bump',
      kind: 'log-normal-bump',
      weight: weights.costWeight,
      anchor: costAnchor,
      fn: (p) => validPrice(p) ? logDensityToPriceDensity(p, normalDensity(Math.log(p), { mu: Math.log(costAnchor), sigma: logSigma * 1.35 })) : 0,
    })
  }

  const orders = normalizeOrderLevels(orderLevels)
  if (orders.length) {
    const maxNotional = Math.max(...orders.map((order) => order.notional), 1)
    components.push({
      id: 'orders',
      label: 'strategy order absorption',
      kind: 'order-bumps',
      weight: weights.orderWeight,
      orderCount: orders.length,
      buyShare: orders.filter((order) => order.side !== 'sell').reduce((sum, order) => sum + order.notional, 0) / orders.reduce((sum, order) => sum + order.notional, 0),
      fn: (p) => {
        if (!validPrice(p)) return 0
        const x = Math.log(p)
        return orders.reduce((sum, order) => {
          const sideBoost = order.side === 'sell' ? 0.92 : 1
          const weight = Math.sqrt(order.notional / maxNotional) * sideBoost
          return sum + weight * logDensityToPriceDensity(p, normalDensity(x, { mu: Math.log(order.price), sigma: logSigma * 0.7 }))
        }, 0)
      },
    })
  }

  const range = normalizeRange(targetRange ?? { lower: lowerPrice, upper: upperPrice })
  if (range) {
    const width = Math.max(0.015, Math.log(range.upper / range.lower) / 4)
    const center = Math.log(Math.sqrt(range.lower * range.upper))
    components.push({
      id: 'range',
      label: 'active range support',
      kind: 'range-support',
      weight: weights.rangeWeight,
      lower: range.lower,
      upper: range.upper,
      fn: (p) => {
        if (!validPrice(p)) return 0
        const x = Math.log(p)
        if (p >= range.lower && p <= range.upper) return 1 / p
        return logDensityToPriceDensity(p, normalDensity(x, { mu: center, sigma: width * 1.8 }))
      },
    })
  }

  return components.filter((component) => Number.isFinite(component.weight) && component.weight > 0)
}

export function normalizeComponents(rawComponents, lower, upper, integrationSteps = 256) {
  const withIntegrals = rawComponents
    .map((component) => ({
      ...component,
      integral: integrateTrapezoid(component.fn, lower, upper, integrationSteps) ?? 0,
    }))
    .filter((component) => component.integral > 0)
  const totalWeight = withIntegrals.reduce((sum, component) => sum + component.weight, 0)
  return withIntegrals.map((component) => ({
    ...component,
    normalizedWeight: totalWeight > 0 ? component.weight / totalWeight : 1 / withIntegrals.length,
  }))
}

export function componentDensity(component, price) {
  if (!component || !Number.isFinite(component.integral) || component.integral <= 0) return 0
  return (component.fn(price) / component.integral) * component.normalizedWeight
}

export function componentMasses(components, lower, upper, integrationSteps = 32) {
  return Object.fromEntries(components.map((component) => [
    component.id,
    integrateTrapezoid((price) => componentDensity(component, price), lower, upper, integrationSteps) ?? 0,
  ]))
}

export function fingerprintStats({ prices, segments, components, activePrice }) {
  const weights = segments.map((segment) => Math.max(0, segment.weight))
  const entropy = normalizedEntropy(weights)
  const concentration = Math.max(...weights, 0)
  const bidShare = segments.filter((segment) => segment.mid < activePrice).reduce((sum, segment) => sum + segment.weight, 0)
  const activeShare = components
    .filter((component) => ['active', 'cost', 'range'].includes(component.id))
    .reduce((sum, component) => sum + component.normalizedWeight, 0)
  const orderShare = components.find((component) => component.id === 'orders')?.normalizedWeight ?? 0
  const peak = prices.reduce((best, point) => point.density > best.density ? point : best, { price: null, density: -Infinity })
  return {
    entropy,
    concentration,
    bidShare,
    askShare: Math.max(0, 1 - bidShare),
    activeShare,
    orderShare,
    peakPrice: peak.price,
    peakDensity: peak.density,
    modeCount: countModes(prices),
  }
}

function normalizedEntropy(weights) {
  if (!weights.length) return 0
  const entropy = weights.reduce((sum, weight) => weight > 0 ? sum - weight * Math.log(weight) : sum, 0)
  return weights.length > 1 ? entropy / Math.log(weights.length) : 0
}

function countModes(points) {
  if (points.length < 3) return points.length ? 1 : 0
  let count = 0
  for (let i = 1; i < points.length - 1; i += 1) {
    if (points[i].density >= points[i - 1].density && points[i].density > points[i + 1].density) count += 1
  }
  return Math.max(1, count)
}

function dominantComponent(componentMass) {
  return Object.entries(componentMass).reduce((best, [key, value]) => value > best.value ? { key, value } : best, { key: null, value: -Infinity }).key
}

function normalizeOrderLevels(orderLevels) {
  if (!Array.isArray(orderLevels)) return []
  return orderLevels
    .map((order) => ({
      price: Number(order.price),
      notional: Math.max(0, Number(order.notional) || 0),
      side: order.side,
    }))
    .filter((order) => validPrice(order.price) && order.notional > 0)
}

function normalizeRange(range) {
  const lower = Number(range?.lower)
  const upper = Number(range?.upper)
  if (!validPrice(lower) || !validPrice(upper) || upper <= lower) return null
  return { lower, upper }
}

function overlapsRange(lower, upper, range) {
  const normalized = normalizeRange(range)
  return normalized ? upper >= normalized.lower && lower <= normalized.upper : false
}

function sideOf(price, activePrice) {
  if (!validPrice(price) || !validPrice(activePrice)) return 'unknown'
  return price < activePrice ? 'bid' : 'ask'
}

function validPrice(value) {
  return Number.isFinite(value) && value > 0
}

function logDensityToPriceDensity(price, logDensity) {
  return validPrice(price) && Number.isFinite(logDensity) ? logDensity / price : 0
}
