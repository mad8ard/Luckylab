import { defineLegacyAliasContract } from './legacyAliases.js'

const NET_LP_EFFICIENCY_LEGACY_CONTRACT = defineLegacyAliasContract({
  impermanentLoss: 'lpIlFraction',
  horizonDays: 'horizonSessions',
})
const FEE_THETA_LEGACY_CONTRACT = defineLegacyAliasContract({
  feeAccrualDays: 'feeAccrualSessions',
  optionThetaDaily: 'optionThetaPerSession',
  feeCarryPerSession: 'feeCarryQuotePerSession',
  thetaPerSession: 'optionThetaQuotePerSession',
  feeCarryPerDay: 'feeCarryQuotePerSession',
  thetaDaily: 'optionThetaQuotePerSession',
})

/**
 * Keep dimensionless capital efficiency separate from same-horizon returns.
 * CE is geometry; IL and fees can only be netted when their basis and horizon
 * are explicitly aligned.
 */
export function lpResearchAttribution({
  capitalEfficiency,
  lpIlFraction,
  ilModel = null,
  capitalBasis = null,
  startPrice = null,
  markPrice = null,
  lowerPrice = null,
  upperPrice = null,
  feeReturn = null,
  feeSource = null,
  feeTreatment = null,
  horizonSessions = null,
} = {}) {
  if (!Number.isFinite(capitalEfficiency) || capitalEfficiency <= 0) return null
  const il = Number.isFinite(lpIlFraction) ? lpIlFraction : null
  const fee = Number.isFinite(feeReturn) ? feeReturn : null
  const hasIlModel = typeof ilModel === 'string' && ilModel.length > 0
  const hasCapitalBasis = typeof capitalBasis === 'string' && capitalBasis.length > 0
  const validPrices = Number.isFinite(startPrice) && startPrice > 0 && Number.isFinite(markPrice) && markPrice > 0
  const isV3RangeModel = hasIlModel && ilModel.includes('v3')
  const isFullRangeV2Model = hasIlModel && ilModel.includes('v2-full-range')
  const validRange = isV3RangeModel
    ? Number.isFinite(lowerPrice) && lowerPrice > 0 && Number.isFinite(upperPrice) && upperPrice > lowerPrice
    : isFullRangeV2Model
  const hasFeeSource = typeof feeSource === 'string' && feeSource.length > 0
  const validFeeTreatment = ['path-observed', 'explicit-scenario', 'excluded'].includes(feeTreatment)
  const validHorizon = Number.isFinite(horizonSessions) && horizonSessions > 0
  const comparableReturns =
    il !== null &&
    fee !== null &&
    hasIlModel &&
    hasCapitalBasis &&
    validPrices &&
    validRange &&
    hasFeeSource &&
    validFeeTreatment &&
    feeTreatment !== 'excluded' &&
    validHorizon
  const missingInputs = []
  if (il === null) missingInputs.push('same-horizon-impermanent-loss')
  if (!hasIlModel) missingInputs.push('il-model')
  if (!hasCapitalBasis) missingInputs.push('common-capital-basis')
  if (!validPrices) missingInputs.push('il-start-and-mark-price')
  if (!validRange) missingInputs.push('il-model-range')
  if (fee === null) missingInputs.push('realized-or-path-fee-return')
  if (!hasFeeSource) missingInputs.push('path-fee-source')
  if (!validFeeTreatment) missingInputs.push('fee-treatment')
  if (!validHorizon) missingInputs.push('fee-and-il-horizon')
  return {
    status: comparableReturns ? 'scenario-attribution' : 'calibration-required',
    geometry: {
      capitalEfficiency,
      unit: 'multiple',
      comparableToReturns: false,
    },
    returns: {
      lpIlFraction: il,
      ilModel: hasIlModel ? ilModel : null,
      capitalBasis: hasCapitalBasis ? capitalBasis : null,
      startPrice: validPrices ? startPrice : null,
      markPrice: validPrices ? markPrice : null,
      lowerPrice: isV3RangeModel && validRange ? lowerPrice : null,
      upperPrice: isV3RangeModel && validRange ? upperPrice : null,
      feeReturn: fee,
      netReturn: comparableReturns ? il + fee : null,
      horizonSessions: validHorizon ? horizonSessions : null,
      unit: 'return-on-common-capital-basis',
    },
    feeModel: {
      source: feeSource,
      treatment: validFeeTreatment ? feeTreatment : null,
      pathDependent: true,
      calibrated: fee !== null && Boolean(feeSource),
    },
    missingInputs,
    relation: 'decomposition-not-capital-efficiency-sum',
  }
}

