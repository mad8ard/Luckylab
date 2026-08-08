#!/usr/bin/env python3
"""Run every formula evidence item through a concrete domain calculation."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_node_checks() -> list[dict]:
    code = r"""
      import { readFile } from 'node:fs/promises'
      import {
        ammCurve,
        asianOption,
        bachelierOption,
        blackScholes,
        capitalEfficiency,
        deriveDynamicHoldingState,
        deviationScore,
        fundingRate,
        gammaPnl,
        getDeltaBands,
        hedgedLpPortfolioCurve,
        impermanentLoss,
        liquidityFingerprint,
        meanReversionHalfLife,
        netCarry,
        netLpEfficiency,
        numoenSnapshot,
        portfolioValue,
        riskSurface,
        uniswapV3Inventory,
        volConfidence,
      } from './src/domain/formulas/core.js'
      import { formulaEvidenceCatalog } from './src/domain/formulas/evidence.js'
      import { buildCostPath, buildMarketState, buildMarketStatePath } from './src/domain/market-data/cost.js'
      import { buildFormulaPath } from './src/domain/market-data/formulaPath.js'
      import { lpPoolCoverageMetrics } from './src/domain/market-data/lpPoolMetrics.js'
      import { parseCsvText } from './src/domain/market-data/ohlcv.js'
      import { buildDecisionGraph } from './src/domain/strategy-planning/orderPlan.js'

      const rows = parseCsvText(await readFile('./public/data/600519-1d.csv', 'utf8')).slice(-260)
      const samples = [
        { symbol: '600519', rows },
        { symbol: '0700.HK', rows: parseCsvText(await readFile('./public/data/0700_HK-1d.csv', 'utf8')).slice(-220) },
        { symbol: '000001', rows: parseCsvText(await readFile('./public/data/000001-1d.csv', 'utf8')).slice(-220) },
      ]
      const market = buildMarketState(rows)
      const lpOnchainSnapshot = {
        hasPool: true,
        hasPosition: false,
        pool: { label: 'A股 模拟聚合池' },
        pools: [],
        quoteRoutes: [],
        poolCoverage: { reserveUsd: 1000000, volumeUsd24h: 240000, topPoolReserveShare: 0.68 },
        quotePrice: market.markPrice,
        quoteSymbol: 'CNY',
      }
      const input = {
        entryPrice: market.markPrice,
        holdingDays: 30,
        iv: market.annualVol,
        deltaSlope: 0.3,
        exitTargetReturn: 0.12,
        capital: 10000,
        baseNotional: 0,
        strategyProfile: 'balanced',
        strikePrice: market.markPrice * 1.05,
        riskFreeRate: 0.04,
        optionType: 'put',
        optionStrategy: 'single',
        optionSide: 'long',
        optionQuantity: 1,
        optionMultiplier: 1,
        startPrice: market.costAnchor,
        rangeWidth: 0.1,
        skew: 1.4,
        liquidity: 10,
        hedgeSize: 0.1,
        fees: 3,
        perpTwap: market.markPrice * 1.0002,
        spotTwap: market.markPrice,
        tradingDaysPerYear: 365,
        lpOnchainSnapshot,
      }
      const formulaPath = buildFormulaPath(rows, input)
      const marketPath = buildMarketStatePath(rows)
      const costPath = buildCostPath(rows)
      const buyMarket = {
        rows: 120,
        markPrice: 90,
        costAnchor: 100,
        costRecent: 100,
        costLow: 95,
        costHigh: 105,
        costDistance: -0.1,
        annualVol: 0.4,
        atrPercent: 0.02,
        momentum5: 0.03,
        momentum20: 0.01,
        costSlope5: 0,
      }
      const graph = buildDecisionGraph({ market: buyMarket, input: { ...input, entryPrice: 100, iv: 0.4, spotTwap: 100, perpTwap: 101 } })
      const bands = getDeltaBands({ entryPrice: 100, holdingDays: 30, iv: 0.4, targetReturn: 0.3 })
      const option = blackScholes({ entryPrice: 100, strikePrice: 105, holdingDays: 30, iv: 0.4, riskFreeRate: 0.04, type: 'put' })
      const asian = asianOption({ entryPrice: 100, strikePrice: 105, holdingDays: 30, iv: 0.4, riskFreeRate: 0.04, type: 'put' })
      const bach = bachelierOption({ entryPrice: 100, strikePrice: 105, holdingDays: 30, normalVol: 40, riskFreeRate: 0.04, type: 'put' })
      const lp = uniswapV3Inventory({ markPrice: 110, lowerPrice: 80, upperPrice: 130, liquidity: 10 })
      const lpCoverage = lpPoolCoverageMetrics(lpOnchainSnapshot.poolCoverage)
      const lpBelow = uniswapV3Inventory({ markPrice: 70, lowerPrice: 80, upperPrice: 120, liquidity: 10 })
      const lpInside = uniswapV3Inventory({ markPrice: 100, lowerPrice: 80, upperPrice: 120, liquidity: 10 })
      const lpAbove = uniswapV3Inventory({ markPrice: 130, lowerPrice: 80, upperPrice: 120, liquidity: 10 })
      const fingerprint = liquidityFingerprint({
        entryPrice: 100,
        activePrice: 98,
        costAnchor: 101,
        targetRange: { lower: 92, upper: 108 },
        orderLevels: graph.plan.primaryOrders,
        lowerFactor: 0.8,
        upperFactor: 1.2,
        segmentCount: 10,
      })
      const amm = ammCurve({ price: 100, invariant: 10000 })
      const numoen = numoenSnapshot()
      const ce = capitalEfficiency({ rangeWidth: 0.1, skew: 1.4 })
      const funding = fundingRate({ perpTwap: 101, spotTwap: 100, hours: 24 })
      const il = impermanentLoss({ markPrice: 110, startPrice: 100, liquidity: 10 })
      const lpCurve = hedgedLpPortfolioCurve({ startPrice: 100, lowerPrice: 80, upperPrice: 130, liquidity: 10, hedgeSize: 0.1, fees: 2, fundingCost: 0.5 })
      const dev = deviationScore({ costDistance: -0.1, annualVol: 0.4, holdingDays: 30 })
      const surface = riskSurface({ entryPrice: 100, strikePrice: 105, holdingDays: 30, iv: 0.4, bandLow: 80, bandHigh: 130 })
      const netLp = netLpEfficiency({ capitalEfficiency: ce?.efficiency, impermanentLoss: il?.impermanentLoss, feeRate: 0.003 })
      const carry = netCarry({ costDistance: 0.1, fundingRate: funding?.cumulativeFundingEstimate, holdingDays: 30 })
      const halfLife = meanReversionHalfLife({ costDistanceSeries: marketPath.map((item) => item.costDistance) })
      const gp = gammaPnl({ gamma: option?.gamma, markPrice: market.markPrice, priceChange: 5, positionSize: 2 })
      const vc = volConfidence({ annualVol: market.annualVol, sampleSize: 60 })
      const dynamicHolding = deriveDynamicHoldingState({
        zScore: -2.8,
        halfLifeDays: 6,
        entryPrice: 90,
        anchorPrice: 100,
        targetPrices: { costLower: 94, anchor: 100, lpUpper: 103 },
        costSlopePct: 0,
        drawdown: {
          status: 'ok',
          drawdownDepth: -0.22,
          drawdownSpeed5: 0.002,
          drawdownSpeed20: 0.04,
          drawdownRepair: 0.22,
          drawdownAge: { peakDays: 58, troughDays: 6 },
        },
      })
      const finite = (value) => Number.isFinite(value)
      const nonEmpty = (arr) => Array.isArray(arr) && arr.length > 0
      const pathFinite = (field) => formulaPath.some((row) => finite(row[field]))
      const sampleMatrix = samples.map((sample) => {
        const sampleMarket = buildMarketState(sample.rows)
        const samplePath = buildFormulaPath(sample.rows, {
          ...input,
          entryPrice: sampleMarket.markPrice,
          iv: sampleMarket.annualVol,
          strikePrice: sampleMarket.markPrice * 1.05,
          startPrice: sampleMarket.costAnchor,
          perpTwap: sampleMarket.markPrice * 1.0002,
          spotTwap: sampleMarket.markPrice,
        })
        return {
          symbol: sample.symbol,
          rows: sample.rows.length,
          pathRows: samplePath.length,
          finiteFields: Object.fromEntries(['costAnchor', 'deltaUpper', 'optionGamma', 'lpValue', 'fundingProxy', 'netCarry'].map((field) => [field, samplePath.filter((row) => finite(row[field])).length])),
        }
      })
      const missingFundingPath = buildFormulaPath(rows.slice(-120), { ...input, perpTwap: null, spotTwap: null, pathUsesScenarioInputs: false })
      const missingFundingLast = missingFundingPath.at(-1)
      const sampleMatrixOk = sampleMatrix.every((sample) => sample.rows >= 120 && sample.pathRows === sample.rows && Object.values(sample.finiteFields).every((count) => count > 0))
      const missingFundingOk = missingFundingLast?.status?.includes('missing-input') && missingFundingLast?.status?.includes('fallback-input') && missingFundingLast?.fieldStates?.fundingProxy?.missingInputs?.includes('perpTwap')

      const checks = {
        path: nonEmpty(marketPath) && finite(marketPath.at(-1)?.markPrice) && finite(marketPath.at(-1)?.annualVol) && sampleMatrixOk,
        cost: nonEmpty(costPath) && finite(costPath.at(-1)?.anchor) && finite(costPath.at(-1)?.upper) && finite(costPath.at(-1)?.lower),
        volatility: finite(market.annualVol) && market.annualVol > 0 && finite(market.atrPercent),
        'delta-band': finite(bands?.long?.low) && finite(bands?.long?.cost) && finite(bands?.long?.high) && pathFinite('deltaUpper'),
        'option-greeks': finite(option?.price) && finite(option?.delta) && finite(option?.gamma) && pathFinite('optionGamma'),
        'asian-option': finite(asian?.price) && finite(asian?.delta) && finite(bach?.price) && finite(bach?.delta),
        'lp-inventory': finite(lp?.token0) && finite(lp?.token1) && finite(lp?.value) && pathFinite('lpValue') && lpBelow?.zone === 'token0' && lpInside?.zone === 'range' && lpAbove?.zone === 'token1',
        'lp-pool-coverage': finite(lpCoverage?.turnover24h) && finite(lpCoverage?.topReserveShare) && pathFinite('lpPoolTurnover24h') && pathFinite('lpPoolTopReserveShare'),
        'liquidity-fingerprint': nonEmpty(fingerprint?.segments) && fingerprint.inputMode === 'hybrid-model' && fingerprint.stats?.orderShare > 0 && Math.abs(fingerprint.segments.reduce((sum, seg) => sum + seg.weight, 0) - 1) < 1e-6,
        'amm-geometry': nonEmpty(amm?.points) && numoen?.status === 'protocol-unverified' && finite(numoen?.R0),
        'capital-efficiency': finite(ce?.efficiency) && ce.efficiency > 1 && pathFinite('capitalEfficiency'),
        funding: funding?.status === 'proxy-only' && finite(funding?.basisEstimate) && finite(funding?.cumulativeFundingEstimate) && pathFinite('fundingProxy') && missingFundingOk,
        portfolio: nonEmpty(lpCurve?.points) && finite(portfolioValue({ lpValue: lp.value, optionValue: option.price, fundingCost: 1 })),
        'order-plan': Array.isArray(graph.plan?.primaryOrders) && graph.plan.primaryOrders.length > 0 && graph.plan.primaryOrders.every((order) => finite(order.price) && finite(order.targetPrice)),
        'deviation-score': finite(dev?.z) && finite(dev?.regressionProb),
        'risk-surface': nonEmpty(surface?.points) && surface.points.some((point) => finite(point.gamma)),
        'net-lp-efficiency': finite(netLp?.totalNet),
        'net-carry': carry?.status === 'proxy-only' && finite(carry?.netReturn) && pathFinite('netCarry'),
        'mean-reversion': halfLife !== null && Object.prototype.hasOwnProperty.call(halfLife, 'halfLifeDays') && typeof halfLife.speed === 'string',
        'dynamic-holding-state': dynamicHolding?.phase === 'repair-start' && nonEmpty(dynamicHolding?.milestones) && dynamicHolding?.holdingPlan?.shortTrade?.status === '观察',
        'gamma-pnl': finite(gp?.gammaPnl),
        'vol-confidence': finite(vc?.se) && finite(vc?.lower) && finite(vc?.upper),
      }
      const details = {
        formulaPathRows: formulaPath.length,
        chartFiniteFields: Object.fromEntries(['deltaUpper', 'optionGamma', 'lpValue', 'capitalEfficiency', 'fundingProxy', 'netCarry'].map((field) => [field, formulaPath.filter((row) => finite(row[field])).length])),
        sampleMatrix,
        missingFundingStatus: missingFundingLast?.status ?? [],
        lpZones: [lpBelow?.zone, lpInside?.zone, lpAbove?.zone],
        fingerprintStats: fingerprint?.stats,
        orderCount: graph.plan?.primaryOrders?.length ?? 0,
      }
      console.log(JSON.stringify({ evidenceIds: formulaEvidenceCatalog.map((entry) => entry.id), checks, details }))
    """
    result = subprocess.run(["node", "--input-type=module", "-e", code], cwd=ROOT, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def main() -> int:
    result = run_node_checks()
    evidence_ids = result["evidenceIds"]
    checks = result["checks"]
    failures = []
    for formula_id in evidence_ids:
        if formula_id not in checks:
            failures.append(f"{formula_id}: no wiring check")
        elif checks[formula_id] is not True:
            failures.append(f"{formula_id}: domain calculation returned empty/non-finite output")
    extras = sorted(set(checks) - set(evidence_ids))
    if extras:
        failures.append(f"extra checks without evidence: {', '.join(extras)}")
    if failures:
        print("formula wiring audit failed", file=sys.stderr)
        for failure in failures:
            print(failure, file=sys.stderr)
        print(json.dumps(result["details"], indent=2), file=sys.stderr)
        return 1
    print(f"formula wiring audit passed: {len(evidence_ids)} formula stages exercised")
    print(json.dumps(result["details"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
