export const formulaEvidenceCatalog = [
  entry('path', 'implementation', 'implemented', true, ['OHLCV'], ['returns', 'vwap'], []),
  entry('cost', 'blog-source', 'implemented', true, ['OHLCV'], ['costAnchor', 'costBand'], []),
  entry('volatility', 'blog-source', 'implemented', true, ['returns', 'trueRange'], ['annualVol', 'atrPercent'], ['hgjrvacjbe']),
  entry('delta-band', 'desmos-source', 'implemented', true, ['entryPrice', 'holdingDays', 'iv', 'deltaSlope'], ['longBand', 'shortBand'], ['943334771f', '5baa5607d0', '83418c6ca1']),
  entry('option-greeks', 'paper', 'research-only', false, ['entryPrice', 'strikePrice', 'holdingDays', 'iv'], ['price', 'greeks'], ['black-scholes-1973', '97fa8c814b'], ['real-option-leg']),
  entry('asian-option', 'paper', 'research-only', false, ['entryPrice', 'strikePrice', 'holdingDays', 'iv'], ['asianPrice', 'bachelierPrice'], ['bachelier-1900', '0711.1272'], ['listed-contract-rules']),
  entry('lp-inventory', 'protocol-whitepaper', 'research-only', false, ['markPrice', 'lowerPrice', 'upperPrice', 'liquidity'], ['token0', 'token1', 'value', 'inventoryDelta'], ['uniswap-v3-whitepaper', 'atis-elsts-v3-liquidity-math'], ['real-lp-position']),
  entry('lp-pool-coverage', 'real-data-snapshot', 'research-only', false, ['poolCoverage.reserveUsd', 'poolCoverage.volumeUsd24h', 'poolCoverage.topPoolReserveShare'], ['turnover24h', 'topReserveShare'], ['geckoterminal-pool-aggregate'], ['tick-liquidity-history', 'lp-add-remove-events']),
  entry('liquidity-fingerprint', 'desmos-source', 'research-only', false, ['distribution', 'range', 'segmentCount', 'activePrice', 'costAnchor', 'orderLevels'], ['componentDensity', 'segmentWeights', 'fingerprintStats'], ['0a40cbb0ee', '06b68e5e0e'], ['real-ticks', 'lp-nft-weights', 'order-book-depth']),
  entry('amm-geometry', 'desmos-source', 'protocol-unverified', false, ['reserveSnapshot', 'invariantParameters'], ['ammCurve', 'numoenSnapshot'], ['50693ae997', '8a2d4257ef'], ['verified-protocol-mechanics']),
  entry('capital-efficiency', 'paper', 'research-only', false, ['rangeWidth', 'skew'], ['efficiency', 'frontierSlope'], ['696b78e1fd', '5ab9c1e3a1']),
  entry('funding', 'paper', 'proxy-only', false, ['perpTwap', 'spotTwap', 'hours'], ['basisEstimate', 'fundingProxy'], ['fundamentals-perpetual-futures'], ['exchange-schedule', 'settlement-history']),
  entry('portfolio', 'paper', 'research-only', false, ['lpLeg', 'optionLeg', 'hedgeLeg', 'fees', 'funding'], ['componentCurve', 'combinedValue'], ['constant-product-amm-math'], ['leg-lifecycle', 'fee-model']),
  entry('order-plan', 'implementation', 'implemented', true, ['costBand', 'deltaBand', 'account'], ['orders', 'invalidation'], []),
  entry('deviation-score', 'heuristic', 'implemented', true, ['costDistance', 'annualVol', 'holdingDays'], ['zScore', 'strength'], []),
  entry('risk-surface', 'paper', 'implemented', false, ['bandLow', 'bandHigh', 'iv'], ['greekCurves'], ['black-scholes-1973']),
  entry('net-lp-efficiency', 'heuristic', 'research-only', false, ['capitalEfficiency', 'impermanentLoss', 'feeRate'], ['totalNet'], [], ['fee-model', 'rebalance-rules']),
  entry('net-carry', 'heuristic', 'proxy-only', false, ['costDistance', 'fundingProxy'], ['netReturn'], [], ['exchange-schedule']),
  entry('mean-reversion', 'heuristic', 'implemented', false, ['costDistanceSeries'], ['halfLife'], []),
  entry('dynamic-holding-state', 'heuristic', 'implemented', false, ['drawdownDepth', 'drawdownSpeed', 'drawdownRepair', 'zScore', 'halfLifeDays', 'costLower', 'costAnchor', 'lpUpper'], ['phase', 'milestones', 'expectation', 'holdingPlan', 'blockedReasons'], []),
  entry('gamma-pnl', 'paper', 'implemented', false, ['gamma', 'priceChange'], ['gammaPnl'], ['black-scholes-1973']),
  entry('vol-confidence', 'heuristic', 'implemented', false, ['annualVol', 'sampleSize'], ['confidenceRange'], []),
]

export function getFormulaEvidence(id) {
  return formulaEvidenceCatalog.find((item) => item.id === id) ?? null
}

function entry(id, sourceTier, status, executable, inputs, outputs, sources, missingInputs = []) {
  const executionDecision = id === 'order-plan'
  const executionInput = executable && !executionDecision
  return {
    id,
    sourceTier,
    status,
    executable,
    executionInput,
    executionDecision,
    queryOnly: !executable,
    inputs,
    outputs,
    sources,
    missingInputs,
    assumptions: [],
    invalidWhen: [],
  }
}