/**
 * Compatibility entry point.  The legacy `feeRate` argument was commonly a
 * pool fee tier, so it is deliberately ignored: a tier is not fee revenue.
 */
export function netLpEfficiency({ capitalEfficiency, impermanentLoss, feeRate = null, horizonDays = null } = {}) {
  const attribution = lpResearchAttribution({
    capitalEfficiency,
    lpIlFraction: impermanentLoss,
    ilModel: 'legacy-unspecified-il-model',
    capitalBasis: 'legacy-unspecified-capital-basis',
    startPrice: null,
    markPrice: null,
    feeReturn: null,
    feeSource: null,
    feeTreatment: null,
    horizonSessions: horizonDays,
  })
  return attribution
    ? {
        ...attribution,
        legacyCompatibility: true,
        ...NET_LP_EFFICIENCY_LEGACY_CONTRACT,
        deprecatedInputs: Number.isFinite(feeRate)
          ? {
              feeRate: {
                deprecated: true,
                accepted: false,
                reason: 'fee-tier-is-not-realized-fee-income',
                replacementRequirements: ['feeReturn', 'feeSource', 'feeTreatment', 'horizonSessions'],
              },
            }
          : {},
        ignoredInputs: Number.isFinite(feeRate) ? ['feeRate-without-volume-path'] : [],
      }
    : null
}

