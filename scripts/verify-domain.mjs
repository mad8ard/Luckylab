import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  lambertW,
  fundingRate,
  getDeltaBands,
  liquidityFingerprint,
  numoenSnapshot,
  portfolioValue,
  uniswapV3Inventory,
} from '../src/domain/formulas/core.js'
import { formulaStages } from '../src/domain/formulas/registry.js'
import { buildMarketState, buildMarketStatePath } from '../src/domain/market-data/cost.js'
import { buildFormulaPath } from '../src/domain/market-data/formulaPath.js'
import { parseBinanceKlines, parseCsvText } from '../src/domain/market-data/ohlcv.js'
import { buildDecisionGraph, strategyProfileList } from '../src/domain/planning/orderPlan.js'

const bands = getDeltaBands({ entryPrice: 100, holdingDays: 30, iv: 1, targetReturn: 0.3 })
assert.ok(bands.long.low < bands.long.cost)
assert.ok(bands.long.cost < bands.long.high)
assert.ok(bands.short.low < bands.short.cost)
assert.ok(bands.short.cost < bands.short.high)
assert.ok(formulaStages.length >= 12)
assert.ok(formulaStages.some((stage) => stage.id === 'liquidity-fingerprint' && stage.status === 'research-only'))
assert.ok(formulaStages.some((stage) => stage.id === 'amm-geometry' && stage.status === 'protocol-unverified'))
assert.deepEqual(strategyProfileList.map((profile) => profile.id), ['conservative', 'balanced', 'aggressive', 'custom'])

const fp = liquidityFingerprint({ entryPrice: 100, lowerFactor: 0.8, upperFactor: 1.2, segmentCount: 10 })
assert.ok(Math.abs(fp.segments.reduce((sum, seg) => sum + seg.weight, 0) - 1) < 1e-6)
const w = lambertW(1)
assert.ok(Math.abs(w * Math.exp(w) - 1) < 1e-8)
assert.equal(numoenSnapshot().status, 'protocol-unverified')

const lpV3 = uniswapV3Inventory({ markPrice: 100, lowerPrice: 80, upperPrice: 120, liquidity: 10 })
assert.ok(lpV3.token0 > 0)
assert.ok(lpV3.token1 > 0)
assert.ok(Number.isFinite(lpV3.value))

const funding = fundingRate({ perpTwap: 101, spotTwap: 100, hours: 8 })
assert.ok(funding.funding > 0)
assert.ok(Number.isFinite(portfolioValue({
  lpValue: lpV3.value,
  optionValue: 1.2,
  hedgeSize: 0.2,
  markPrice: 100,
  startPrice: 95,
  fees: 0.3,
  fundingCost: 0.1,
})))

const binanceRows = parseBinanceKlines(`1735689600000,100,105,99,104,120
1735776000000,104,106,103,105,200
`)
assert.equal(binanceRows.length, 2)
assert.equal(binanceRows[0].date, '2025-01-01')
assert.ok(binanceRows[0].timestamp < binanceRows[1].timestamp)

const parsed = parseCsvText(`date,open,high,low,close,volume
2026-01-01,100,105,99,104,120
2026-01-02,104,106,103,105,0
`)
assert.equal(parsed.length, 2)

const cn = parseCsvText(await readFile(new URL('../public/data/600519-1d.csv', import.meta.url), 'utf8'))
const hk = parseCsvText(await readFile(new URL('../public/data/9988_HK-1d.csv', import.meta.url), 'utf8'))
const rows = cn
assert.ok(cn.length >= 1000)
assert.ok(hk.length >= 1000)
assert.ok(cn[0].date <= '2021-01-10')
assert.ok(hk[0].date <= '2021-01-10')
assert.ok(cn.at(-1).date >= '2026-05-11')
assert.ok(hk.at(-1).date >= '2026-05-11')

