export { normalCdf, normalPdf, inverseNormalCdf, integrateTrapezoid } from './probability.js'
export {
  GET_DELTA_SOURCE,
  asianOption,
  bachelierOption,
  blackScholes,
  getDeltaBandSlope,
  getDeltaBandValue,
  getDeltaBands,
  riskSurface,
} from './options.js'
export { buildOptionPortfolio, optionLegsFromTemplate, normalizeOptionLegs } from './optionPortfolio.js'
export {
  hedgedLpPortfolioCurve,
  fullRangeV2ImpermanentLoss,
  impermanentLoss,
  portfolioValue,
  rangeV3ImpermanentLoss,
  uniswapV2Inventory,
  uniswapV3HedgedInventory,
  uniswapV3HedgedPosition,
  uniswapV3Inventory,
  uniswapV3Payoff,
} from './lp.js'
export {
  buildDensityComponents,
  componentDensity,
  componentMasses,
  coveredCallFit,
  fingerprintStats,
  laplaceDensity,
  liquidityFingerprint,
  logLaplaceDensity,
  normalDensity,
  normalizeComponents,
} from './liquidity.js'
export { ammCurve, ammLambertCurve, lambertW, numoenSnapshot } from './amm.js'
export { formulaEvidenceCatalog, getFormulaEvidence } from './evidence.js'
export { resolveDeltaSlope, resolveExitTargetReturn } from './inputSemantics.js'
export {
  CK_CAPITAL_EFFICIENCY_INFLECTION,
  capitalEfficiency,
  capitalEfficiencyAtPrice,
  capitalEfficiencyFrontier,
  capitalEfficiencySecondDerivative,
  capitalEfficiencySlope,
  ckCapitalEfficiencyReference,
  resolveArithmeticRangeSpec,
  sampleCapitalEfficiencyCurve,
} from './capitalEfficiency.js'
export { compareFeeCarryToTheta, estimateLpPathFees, lpResearchAttribution, netLpEfficiency } from './lpResearch.js'
export {
  DEFAULT_DYNAMIC_HOLDING_PROFILES,
  deriveDrawdownFeatures,
  deriveDynamicHoldingState,
  deriveRecoveryHorizon,
  deriveShortHoldWindow,
  deriveStructuralHoldWindow,
} from './shortHold.js'

import { inverseNormalCdf, normalCdf } from './probability.js'
import { defineLegacyAliasContract } from './legacyAliases.js'

const FUNDING_RATE_LEGACY_CONTRACT = defineLegacyAliasContract({
  basisEstimate: 'basisFraction',
  ratio: 'basisFraction',
  fundingProxy: 'cumulativeFundingProxy',
  cumulativeFundingEstimate: 'cumulativeFundingProxy',
  funding: 'cumulativeFundingProxy',
  hours: 'horizonHours',
})

export function vixFix({ highestClose, low }) {
  if (![highestClose, low].every(Number.isFinite) || highestClose <= 0) return null
  return Math.max(0, (highestClose - low) / highestClose)
}

export function estimateCumulativeFundingProxy({ perpTwap, spotTwap, horizonHours }) {
  if (![perpTwap, spotTwap, horizonHours].every(Number.isFinite) || spotTwap <= 0 || horizonHours < 0) return null
  const basisFraction = perpTwap / spotTwap - 1
  const cumulativeFundingProxy = basisFraction * (horizonHours / 24)
  return {
    basisFraction,
    cumulativeFundingProxy,
    horizonHours,
    status: 'proxy-only',
  }
}

/** @deprecated Use estimateCumulativeFundingProxy with horizonHours. */
export function fundingRate({ perpTwap, spotTwap, hours }) {
  if (![perpTwap, spotTwap, hours].every(Number.isFinite) || spotTwap <= 0 || hours < 0) return null
  const canonical = estimateCumulativeFundingProxy({ perpTwap, spotTwap, horizonHours: hours })
  const { basisFraction, cumulativeFundingProxy } = canonical
  return {
    ...canonical,
    basisEstimate: basisFraction,
    ratio: basisFraction,
    fundingProxy: cumulativeFundingProxy,
    cumulativeFundingEstimate: cumulativeFundingProxy,
    funding: cumulativeFundingProxy,
    hours,
    ...FUNDING_RATE_LEGACY_CONTRACT,
    status: 'proxy-only',
  }
}

