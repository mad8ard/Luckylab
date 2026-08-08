import { deriveDrawdownFeatures, deriveDynamicHoldingState } from '../domain/formulas/core.js'

export function resolveDynamicHoldingData({
  graph,
  market,
  rows,
  researchInputs,
  deviation,
  meanReversion,
  fingerprint,
}) {
  const entryPrice = Number.isFinite(graph.inputs?.entryPrice) ? graph.inputs.entryPrice : market?.markPrice
  const anchorPrice = market?.costAnchor
  const costLower = market?.costLow
  const rangeW = Number(researchInputs.rangeWidth) || 0.1
  const skew = Math.max(Number(researchInputs.skew) || 1, 0.01)
  const lpUpper = Number.isFinite(graph.lpV3Hedged?.upperPrice)
    ? graph.lpV3Hedged.upperPrice
    : entryPrice * (1 + rangeW * skew)
  const zScore = deviation?.z
  const halfLifeDays = meanReversion?.halfLifeDays

  if (![zScore, halfLifeDays, entryPrice, anchorPrice, costLower, lpUpper].every(Number.isFinite)) return null
  return deriveDynamicHoldingState({
    zScore,
    halfLifeDays,
    entryPrice,
    anchorPrice,
    targetPrices: { costLower, anchor: anchorPrice, lpUpper },
    drawdown: deriveDrawdownFeatures({ rows, index: rows.length - 1 }),
    lpPercentile: fingerprint?.stats?.activeShare ?? null,
    costSlopePct: Number.isFinite(market?.costSlope5) ? market.costSlope5 * 100 : 0,
  })
}