const market = buildMarketState(rows)
const marketPath = buildMarketStatePath(rows)
assert.ok(Number.isFinite(market.costAnchor))
assert.ok(Number.isFinite(market.annualVol))
assert.ok(Number.isFinite(market.atrPercent))
assert.equal(marketPath.length, rows.length)
assert.ok(Math.abs(marketPath.at(-1).costAnchor - market.costAnchor) < 1e-9)

const graph = buildDecisionGraph({
  market,
  input: {
    entryPrice: market.markPrice,
    holdingDays: 30,
    iv: market.annualVol,
    deltaSlope: 0.3,
    exitTargetReturn: 0,
    capital: 10000,
    baseNotional: 0,
    strategyProfile: 'balanced',
    strikePrice: market.markPrice * 1.05,
    riskFreeRate: 0.04,
    optionType: 'put',
    startPrice: market.costAnchor,
    rangeWidth: 0.1,
    skew: 1,
    liquidity: 1,
    hedgeSize: 0,
    fees: 0,
  },
})
assert.ok(['buy', 'sell', null].includes(graph.decision.timing.side))
assert.ok(Array.isArray(graph.decision.triggeredConditions))
assert.ok(Array.isArray(graph.decision.blockedReasons))
assert.ok(Array.isArray(graph.decision.missingInputs))
if (graph.position.side) {
  assert.ok(
    graph.position.maxNotional === null ||
    Number.isFinite(graph.position.maxNotional),
  )
  assert.ok(
    graph.position.riskBudget === null ||
    Number.isFinite(graph.position.riskBudget),
  )
}
assert.equal(graph.plan.primaryOrders.every((order) => Number.isFinite(order.price)), true)
assert.equal(graph.plan.primaryOrders.every((order) => Number.isFinite(order.expectedProfit)), true)
if (graph.decision.timing.side === 'sell') assert.equal(graph.plan.primaryOrders.length, 0)

const formulaPath = buildFormulaPath(rows, {
  entryPrice: market.markPrice,
  holdingDays: 30,
  iv: market.annualVol,
  deltaSlope: 0.3,
  exitTargetReturn: 0,
  strikePrice: market.markPrice * 1.05,
  riskFreeRate: 0.04,
  optionType: 'put',
  startPrice: market.costAnchor,
  rangeWidth: 0.1,
  skew: 1,
  liquidity: 1,
  pathUsesScenarioInputs: false,
})
assert.equal(formulaPath.length, rows.length)
assert.ok(formulaPath.some((row) => Number.isFinite(row.deltaUpper)))
assert.ok(formulaPath.some((row) => Number.isFinite(row.optionDelta)))
assert.ok(formulaPath.some((row) => Number.isFinite(row.lpNormalizedDelta)))
assert.equal(formulaPath.some((row) => Number.isFinite(row.fundingProxy)), false)
assert.equal(formulaPath.at(-1).fieldStates.fundingProxy.missingInputs.includes('perpTwap'), true)
const fundingFormulaPath = buildFormulaPath(rows.slice(-120), {
  entryPrice: market.markPrice,
  holdingDays: 1,
  iv: market.annualVol,
  deltaSlope: 0.3,
  exitTargetReturn: 0,
  startPrice: market.costAnchor,
  rangeWidth: 0.1,
  skew: 1,
  liquidity: 1,
  perpTwap: 101,
  spotTwap: 100,
  pathUsesScenarioInputs: false,
})
assert.ok(fundingFormulaPath.some((row) => Number.isFinite(row.fundingProxy)))
assert.ok(fundingFormulaPath.some((row) => Number.isFinite(row.netCarry)))
assert.equal(formulaPath.every((row) => {
  if (![row.deltaLower, row.deltaCost, row.deltaUpper].every(Number.isFinite)) return true
  return row.deltaLower < row.deltaCost && row.deltaCost < row.deltaUpper
}), true)
const earlyPath = formulaPath[0]
const latePath = formulaPath.at(-1)
assert.notEqual(earlyPath?.bandAnchor, latePath?.bandAnchor)
assert.ok(Math.abs(earlyPath.optionDelta) < 0.65)

console.log('domain verification passed')