export function compareFeeCarryToTheta({
  feeIncomeQuote,
  feeAccrualSessions,
  optionThetaPerSession,
  optionTimeToExpirySessions,
  feeSignConvention,
  optionThetaSignConvention,
  feeAccrualDays: legacyFeeAccrualDays,
  optionThetaDaily: legacyOptionThetaDaily,
  contractMultiplier = 1,
  feeCurrency,
  optionCurrency,
  feeNotional,
  optionNotional,
  feeSessionCalendarId,
  optionSessionCalendarId,
  feeAccrualStart,
  feeAccrualEnd,
  optionThetaAsOf,
} = {}) {
  const adapted = adaptLegacyThetaComparisonInputs({
    feeAccrualSessions,
    optionThetaPerSession,
    legacyFeeAccrualDays,
    legacyOptionThetaDaily,
  })
  const sameCurrency = Boolean(feeCurrency) && feeCurrency === optionCurrency
  const validNotionals =
    Number.isFinite(feeNotional) && feeNotional > 0 && Number.isFinite(optionNotional) && optionNotional > 0
  const sameNotional =
    validNotionals &&
    Math.abs(feeNotional - optionNotional) <= Number.EPSILON * Math.max(feeNotional, optionNotional, 1)
  const validComparisonHorizon = Number.isFinite(adapted.feeAccrualSessions) && adapted.feeAccrualSessions > 0
  const validOptionTenor =
    Number.isFinite(optionTimeToExpirySessions) &&
    optionTimeToExpirySessions > 0 &&
    validComparisonHorizon &&
    optionTimeToExpirySessions >= adapted.feeAccrualSessions
  const validFee = Number.isFinite(feeIncomeQuote)
  const validTheta =
    Number.isFinite(adapted.optionThetaPerSession) && Number.isFinite(contractMultiplier) && contractMultiplier > 0
  const alignedSigns =
    feeSignConvention === 'income-positive' &&
    optionThetaSignConvention === 'long-option-value-change' &&
    validTheta &&
    adapted.optionThetaPerSession <= 0
  const sameSessionCalendar =
    nonEmptyString(feeSessionCalendarId) &&
    nonEmptyString(optionSessionCalendarId) &&
    feeSessionCalendarId === optionSessionCalendarId
  const validAccrualInterval = validOrderedInterval(feeAccrualStart, feeAccrualEnd)
  const thetaAsOfAligned = validAccrualInterval && sameInstant(optionThetaAsOf, feeAccrualStart)
  const comparable =
    sameCurrency &&
    sameNotional &&
    validComparisonHorizon &&
    validOptionTenor &&
    validFee &&
    validTheta &&
    alignedSigns &&
    sameSessionCalendar &&
    validAccrualInterval &&
    thetaAsOfAligned
  const feeCarryQuotePerSession =
    validFee && validComparisonHorizon ? feeIncomeQuote / adapted.feeAccrualSessions : null
  const optionThetaQuotePerSession = validTheta ? adapted.optionThetaPerSession * contractMultiplier : null
  const optionThetaDecayQuote = comparable ? -optionThetaQuotePerSession * adapted.feeAccrualSessions : null
  const feeThetaGapQuote = comparable ? feeIncomeQuote - optionThetaDecayQuote : null
  const normalizedFeeCarry = comparable ? feeIncomeQuote / feeNotional : null
  const normalizedThetaDecay = comparable ? optionThetaDecayQuote / optionNotional : null
  return {
    relation: 'analogy-not-identity',
    status: comparable ? 'comparable-local-linear-scenario' : 'calibration-required',
    comparable,
    comparisonHorizonSessions: validComparisonHorizon ? adapted.feeAccrualSessions : null,
    optionTimeToExpirySessions: Number.isFinite(optionTimeToExpirySessions) ? optionTimeToExpirySessions : null,
    comparisonSessionCalendarId: sameSessionCalendar ? feeSessionCalendarId : null,
    comparisonInterval: validAccrualInterval ? { start: feeAccrualStart, end: feeAccrualEnd, optionThetaAsOf } : null,
    comparisonNotional: sameNotional ? feeNotional : null,
    feeCarryQuotePerSession,
    optionThetaQuotePerSession,
    feeCarryQuote: comparable ? feeIncomeQuote : null,
    optionThetaDecayQuote,
    feeThetaGapQuote,
    normalizedFeeCarry,
    normalizedThetaDecay,
    coverageRatio: comparable && normalizedThetaDecay > 0 ? normalizedFeeCarry / normalizedThetaDecay : null,
    signConvention: comparable
      ? {
          fee: 'income-positive',
          optionThetaInput: 'long-option-value-change',
          comparison: 'fee-income-versus-positive-long-option-time-decay-cost',
        }
      : null,
    assumptions: [
      'optionThetaPerSession-is-held-constant-over-comparison-horizon',
      'feeAccrualSessions-matches-the-declared-session-calendar-and-interval',
      'comparison-excludes-gamma-jumps-hedging-gas-and-rebalancing',
    ],
    claimClass: 'scenario-proxy',
    missingInputs: [
      sameCurrency ? null : 'same-currency',
      sameNotional ? null : 'same-notional-basis',
      validComparisonHorizon ? null : 'fee-accrual-horizon-sessions',
      validOptionTenor ? null : 'option-tenor-covering-comparison-horizon',
      validFee ? null : 'path-fee-income',
      validTheta ? null : 'option-theta-per-session',
      alignedSigns ? null : 'aligned-sign-convention',
      sameSessionCalendar ? null : 'same-session-calendar',
      validAccrualInterval ? null : 'valid-fee-accrual-interval',
      thetaAsOfAligned ? null : 'option-theta-as-of-accrual-start',
    ].filter(Boolean),
    inputSources: adapted.inputSources,
    legacyInputSemantics: adapted.legacyInputSemantics,
    // Deprecated compatibility aliases. Values remain per trading session, never calendar-day values.
    feeCarryPerSession: feeCarryQuotePerSession,
    thetaPerSession: optionThetaQuotePerSession,
    feeCarryPerDay: feeCarryQuotePerSession,
    thetaDaily: optionThetaQuotePerSession,
    ...FEE_THETA_LEGACY_CONTRACT,
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function validOrderedInterval(start, end) {
  if (!nonEmptyString(start) || !nonEmptyString(end)) return false
  const startTimestamp = Date.parse(start)
  const endTimestamp = Date.parse(end)
  return Number.isFinite(startTimestamp) && Number.isFinite(endTimestamp) && endTimestamp > startTimestamp
}

function sameInstant(left, right) {
  if (!nonEmptyString(left) || !nonEmptyString(right)) return false
  const leftTimestamp = Date.parse(left)
  const rightTimestamp = Date.parse(right)
  return Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp) && leftTimestamp === rightTimestamp
}

function adaptLegacyThetaComparisonInputs({
  feeAccrualSessions,
  optionThetaPerSession,
  legacyFeeAccrualDays,
  legacyOptionThetaDaily,
}) {
  const hasCanonicalHorizon = Number.isFinite(feeAccrualSessions)
  const hasCanonicalTheta = Number.isFinite(optionThetaPerSession)
  const usesLegacyHorizon = !hasCanonicalHorizon && Number.isFinite(legacyFeeAccrualDays)
  const usesLegacyTheta = !hasCanonicalTheta && Number.isFinite(legacyOptionThetaDaily)
  return {
    feeAccrualSessions: hasCanonicalHorizon ? feeAccrualSessions : usesLegacyHorizon ? legacyFeeAccrualDays : null,
    optionThetaPerSession: hasCanonicalTheta ? optionThetaPerSession : usesLegacyTheta ? legacyOptionThetaDaily : null,
    inputSources: {
      feeAccrualSessions: hasCanonicalHorizon
        ? 'feeAccrualSessions'
        : usesLegacyHorizon
          ? 'deprecated:feeAccrualDays-as-trading-sessions'
          : 'missing-input',
      optionThetaPerSession: hasCanonicalTheta
        ? 'optionThetaPerSession'
        : usesLegacyTheta
          ? 'deprecated:optionThetaDaily-as-trading-session-theta'
          : 'missing-input',
    },
    legacyInputSemantics:
      usesLegacyHorizon || usesLegacyTheta ? 'deprecated-day-fields-adapted-as-trading-session-fields' : null,
  }
}

/**
 * Approximate fee growth along an observed/simulated volume path.  Each step
 * must carry its own active-liquidity share; a fee tier alone never creates
 * revenue.
 */
export function estimateLpPathFees({ steps, initialCapitalQuote, currency = null } = {}) {
  if (!Array.isArray(steps) || !steps.length) {
    return {
      status: 'calibration-required',
      feeIncomeQuote: null,
      feeReturn: null,
      currency,
      steps: [],
      missingInputs: ['volume-path'],
    }
  }
  const missingInputs = new Set()
  const breakdown = steps.map((step, index) => {
    const volumeQuote = optionalNonNegative(step?.volumeQuote)
    const feeTier = optionalNonNegative(step?.feeTier)
    const positionLiquidity = optionalNonNegative(step?.positionLiquidity)
    const activeLiquidity = optionalPositive(step?.activeLiquidity)
    const hasInRangeFraction = present(step?.inRangeFraction)
    const inRangeFraction = hasInRangeFraction ? optionalFraction(step.inRangeFraction) : 1
    if (volumeQuote === null) missingInputs.add(`steps[${index}].volumeQuote`)
    if (feeTier === null) missingInputs.add(`steps[${index}].feeTier`)
    if (positionLiquidity === null) missingInputs.add(`steps[${index}].positionLiquidity`)
    if (activeLiquidity === null) missingInputs.add(`steps[${index}].activeLiquidity`)
    if (hasInRangeFraction && inRangeFraction === null) missingInputs.add(`steps[${index}].inRangeFraction`)
    const share =
      positionLiquidity !== null && activeLiquidity !== null
        ? Math.max(0, Math.min(1, positionLiquidity / activeLiquidity))
        : null
    const grossFee = [volumeQuote, feeTier, share, inRangeFraction].every(Number.isFinite)
      ? volumeQuote * feeTier * share * inRangeFraction
      : null
    const hasGasCost = present(step?.gasCostQuote)
    const hasRebalanceCost = present(step?.rebalanceCostQuote)
    const gasCostQuote = hasGasCost ? optionalNonNegative(step.gasCostQuote) : 0
    const rebalanceCostQuote = hasRebalanceCost ? optionalNonNegative(step.rebalanceCostQuote) : 0
    if (hasGasCost && gasCostQuote === null) missingInputs.add(`steps[${index}].gasCostQuote`)
    if (hasRebalanceCost && rebalanceCostQuote === null) missingInputs.add(`steps[${index}].rebalanceCostQuote`)
    const costs = [gasCostQuote, rebalanceCostQuote].every(Number.isFinite) ? gasCostQuote + rebalanceCostQuote : null
    return {
      index,
      volumeQuote,
      feeTier,
      positionShare: share,
      inRangeFraction,
      grossFee,
      costs,
      netFee: Number.isFinite(grossFee) && Number.isFinite(costs) ? grossFee - costs : null,
    }
  })
  const complete = breakdown.every((step) => Number.isFinite(step.netFee))
  const feeIncomeQuote = complete ? breakdown.reduce((sum, step) => sum + step.netFee, 0) : null
  const capital = optionalPositive(initialCapitalQuote)
  if (capital === null) missingInputs.add('initial-capital-quote')
  return {
    status: complete && capital !== null ? 'path-scenario' : 'calibration-required',
    feeIncomeQuote,
    feeReturn: complete && capital !== null ? feeIncomeQuote / capital : null,
    currency,
    steps: breakdown,
    pathDependent: true,
    missingInputs: [...missingInputs],
  }
}

function optionalNonNegative(value) {
  if (value === null || value === undefined || value === '') return null
  const next = Number(value)
  return Number.isFinite(next) && next >= 0 ? next : null
}

function optionalPositive(value) {
  const next = optionalNonNegative(value)
  return next !== null && next > 0 ? next : null
}

function optionalFraction(value) {
  const next = optionalNonNegative(value)
  return next !== null && next <= 1 ? next : null
}

function present(value) {
  return value !== null && value !== undefined && value !== ''
}
