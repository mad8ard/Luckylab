const FOURTH_ROOT = 0.25
const ROOT_EPSILON = 1e-12

export const CK_CAPITAL_EFFICIENCY_INFLECTION = Math.sqrt(5 + 2 * Math.sqrt(10)) / 4

export function resolveArithmeticRangeSpec({
  referencePrice = 1,
  rangeWidth,
  skew = 1,
  defaultRangeWidth = null,
} = {}) {
  const requestedWidth = missing(rangeWidth) ? defaultRangeWidth : Number(rangeWidth)
  const requestedSkew = missing(skew) ? 1 : Number(skew)
  const price = Number(referencePrice)
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(requestedWidth) ||
    requestedWidth <= 0 ||
    requestedWidth >= 1 ||
    !Number.isFinite(requestedSkew) ||
    requestedSkew < 0
  )
    return null
  const lowerPrice = price * (1 - requestedWidth)
  const upperPrice = price * (1 + requestedSkew * requestedWidth)
  if (!(lowerPrice > 0 && upperPrice > lowerPrice)) return null
  return {
    status: 'valid',
    referencePrice: price,
    referencePriceBasis: 'arithmetic-range-coordinate',
    rangeWidth: requestedWidth,
    skew: requestedSkew,
    lowerPrice,
    upperPrice,
    geometricMidpointPrice: Math.sqrt(lowerPrice * upperPrice),
  }
}

export function capitalEfficiencyAtPrice({ markPrice, lowerPrice, upperPrice } = {}) {
  if (
    ![markPrice, lowerPrice, upperPrice].every(Number.isFinite) ||
    lowerPrice <= 0 ||
    markPrice <= 0 ||
    upperPrice <= markPrice ||
    markPrice <= lowerPrice
  )
    return null
  const denominator = 2 - Math.sqrt(markPrice / upperPrice) - Math.sqrt(lowerPrice / markPrice)
  return denominator > 0 ? 2 / denominator : null
}

/**
 * CK's arithmetic-price capital-efficiency curve.
 *
 * lower = P0(1-x), upper = P0(1+alpha*x).  CK Part 1 publishes the symmetric
 * alpha=1 reference and CK Part 2 publishes the directional alpha frontier.
 * Only alpha=1 may be labelled the symmetric ±84% reference.
 */
export function capitalEfficiency({ rangeWidth, skew }) {
  const spec = resolveArithmeticRangeSpec({ rangeWidth, skew })
  if (!spec) return null
  const lower = spec.lowerPrice
  const upper = spec.upperPrice
  const endpointFourthRoot = Math.pow(lower / upper, FOURTH_ROOT)
  const signedSlope = capitalEfficiencySlope({ rangeWidth, skew })
  const efficiencyAtGeometricMidpoint = 1 / (1 - endpointFourthRoot)
  const efficiencyAtReferencePrice = capitalEfficiencyAtPrice({ markPrice: 1, lowerPrice: lower, upperPrice: upper })
  return {
    lower,
    upper,
    downMove: -rangeWidth,
    upMove: skew * rangeWidth,
    rangeRatio: lower / upper,
    efficiency: efficiencyAtGeometricMidpoint,
    efficiencyAtGeometricMidpoint,
    efficiencyAtReferencePrice,
    efficiencyAtArithmeticCenter: efficiencyAtReferencePrice,
    efficiencyAtArithmeticCenterLegacyAlias: true,
    geometricMidpointRatio: spec.geometricMidpointPrice,
    signedSlope,
    frontierSlope: Math.abs(signedSlope),
    secondDerivative: capitalEfficiencySecondDerivative({ rangeWidth, skew }),
    widthCoordinate: 'linear-arithmetic-price-offset',
    efficiencyValuationBasis: 'range-geometric-midpoint',
    arithmeticReferenceIsValuationPrice: spec.geometricMidpointPrice === 1,
    variant: skew === 1 ? 'ck-arithmetic-symmetric' : 'ck-arithmetic-directional',
    claimClass: 'exact-identity',
    claimDetail: 'geometric-midpoint-capital-efficiency-curve',
  }
}

export function capitalEfficiencySlope({ rangeWidth, skew }) {
  if (![rangeWidth, skew].every(Number.isFinite) || rangeWidth <= 0 || rangeWidth >= 1 || skew < 0) return null
  const lower = 1 - rangeWidth
  const upper = 1 + skew * rangeWidth
  const endpointFourthRoot = Math.pow(lower / upper, FOURTH_ROOT)
  const endpointFourthRootPrime = (-endpointFourthRoot * (1 + skew)) / (4 * lower * upper)
  return endpointFourthRootPrime / Math.pow(1 - endpointFourthRoot, 2)
}