export function deviationScore({ costDistance, annualVol, formulaHorizonSessions = null, tradingDaysPerYear }) {
  if (![costDistance, annualVol, formulaHorizonSessions, tradingDaysPerYear].every(Number.isFinite)) return null
  if (annualVol <= 0 || formulaHorizonSessions <= 0 || tradingDaysPerYear <= 0) return null
  const periodVol = annualVol * Math.sqrt(formulaHorizonSessions / tradingDaysPerYear)
  const z = periodVol > 0 ? costDistance / periodVol : 0
  const phi = normalCdf(Math.abs(z))
  const absoluteZPercentile = phi !== null ? Math.max(0.5, Math.min(1, phi)) : 0.5
  const deviationPercentile = Math.max(0, Math.min(1, 2 * absoluteZPercentile - 1))
  const twoSidedTailProbability = Math.max(0, Math.min(1, 2 * (1 - absoluteZPercentile)))
  return {
    z,
    periodVol,
    absoluteZPercentile,
    deviationPercentile,
    twoSidedTailProbability,
    formulaHorizonSessions,
    inputSemantics: 'canonical-formula-horizon-sessions',
    probabilitySemantics: 'normal-reference-extremeness-not-mean-reversion-probability',
    regime: costDistance < 0 ? '折价' : costDistance > 0 ? '溢价' : '平价',
    strength: Math.abs(z) < 0.5 ? '弱' : Math.abs(z) < 1.5 ? '中' : '强',
  }
}

export function meanReversionHalfLife({ costDistanceSeries }) {
  if (!Array.isArray(costDistanceSeries) || costDistanceSeries.length < 5) return null
  const valid = costDistanceSeries.filter(Number.isFinite)
  if (valid.length < 5) return null

  let sumXY = 0
  let sumX2 = 0
  for (let i = 1; i < valid.length; i += 1) {
    sumXY += valid[i] * valid[i - 1]
    sumX2 += valid[i - 1] * valid[i - 1]
  }
  const arCoefficient = sumX2 > 0 ? sumXY / sumX2 : 0
  const absRho = Math.abs(arCoefficient)
  const isMeanReverting = absRho < 1
  const arDecayRatePerStep = absRho > 0 && isMeanReverting ? -Math.log(absRho) : null
  const halfLifeSessions =
    absRho === 0
      ? 0
      : Number.isFinite(arDecayRatePerStep) && arDecayRatePerStep > 0
        ? Math.log(2) / arDecayRatePerStep
        : null
  const evidenceScale = Math.sqrt(valid.length)
  const halfLifeToEvidenceScale =
    Number.isFinite(halfLifeSessions) && evidenceScale > 0 ? halfLifeSessions / evidenceScale : null
  const speed = halfLifeSessions !== null ? '条件衰减' : '无回归'

  const decayMode = !isMeanReverting
    ? 'non-stationary'
    : absRho === 0
      ? 'immediate'
      : arCoefficient < 0
        ? 'oscillating-decay'
        : 'monotonic-decay'
  return {
    arCoefficient,
    arDecayRatePerStep,
    halfLifeSessions,
    evidenceScale,
    halfLifeToEvidenceScale,
    speed,
    isMeanReverting,
    decayMode,
    sampleSize: valid.length,
    periodNote: `基于 ${valid.length} 个已闭合交易会话样本，半衰 ${halfLifeSessions !== null ? Math.round(halfLifeSessions) : '不可定义'} 个交易会话`,
  }
}

export function gammaPnl({ gamma, priceChange, positionSize = 1, markPrice = null }) {
  if (![gamma, priceChange, positionSize].every(Number.isFinite)) return null
  if (markPrice !== null && (!Number.isFinite(markPrice) || markPrice <= 0)) return null
  const positionGamma = gamma * positionSize
  const hasMarkPrice = Number.isFinite(markPrice) && markPrice > 0
  const dollarGamma = hasMarkPrice ? positionGamma * markPrice * markPrice : null
  const priceChangePct = hasMarkPrice ? priceChange / markPrice : null
  const pnl = 0.5 * positionGamma * priceChange * priceChange
  const convexityNote = positionGamma > 0 ? '多头凸性 · 波动有利' : positionGamma < 0 ? '空头凸性 · 波动不利' : '零凸性'
  return {
    positionGamma,
    dollarGamma,
    priceChange,
    priceChangePct,
    gammaPnl: pnl,
    dailyEstimate: pnl,
    convexityNote,
    dollarGammaNote: hasMarkPrice
      ? 'Dollar Gamma = positionGamma × markPrice²；Gamma PnL = 0.5 × Dollar Gamma × (ΔP / markPrice)²'
      : '未提供 markPrice；仅计算绝对价格变动口径的 Gamma PnL，Dollar Gamma 不可用',
  }
}

export function volConfidence({ annualVol, sampleSize, confidenceLevel = 0.68 }) {
  if (![annualVol, sampleSize, confidenceLevel].every(Number.isFinite)) return null
  if (annualVol <= 0 || sampleSize < 5 || confidenceLevel <= 0 || confidenceLevel >= 1) return null

  const se = annualVol / Math.sqrt(2 * sampleSize)
  const z = inverseNormalCdf((1 + confidenceLevel) / 2)
  if (!Number.isFinite(z)) return null
  const lower = Math.max(0, annualVol - z * se)
  const upper = annualVol + z * se
  const relativeUncertainty = se / annualVol

  const quality =
    relativeUncertainty <= 0.1
      ? '近似不确定性低'
      : relativeUncertainty <= 0.2
        ? '近似不确定性中'
        : relativeUncertainty <= 0.3
          ? '近似不确定性高'
          : '近似不可靠'

  const assumptions = [
    'independent-identically-distributed-returns',
    'normally-distributed-returns',
    'constant-volatility-over-sample',
    'equally-spaced-trading-sessions',
  ]

  return {
    claimClass: 'sample-estimate',
    method: 'iid-normal-volatility-standard-error-approximation',
    assumptions,
    isRobustConfidenceInterval: false,
    annualVol,
    se,
    lower,
    upper,
    relativeUncertainty,
    quality,
    sampleSize,
    confidenceLevel,
    zScore: z,
    note: `基于 ${sampleSize} 样本的 IID 正态独立收益假设，波动率近似区间为 [${(lower * 100).toFixed(1)}%, ${(upper * 100).toFixed(1)}%]（名义水平 ${(confidenceLevel * 100).toFixed(0)}%）；这不是针对厚尾、自相关或波动率时变数据的稳健置信区间。`,
  }
}

