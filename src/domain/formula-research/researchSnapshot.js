import {
  asianOption,
  bachelierOption,
  blackScholes,
  buildOptionPortfolio,
  capitalEfficiency,
  fundingRate,
  hedgedLpPortfolioCurve,
  impermanentLoss,
  liquidityFingerprint,
  numoenSnapshot,
  optionLegsFromTemplate,
  portfolioValue,
  uniswapV2Inventory,
  uniswapV3HedgedInventory,
  uniswapV3HedgedPosition,
  uniswapV3Inventory,
} from '../formulas/core.js'
import { buildLpDataState } from '../market-data/lpOnchain.js'

export function buildResearchSnapshot({ market, input, executable }) {
  const { entryPrice, holdingDays, iv, capital } = executable.inputs
  const rangeWidth = Math.max(Number(input.rangeWidth) || 0.01, 0.001)
  const tdpy = Number(input.tradingDaysPerYear) || 365
  const strikePrice = positive(input.strikePrice) || entryPrice * 1.05
  const startPrice = positive(input.startPrice) || market.costAnchor
  const liquidity = Math.max(Number(input.liquidity) || 0, 0)
  const hedgeSize = Number(input.hedgeSize) || 0
  const fees = Number(input.fees) || 0
  const skew = Math.max(Number(input.skew) || 1, 0.01)
  const option = blackScholes({
    entryPrice,
    strikePrice,
    holdingDays,
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
    widthPct: Number(input.optionWidthPct) || rangeWidth,
    premium: Number.isFinite(Number(input.optionPremium)) ? Number(input.optionPremium) : null,
  })
  const optionPortfolio = buildOptionPortfolio({
    entryPrice,
    holdingDays,
    iv,
    riskFreeRate: Number(input.riskFreeRate) || 0,
    dividendYield: Number(input.dividendYield) || 0,
    tradingDaysPerYear: tdpy,
    contractMultiplier: Number(input.optionMultiplier) || 1,
    legs: optionLegs,
  })
  const asian = asianOption({
    entryPrice,
    strikePrice,
    holdingDays,
    iv,
    riskFreeRate: Number(input.riskFreeRate) || 0,
    type: input.optionType,
    tradingDaysPerYear: tdpy,
  })
  const bachelier = bachelierOption({
    entryPrice,
    strikePrice,
    holdingDays,
    normalVol: iv * entryPrice,
    riskFreeRate: Number(input.riskFreeRate) || 0,
    type: input.optionType,
    tradingDaysPerYear: tdpy,
  })
  const lp = uniswapV2Inventory({
    markPrice: entryPrice,
    startPrice,
    liquidity,
    hedgeSize,
    fees,
  })
  const lowerPrice = entryPrice * Math.max(1 - rangeWidth, 0.001)
  const upperPrice = entryPrice * (1 + rangeWidth * skew)
  const rangeFactor = Math.sqrt(upperPrice / lowerPrice)
  const lpV3Raw = uniswapV3Inventory({ markPrice: entryPrice, lowerPrice, upperPrice, liquidity })
  const lpV3SymmetricApprox = uniswapV3HedgedInventory({
    markPrice: entryPrice,
    strikePrice: startPrice,
    rangeFactor,
    liquidity,
    hedgeSize,
    fees,
  })
  const lpV3Hedged = uniswapV3HedgedPosition({
    markPrice: entryPrice,
    startPrice,
    lowerPrice,
    upperPrice,
    liquidity,
    hedgeSize,
    fees,
  })
  const il = impermanentLoss({ markPrice: entryPrice, startPrice, liquidity })
  const hasFundingInputs = positive(input.perpTwap) !== null && positive(input.spotTwap) !== null
  const funding = hasFundingInputs
    ? fundingRate({
      perpTwap: positive(input.perpTwap),
      spotTwap: positive(input.spotTwap),
      hours: holdingDays * 24,
    })
    : null
  const optionBase = option?.price ?? 0
  const lpPortfolio = hedgedLpPortfolioCurve({
    startPrice: entryPrice,
    lowerPrice,
    upperPrice,
    liquidity,
    hedgeSize,
    fees,
    fundingCost: Math.abs(funding?.funding ?? 0) * capital,
    optionWeight: 1,
    optionPricer: (price) => optionLegPnL({ price, strikePrice, holdingDays, iv, input, tdpy, optionBase }),
  })
  const fingerprint = liquidityFingerprint({
    entryPrice: startPrice,
    priceGrid: 120,
    distribution: 'log-laplace',
    lambda: Number(input.fingerprintLambda) || 2.6,
    kappa: Number(input.fingerprintKappa) || 0.77,
    lowerFactor: Math.max(0.05, lowerPrice / startPrice),
    upperFactor: Math.min(20, upperPrice / startPrice),
    segmentCount: 12,
  })
  const numoen = numoenSnapshot({
    R1: Number(input.numoenR1) || 8.7,
    s: Number(input.numoenShares) || 1.649981319214726,
    u: Number(input.numoenU) || 4,
    dy: Number(input.numoenDy) || 0.1,
  })
  const lpDataState = buildLpDataState(input.lpOnchainSnapshot)

  return {
    researchInputs: { rangeWidth, skew, liquidity, hedgeSize, fees, strikePrice, startPrice },
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
    impermanentLoss: il,
    efficiency: capitalEfficiency({ rangeWidth, skew }),
    funding,
    lpOnchain: {
      ...lpDataState,
      quotePrice: input.lpOnchainSnapshot?.quotePrice ?? lpDataState.quotePrice,
      quoteSymbol: input.lpOnchainSnapshot?.quoteSymbol ?? lpDataState.quoteSymbol,
    },
    portfolioResearch: {
      status: 'research-only',
      missingInputs: [
        ...lpDataState.missingInputs,
        'option-leg',
        'hedge-leg',
        'fee-model',
        'funding-settlement',
      ],
      value: portfolioValue({
        lpValue: lpV3Hedged?.value ?? 0,
        optionValue: option?.price ?? 0,
        fundingCost: Math.abs(funding?.cumulativeFundingEstimate ?? funding?.funding ?? 0) * capital,
      }),
    },
  }
}

function optionLegPnL({ price, strikePrice, holdingDays, iv, input, tdpy, optionBase }) {
  const priced = blackScholes({
    entryPrice: price,
    strikePrice,
    holdingDays,
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