export function capitalEfficiencySecondDerivative({ rangeWidth, skew }) {
  if (![rangeWidth, skew].every(Number.isFinite) || rangeWidth <= 0 || rangeWidth >= 1 || skew < 0) return null
  const lower = 1 - rangeWidth
  const upper = 1 + skew * rangeWidth
  const endpointFourthRoot = Math.pow(lower / upper, FOURTH_ROOT)
  const c = (1 + skew) / 4
  const logRootPrime = -c / (lower * upper)
  const logRootSecond = (-c * (upper - skew * lower)) / (lower * lower * upper * upper)
  const endpointFourthRootPrime = endpointFourthRoot * logRootPrime
  const endpointFourthRootSecond = endpointFourthRoot * (logRootPrime * logRootPrime + logRootSecond)
  return (
    (endpointFourthRootSecond * (1 - endpointFourthRoot) + 2 * endpointFourthRootPrime * endpointFourthRootPrime) /
    Math.pow(1 - endpointFourthRoot, 3)
  )
}

/** Exact CK symmetric reference point. */
export function ckCapitalEfficiencyReference() {
  const rangeWidth = CK_CAPITAL_EFFICIENCY_INFLECTION
  const curve = capitalEfficiency({ rangeWidth, skew: 1 })
  return {
    ...curve,
    rangeWidth,
    totalLinearSpan: 2 * rangeWidth,
    criterion: 'minimum-marginal-efficiency-loss',
    objective: 'maximize-local-range-gained-per-unit-capital-efficiency-lost',
    marginalRangePerEfficiencyLoss: 1 / curve.frontierSlope,
    theorem: 'ck-arithmetic-symmetric-capital-efficiency-inflection',
    arithmeticCenterEfficiency: curve.efficiencyAtReferencePrice,
    arithmeticCenterIsGeometricMidpoint: false,
    sourceId: 'ysv2j74j6k',
    exact: true,
    lawExact: true,
    closedForm: true,
    numericalSolution: false,
    solutionMethod: 'closed-form-reference',
    isProbabilityCoverage: false,
    isFeeOptimal: false,
    isPnlOptimal: false,
  }
}

/**
 * CK Part 2 directional inflection.  CK's closed form is returned for skew=1;
 * other skews numerically solve the exact condition
 * 3a*u^5-5a*u^4-5u+3=0 on u in (0,1).
 */
export function capitalEfficiencyFrontier({ skew = 1 } = {}) {
  if (!Number.isFinite(skew) || skew < 0) return null
  if (skew === 1) return ckCapitalEfficiencyReference()
  let low = ROOT_EPSILON
  let high = 1 - ROOT_EPSILON
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2
    const value = frontierPolynomial(mid, skew)
    if (value > 0) low = mid
    else high = mid
  }
  const endpointFourthRoot = (low + high) / 2
  const endpointRatio = endpointFourthRoot ** 4
  const rangeWidth = (1 - endpointRatio) / (1 + skew * endpointRatio)
  const curve = capitalEfficiency({ rangeWidth, skew })
  return {
    ...curve,
    rangeWidth,
    criterion: 'minimum-marginal-efficiency-loss',
    objective: 'maximize-local-range-gained-per-unit-capital-efficiency-lost',
    marginalRangePerEfficiencyLoss: 1 / curve.frontierSlope,
    theorem: 'ck-arithmetic-directional-capital-efficiency-inflection',
    sourceId: '0l7i8kmukx',
    exact: true,
    lawExact: true,
    closedForm: false,
    numericalSolution: true,
    numericalRootTolerance: ROOT_EPSILON,
    solutionMethod: 'numerical-root-of-exact-condition',
    isProbabilityCoverage: false,
    isFeeOptimal: false,
    isPnlOptimal: false,
  }
}

export function sampleCapitalEfficiencyCurve({ skew = 1, steps = 80, maxEfficiency = 100 } = {}) {
  if (!Number.isFinite(skew) || skew < 0) return []
  const count = Math.max(8, Math.round(Number(steps) || 80))
  const points = []
  for (let i = 1; i < count; i += 1) {
    const rangeWidth = i / count
    const item = capitalEfficiency({ rangeWidth, skew })
    if (item && Number.isFinite(item.efficiency) && item.efficiency <= maxEfficiency)
      points.push({ rangeWidth, ...item })
  }
  return points
}

function frontierPolynomial(endpointFourthRoot, skew) {
  return 3 * skew * endpointFourthRoot ** 5 - 5 * skew * endpointFourthRoot ** 4 - 5 * endpointFourthRoot + 3
}

function missing(value) {
  return value === null || value === undefined || value === ''
}
