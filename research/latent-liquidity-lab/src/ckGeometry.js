import { capitalEfficiencyFrontier } from '../../../src/domain/formulas/core.js'

/**
 * CK geometry and recovery timing intentionally use different vocabularies.
 * This module never exports a bare `q`.
 */
export function deriveCkFrontier({ referencePrice = 1, skewAlpha = 1, alphaSource = 'scenario-input' } = {}) {
  const price = Number(referencePrice)
  const alpha = Number(skewAlpha)
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(alpha) || alpha < 0) return null

  const frontier = capitalEfficiencyFrontier({ skew: alpha })
  if (!frontier || !Number.isFinite(frontier.rangeWidth)) return null
  const ckRangeWidth = frontier.rangeWidth
  const ckDownWidthFraction = ckRangeWidth
  const ckUpWidthFraction = alpha * ckRangeWidth
  const endpointFourthRoot = Math.pow((1 - ckRangeWidth) / (1 + alpha * ckRangeWidth), 0.25)

  return {
    status: 'ok',
    referencePrice: price,
    ckSkewAlphaScenario: alpha,
    skewAlpha: alpha,
    alphaSource,
    ckRangeWidth,
    ckDownWidthFraction,
    ckUpWidthFraction,
    ckDownWidthPrice: price * ckDownWidthFraction,
    ckUpWidthPrice: price * ckUpWidthFraction,
    lowerPrice: price * (1 - ckRangeWidth),
    upperPrice: price * (1 + alpha * ckRangeWidth),
    endpointFourthRoot,
    capitalEfficiencyAtGeometricMidpoint: frontier.efficiencyAtGeometricMidpoint,
    capitalEfficiencyAtReferencePrice: frontier.efficiencyAtReferencePrice,
    capitalEfficiency: frontier.efficiency,
    capitalEfficiencyLegacyAliasBasis: 'range-geometric-midpoint',
    criterion: frontier.criterion,
    objective: frontier.objective,
    theorem: frontier.theorem,
    publishedPart: alpha === 1 ? 'CK-Part-1' : 'CK-Part-2',
    equation: '3*alpha*u^5-5*alpha*u^4-5*u+3=0; x=(1-u^4)/(1+alpha*u^4)',
    exactEquation: true,
    lawExact: true,
    numericalSolution: frontier.numericalSolution,
    solutionMethod: frontier.solutionMethod,
    geometryClaimClass: 'exact-identity',
    skewParameterClaimClass: 'scenario-proxy',
    resultClaimClass: 'scenario-proxy',
    condition: 'given-skew-alpha',
    isProbabilityCoverage: false,
    isRecoveryFraction: false,
    isFeeOptimal: false,
    isPnlOptimal: false,
    isExecutionTarget: false,
    provenance: alpha === 1 ? 'CK Part 1 / Desmos ysv2j74j6k' : 'CK Part 2 / Desmos 0l7i8kmukx',
  }
}

/**
 * Point-in-time directional move-scale estimate plus an explicit scenario
 * bridge into CK's alpha coordinate. Positive and negative return magnitudes
 * are estimated on a causal, formula-derived sample. Log returns are converted
 * back to arithmetic moves before the scale ratio is formed, so its coordinate
 * matches CK's arithmetic price-width ratio. Equating that observed ratio to
 * CK alpha is a project scenario, not CK's theorem or an identified dealer
 * inventory parameter.
 */