export function netCarry({
  cycleStartPrice,
  targetPrice,
  side,
  cumulativeFundingProxy,
  fundingPositionSide,
  recoveryNotionalBasis,
  fundingNotionalBasis,
  fundingHorizonHours,
  comparisonHorizon,
}) {
  if (![cycleStartPrice, targetPrice, cumulativeFundingProxy, fundingHorizonHours].every(Number.isFinite)) return null
  if (cycleStartPrice <= 0 || targetPrice <= 0 || fundingHorizonHours <= 0) return null
  if (!['long', 'short'].includes(side) || !['long', 'short'].includes(fundingPositionSide)) return null
  if (!nonEmpty(recoveryNotionalBasis) || recoveryNotionalBasis !== fundingNotionalBasis) return null
  const horizon = normalizeCarryHorizon(comparisonHorizon, fundingHorizonHours)
  if (!horizon) return null
  const grossRecoveryReturn =
    side === 'long' ? targetPrice / cycleStartPrice - 1 : (cycleStartPrice - targetPrice) / cycleStartPrice
  if (!Number.isFinite(grossRecoveryReturn) || grossRecoveryReturn <= 0) return null
  const fundingCashflowReturn = fundingPositionSide === 'long' ? -cumulativeFundingProxy : cumulativeFundingProxy
  const fundingNetCostReturn = -fundingCashflowReturn
  const netReturn = grossRecoveryReturn + fundingCashflowReturn
  return {
    cycleStartPrice,
    targetPrice,
    side,
    cumulativeFundingProxy,
    fundingPositionSide,
    fundingRule: 'positive-proxy-long-pays-short',
    grossRecoveryReturn,
    fundingCashflowReturn,
    fundingNetCostReturn,
    netReturn,
    breakEvenFundingNetCostReturn: grossRecoveryReturn,
    scenarioViable: netReturn > 0,
    notionalBasis: recoveryNotionalBasis,
    comparisonHorizon: horizon,
    claimClass: 'scenario-proxy',
    executionAuthority: 'none',
    status: 'proxy-only',
  }
}

/** @deprecated Old distance/funding names lack the side, notional and horizon data required for a carry comparison. */
export function legacyNetCarry({ costDistance, fundingRate = null, fundingCost = null } = {}) {
  const supplied = [costDistance, fundingRate, fundingCost].some(Number.isFinite)
  if (!supplied) return null
  return {
    netReturn: null,
    scenarioViable: null,
    status: 'calibration-required',
    legacyCompatibility: true,
    deprecatedInputs: {
      ...(Number.isFinite(costDistance)
        ? { costDistance: { deprecated: true, accepted: false, reason: 'anchor-denominator-and-side-ambiguous' } }
        : {}),
      ...(Number.isFinite(fundingRate)
        ? { fundingRate: { deprecated: true, accepted: false, reason: 'period-and-position-side-ambiguous' } }
        : {}),
      ...(Number.isFinite(fundingCost)
        ? { fundingCost: { deprecated: true, accepted: false, reason: 'settlement-versus-proxy-ambiguous' } }
        : {}),
    },
    missingInputs: [
      'cycle-start-price',
      'target-price',
      'recovery-side',
      'funding-position-side',
      'common-notional-basis',
      'comparison-horizon',
    ],
  }
}

function normalizeCarryHorizon(horizon, fundingHorizonHours) {
  if (!horizon || typeof horizon !== 'object') return null
  const sessions = Number(horizon.sessions)
  const sessionDurationHours = Number(horizon.sessionDurationHours)
  if (!Number.isFinite(sessions) || sessions <= 0) return null
  if (!Number.isFinite(sessionDurationHours) || sessionDurationHours <= 0) return null
  if (!nonEmpty(horizon.sessionCalendarId) || !nonEmpty(horizon.source) || !nonEmpty(horizon.availableAt)) return null
  const mappedHours = sessions * sessionDurationHours
  if (Math.abs(mappedHours - fundingHorizonHours) > Number.EPSILON * Math.max(mappedHours, fundingHorizonHours, 1)) {
    return null
  }
  return {
    sessions,
    sessionDurationHours,
    fundingHorizonHours,
    sessionCalendarId: horizon.sessionCalendarId,
    source: horizon.source,
    availableAt: horizon.availableAt,
  }
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}
