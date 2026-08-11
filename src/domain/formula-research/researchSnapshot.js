import {
  asianOption,
  bachelierOption,
  blackScholes,
  buildOptionPortfolio,
  capitalEfficiency,
  fullRangeV2ImpermanentLoss,
  estimateCumulativeFundingProxy,
  hedgedLpPortfolioCurve,
  liquidityFingerprint,
  netCarry,
  numoenSnapshot,
  optionLegsFromTemplate,
  rangeV3ImpermanentLoss,
  uniswapV2Inventory,
  uniswapV3HedgedInventory,
  uniswapV3HedgedPosition,
  uniswapV3Inventory,
} from '../formulas/core.js'
import { resolveLpValuationSpec } from '../lp/lpValuationSpec.js'
import { buildLpDataState } from '../market-data/lpOnchain.js'
import { buildPortfolioResearch } from './portfolioResearch.js'

export function buildResearchSnapshot({ market, input, executable }) {
  const { entryPrice, iv } = executable.inputs
  const formulaHorizonSessions = positive(executable.inputs.formulaHorizonSessions)
  const optionTenorSessions = positive(input.optionTenorSessions)
  const lpDataState = buildLpDataState(input.lpOnchainSnapshot)
  const lpValuation = resolveLpValuationSpec({ input, lpDataState })
  const rangeSpec = lpValuation.rangeSpec
  const rangeWidth = lpValuation.rangeWidth
  const tdpy = positive(input.tradingDaysPerYear)
  const strikePrice = positive(input.strikePrice) || entryPrice * 1.05
  const startPrice = lpValuation.startPrice
  const liquidity = lpValuation.liquidity
  const hedgeSize = Number(input.hedgeSize) || 0
  const feeIncomeQuote = optionalFinite(input.feeIncomeQuote)
  const fundingCashflowSource = ['observed-settlement', 'explicit-scenario'].includes(input.fundingCashflowSource)
    ? input.fundingCashflowSource
    : null
  const fundingCashflowQuote = fundingCashflowSource ? optionalFinite(input.fundingCashflowQuote) : null
  const fundingSessionDurationHours = positive(input.fundingSessionDurationHours)
  const skew = rangeSpec?.skew ?? null
  const option = blackScholes({
    entryPrice,
    strikePrice,
    timeToExpirySessions: optionTenorSessions,
    iv,
    riskFreeRate: Number(input.riskFreeRate) || 0,
    dividendYield: Number(input.dividendYield) || 0,
    type: input.optionType,
    tradingDaysPerYear: tdpy,
  })
  const optionLegs = optionLegsFromTemplate({
    strategy: input.optionStrategy,
    side: input.optionSide,
    optionType: input.optionType,
    entryPrice,
    strikePrice,
    strikePrice2: Number(input.strikePrice2),
    quantity: Number(input.optionQuantity) || 1,
    widthPct: Number(input.optionWidthPct) || rangeWidth || 0.05,
    premium: optionalFinite(input.optionPremium),
  })
  const optionPortfolio = buildOptionPortfolio({
    entryPrice,
    timeToExpirySessions: optionTenorSessions,
    iv,
    riskFreeRate: Number(input.riskFreeRate) || 0,
    dividendYield: Number(input.dividendYield) || 0,
    tradingDaysPerYear: tdpy,
    contractMultiplier: Number(input.optionMultiplier) || 1,
    volatilitySource: input.ivSource || 'scenario-unspecified',
    volatilitySourceVerified: input.ivSourceVerified === true,
    legs: optionLegs,
  })
  const asian = asianOption({
    entryPrice,
    strikePrice,
    timeToExpirySessions: optionTenorSessions,
    iv,
    riskFreeRate: Number(input.riskFreeRate) || 0,
    type: input.optionType,
    tradingDaysPerYear: tdpy,
  })
  const bachelier = bachelierOption({
    entryPrice,
    strikePrice,
    timeToExpirySessions: optionTenorSessions,
    normalVol: iv * entryPrice,
    riskFreeRate: Number(input.riskFreeRate) || 0,
    type: input.optionType,
    tradingDaysPerYear: tdpy,
  })
  const lp = lpValuation.available
    ? uniswapV2Inventory({
        markPrice: entryPrice,
        startPrice,
        liquidity,
        hedgeSize,
        feeIncomeQuote,
      })
    : null
  const lowerPrice = lpValuation.lowerPrice
  const upperPrice = lpValuation.upperPrice
  const rangeFactor = rangeSpec ? Math.sqrt(upperPrice / lowerPrice) : null
  const lpV3Raw = lpValuation.available
    ? uniswapV3Inventory({ markPrice: entryPrice, lowerPrice, upperPrice, liquidity })
    : null
  const lpV3Entry = lpValuation.available
    ? uniswapV3Inventory({ markPrice: startPrice, lowerPrice, upperPrice, liquidity })
    : null
  const lpV3SymmetricApprox = lpValuation.available
    ? uniswapV3HedgedInventory({
        markPrice: entryPrice,
        strikePrice: startPrice,
        rangeFactor,
        liquidity,
        hedgeSize,
        feeIncomeQuote,
      })
    : null
  const lpV3Hedged = lpValuation.available
    ? uniswapV3HedgedPosition({
        markPrice: entryPrice,
        startPrice,
        lowerPrice,
        upperPrice,
        liquidity,
        hedgeSize,
        feeIncomeQuote,
      })
    : null
  const fullRangeV2Il = lpValuation.available
    ? fullRangeV2ImpermanentLoss({ markPrice: entryPrice, startPrice, liquidity })
    : null
  const rangeV3Il = lpValuation.available
    ? rangeV3ImpermanentLoss({ markPrice: entryPrice, startPrice, lowerPrice, upperPrice, liquidity })
    : null
  const hasFundingInputs = positive(input.perpTwap) !== null && positive(input.spotTwap) !== null
  const funding =
    hasFundingInputs && formulaHorizonSessions && fundingSessionDurationHours
      ? estimateCumulativeFundingProxy({
          perpTwap: positive(input.perpTwap),
          spotTwap: positive(input.spotTwap),
          horizonHours: formulaHorizonSessions * fundingSessionDurationHours,
        })
      : null
  const fundingCarry = funding
    ? netCarry({
        cycleStartPrice: executable.inputs.horizonCycleStartPrice,
        targetPrice: executable.inputs.horizonTargetPrice,
        side: executable.inputs.formulaHorizonSide,
        cumulativeFundingProxy: funding.cumulativeFundingProxy,
        fundingPositionSide: input.fundingPositionSide,
        recoveryNotionalBasis: input.recoveryNotionalBasis,
        fundingNotionalBasis: input.fundingNotionalBasis,
        fundingHorizonHours: funding.horizonHours,
        comparisonHorizon: {
          sessions: formulaHorizonSessions,
          sessionDurationHours: fundingSessionDurationHours,
          sessionCalendarId: input.fundingSessionCalendarId,
          source: executable.inputs.horizonTargetSource,
          availableAt: executable.inputs.horizonAvailableAt,
        },
      })
    : null
  const optionBase = option?.price ?? null
  const lpPortfolio =
    lpValuation.available && option && Number.isFinite(feeIncomeQuote) && Number.isFinite(fundingCashflowQuote)
      ? hedgedLpPortfolioCurve({
          startPrice: entryPrice,
          lowerPrice,
          upperPrice,
          liquidity,
          hedgeSize,
          feeIncomeQuote,
          fundingCashflowQuote,
          fundingCashflowSource,
          optionWeight: 1,
          optionPricer: (price) =>
            optionLegPnL({
              price,
              strikePrice,
              optionTenorSessions,
              iv,
              input,
              tdpy,
              optionBase,
            }),
        })
      : null
  const fingerprint = liquidityFingerprint({
    entryPrice: market.costAnchor || entryPrice,
    priceGrid: 120,
    distribution: 'log-laplace',
    lambda: Number(input.fingerprintLambda) || 2.6,
    kappa: Number(input.fingerprintKappa) || 0.77,
    lowerFactor: Math.max(0.05, (market.costLow || entryPrice * 0.9) / (market.costAnchor || entryPrice)),
    upperFactor: Math.min(20, (market.costHigh || entryPrice * 1.1) / (market.costAnchor || entryPrice)),
    segmentCount: 12,
    activePrice: entryPrice,
    costAnchor: market.costAnchor,
    targetRange: { lower: market.costLow, upper: market.costHigh },
    volatility: iv,
    tradingDaysPerYear: positive(input.tradingDaysPerYear),
  })
  const numoen = numoenSnapshot({
    R1: Number(input.numoenR1) || 8.7,
    s: Number(input.numoenShares) || 1.649981319214726,
    u: Number(input.numoenU) || 4,
    dy: Number(input.numoenDy) || 0.1,
  })
  const portfolioResearch = buildPortfolioResearch({
    lpMark: lpV3Raw?.value,
    lpEntryValue: lpV3Entry?.value,
    lpPnl: lpV3Hedged?.lpPnl,
    optionPortfolio,
    hedgePnl: lpV3Hedged?.hedgePnl,
    feeIncomeQuote: lpV3Hedged?.feeIncomeQuote,
    fundingCashflowQuote,
    fundingCashflowSource,
    feeModelCalibrated: false,
    lpPositionKnown: Boolean(lpValuation.available && lpV3Hedged),
  })
  const portfolioMissingInputs = [
    ...new Set([
      ...(lpValuation.available ? [] : lpValuation.missingInputs),
      ...(tdpy ? [] : ['trading-days-per-year']),
      ...(optionTenorSessions ? [] : ['option-tenor-sessions']),
      ...(Number.isFinite(feeIncomeQuote) ? [] : ['fee-income-quote']),
      ...(optionPortfolio?.missingInputs ?? []),
      ...portfolioResearch.missingInputs,
    ]),
  ]
  const portfolioResearchState = {
    ...portfolioResearch,
    status: portfolioMissingInputs.length ? 'calibration-required' : portfolioResearch.status,
    pnl: {
      ...portfolioResearch.pnl,
      total: portfolioMissingInputs.length ? null : portfolioResearch.pnl.total,
      missingInputs: portfolioMissingInputs,
    },
    missingInputs: portfolioMissingInputs,
  }

  return {
    researchInputs: {
      rangeWidth,
      skew,
      rangeStatus: lpValuation.available ? 'valid' : 'missing-input',
      liquidity,
      lpValuationMode: lpValuation.mode,
      lpValuationMissingInputs: lpValuation.missingInputs,
      lpValuationBasis: lpValuation.valuationBasis,
      hedgeSize,
      feeIncomeQuote,
      fundingCashflowQuote,
      fundingCashflowSource: fundingCashflowSource ?? 'missing-input',
      fundingPositionSide: input.fundingPositionSide ?? null,
      fundingSessionDurationHours,
      fundingSessionCalendarId: input.fundingSessionCalendarId ?? null,
      recoveryNotionalBasis: input.recoveryNotionalBasis ?? null,
      fundingNotionalBasis: input.fundingNotionalBasis ?? null,
      legacyFeeInput: optionalFinite(input.feeIncomeQuote) === null && optionalFinite(input.fees) !== null,
      strikePrice,
      startPrice,
      formulaHorizonSessions,
      optionTenorSessions,
      optionTenorSource: optionTenorSessions ? 'explicit-option-expiry-scenario' : 'missing-input',
      tradingDaysPerYear: tdpy,
      tradingDaysPerYearSource: tdpy ? 'upstream-explicit-or-inferred' : 'missing-input',
      volatilitySource: input.ivSource || 'scenario-unspecified',
    },
    option,
    optionPortfolio,
    asian,
    bachelier,
    lp,
    lpV3: lpV3Raw,
    lpV3Hedged,
    lpV3SymmetricApprox,
    lpPortfolio,
    liquidityFingerprint: fingerprint,
    numoen,
    fullRangeV2Il,
    rangeV3Il,
    efficiency: lpValuation.available ? capitalEfficiency({ rangeWidth, skew }) : null,
    funding,
    netCarry: fundingCarry,
    lpOnchain: {
      ...lpDataState,
      quotePrice: input.lpOnchainSnapshot?.quotePrice ?? lpDataState.quotePrice,
      quoteSymbol: input.lpOnchainSnapshot?.quoteSymbol ?? lpDataState.quoteSymbol,
    },
    portfolioResearch: portfolioResearchState,
  }
}

function optionLegPnL({ price, strikePrice, optionTenorSessions, iv, input, tdpy, optionBase }) {
  const priced = blackScholes({
    entryPrice: price,
    strikePrice,
    timeToExpirySessions: optionTenorSessions,
    iv,
    riskFreeRate: Number(input.riskFreeRate) || 0,
    dividendYield: Number(input.dividendYield) || 0,
    type: input.optionType,
    tradingDaysPerYear: tdpy,
  })
  return (priced?.price ?? 0) - optionBase
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function optionalFinite(value) {
  if (value === null || value === undefined || value === '') return null
  const next = Number(value)
  return Number.isFinite(next) ? next : null
}