export function estimateCkSkewAt({
  rows,
  index,
  referencePrice = null,
  cycleHalfLifeSessions = null,
  availableAt = null,
} = {}) {
  if (!Array.isArray(rows) || !Number.isInteger(index) || index < 2 || index >= rows.length) {
    return unavailable('insufficient-prefix')
  }

  const cycle = Number(cycleHalfLifeSessions)
  if (!Number.isFinite(cycle) || cycle <= 0) {
    return unavailable('formula-cycle-required-for-causal-weighting')
  }

  const returns = []
  for (let cursor = 1; cursor <= index; cursor += 1) {
    const previous = rows[cursor - 1]?.close
    const current = rows[cursor]?.close
    if (Number.isFinite(previous) && previous > 0 && Number.isFinite(current) && current > 0) {
      returns.push({
        value: Math.log(current / previous),
        weight: Math.pow(2, -(index - cursor) / cycle),
      })
    }
  }
  const positive = returns.filter((item) => item.value > 0)
  const negativeMagnitude = returns
    .filter((item) => item.value < 0)
    .map((item) => ({ value: -item.value, weight: item.weight }))
  const positiveEffectiveSamples = effectiveSampleSize(positive)
  const negativeEffectiveSamples = effectiveSampleSize(negativeMagnitude)
  if (!(positiveEffectiveSamples > 1) || !(negativeEffectiveSamples > 1)) {
    return unavailable('insufficient-two-sided-cycle-samples', {
      sampleSize: returns.length,
      positiveSamples: positive.length,
      negativeSamples: negativeMagnitude.length,
      positiveEffectiveSamples,
      negativeEffectiveSamples,
      cycleHalfLifeSessions: cycle,
    })
  }

  const positiveArithmeticMoves = positive.map((item) => ({
    value: Math.exp(item.value) - 1,
    weight: item.weight,
  }))
  const negativeArithmeticMoves = negativeMagnitude.map((item) => ({
    value: 1 - Math.exp(-item.value),
    weight: item.weight,
  }))
  const positiveConditionalMeanScale = weightedMean(positiveArithmeticMoves)
  const negativeConditionalMeanScale = weightedMean(negativeArithmeticMoves)
  const positiveScaleRobust = weightedQuantile(positiveArithmeticMoves, 0.5)
  const negativeScaleRobust = weightedQuantile(negativeArithmeticMoves, 0.5)
  const conditionalMeanScaleRatio = positiveConditionalMeanScale / negativeConditionalMeanScale
  const directionalMoveScaleRatioEstimate = positiveScaleRobust / negativeScaleRobust
  const positiveLogScaleRobust = weightedQuantile(positive, 0.5)
  const negativeLogScaleRobust = weightedQuantile(negativeMagnitude, 0.5)
  const logScaleRatioApproximation = positiveLogScaleRobust / negativeLogScaleRobust
  const tailModelApproximateLogScaleRatioStandardError =
    (1 / Math.log(2)) * Math.sqrt(1 / positiveEffectiveSamples + 1 / negativeEffectiveSamples)
  const tailModelApproximateLogScaleRatioInterval95 = {
    lower: Math.exp(Math.log(logScaleRatioApproximation) - 1.96 * tailModelApproximateLogScaleRatioStandardError),
    upper: Math.exp(Math.log(logScaleRatioApproximation) + 1.96 * tailModelApproximateLogScaleRatioStandardError),
  }
  const ckSkewAlphaScenario = directionalMoveScaleRatioEstimate
  const price = Number.isFinite(referencePrice) && referencePrice > 0 ? referencePrice : rows[index].close
  const exactGeometry = deriveCkFrontier({
    referencePrice: price,
    skewAlpha: ckSkewAlphaScenario,
    alphaSource: 'scenario-bridge-from-causal-cycle-median-arithmetic-move-scale-ratio',
  })
  const geometry = exactGeometry
    ? {
        ...exactGeometry,
        directionalMoveScaleRatioClaimClass: 'sample-estimate',
        ckSkewAlphaScenarioClaimClass: 'scenario-proxy',
        applicationClaimClass: 'scenario-proxy',
      }
    : null

  return {
    status: geometry ? 'ok' : 'unavailable',
    signalDate: rows[index]?.date ?? null,
    availableAt: availableAt ?? `${rows[index]?.date ?? 'T'}:close`,
    sampleSize: returns.length,
    positiveSamples: positive.length,
    negativeSamples: negativeMagnitude.length,
    positiveEffectiveSamples,
    negativeEffectiveSamples,
    cycleHalfLifeSessions: cycle,
    weightRule: 'w_i=2^(-(T-i)/cycleHalfLifeSessions)',
    positiveConditionalMeanScale,
    negativeConditionalMeanScale,
    positiveScaleRobust,
    negativeScaleRobust,
    conditionalMeanScaleRatio,
    directionalMoveScaleRatioEstimate,
    directionalMoveScaleRatioClaimClass: 'sample-estimate',
    ckSkewAlphaScenario,
    ckSkewAlphaScenarioClaimClass: 'scenario-proxy',
    scenarioBridge:
      'assume CK upper-width/lower-width alpha equals the observed conditional up-move/down-move median scale ratio',
    positiveLogScaleRobust,
    negativeLogScaleRobust,
    logScaleRatioApproximation,
    tailModelApproximateLogScaleRatioStandardError,
    tailModelApproximateLogScaleRatioInterval95,
    uncertaintyAssumptions: [
      'positive-and-negative-tail-observations-treated-as-independent',
      'conditional-log-return-magnitudes-approximated-by-exponential-tails',
      'weighted-effective-sample-size-treated-as-independent-sample-count',
      'normal-approximation-on-log-scale',
    ],
    uncertaintyBoundary:
      'This is a tail-model approximation for the log-return median ratio, not a calibrated standard error for the arithmetic-move ratio or CK alpha scenario.',
    logScaleRatioDisagreement: Math.abs(Math.log(directionalMoveScaleRatioEstimate / conditionalMeanScaleRatio)),
    estimator: 'formula-cycle-weighted-causal-directional-arithmetic-move-scales',
    alphaCoordinate: 'arithmetic-up-move/down-move-width-ratio',
    skewAlphaRobust: directionalMoveScaleRatioEstimate,
    skewAlpha: ckSkewAlphaScenario,
    logAlphaStandardError: tailModelApproximateLogScaleRatioStandardError,
    logScaleRatioInterval95: tailModelApproximateLogScaleRatioInterval95,
    deprecatedAliases: {
      skewAlphaRobust: 'directionalMoveScaleRatioEstimate',
      skewAlpha: 'ckSkewAlphaScenario',
      logAlphaStandardError: 'tailModelApproximateLogScaleRatioStandardError',
      logScaleRatioInterval95: 'tailModelApproximateLogScaleRatioInterval95',
    },
    alphaClaimClass: 'scenario-proxy',
    identificationBoundary:
      'The directional move-scale ratio is a sample estimate; treating it as CK alpha is a scenario bridge and does not identify LP inventory, dealer direction, or a probability distribution.',
    geometry,
  }
}

function unavailable(reason, extra = {}) {
  return {
    status: 'unavailable',
    reason,
    directionalMoveScaleRatioClaimClass: 'missing-input',
    ckSkewAlphaScenarioClaimClass: 'missing-input',
    alphaClaimClass: 'missing-input',
    geometry: null,
    ...extra,
  }
}

function effectiveSampleSize(values) {
  const sum = values.reduce((total, item) => total + item.weight, 0)
  const squareSum = values.reduce((total, item) => total + item.weight ** 2, 0)
  return squareSum > 0 ? (sum * sum) / squareSum : 0
}

function weightedMean(values) {
  const weight = values.reduce((sum, item) => sum + item.weight, 0)
  return weight > 0 ? values.reduce((sum, item) => sum + item.value * item.weight, 0) / weight : null
}

function weightedQuantile(values, probability) {
  const ordered = [...values].sort((left, right) => left.value - right.value)
  const totalWeight = ordered.reduce((sum, item) => sum + item.weight, 0)
  const threshold = totalWeight * probability
  let cumulative = 0
  for (const item of ordered) {
    cumulative += item.weight
    if (cumulative >= threshold) return item.value
  }
  return ordered.at(-1)?.value ?? null
}
