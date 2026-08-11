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
        ckCapitalEfficiencyReference,
        deriveDynamicHoldingState,
        deviationScore,
        estimateCumulativeFundingProxy,
        gammaPnl,
        getDeltaBands,
        hedgedLpPortfolioCurve,
        fullRangeV2ImpermanentLoss,
        liquidityFingerprint,
        meanReversionHalfLife,
        netCarry,
        lpResearchAttribution,
        numoenSnapshot,
        riskSurface,
        rangeV3ImpermanentLoss,
        uniswapV3Inventory,
        volConfidence,
      } from './src/domain/formulas/core.js'
      import { formulaEvidenceCatalog } from './src/domain/formulas/evidence.js'
      import { buildPortfolioResearch } from './src/domain/formula-research/portfolioResearch.js'
      import { buildCostPath, buildMarketState, buildMarketStatePath } from './src/domain/market-data/cost.js'
      import { buildFormulaPath } from './src/domain/market-data/formulaPath.js'
      import { deriveFormulaPathLpResearchRange } from './src/domain/market-data/formulaPathLpResearchRange.js'
      import { lpPoolCoverageMetrics } from './src/domain/market-data/lpPoolMetrics.js'
      import { parseCsvText } from './src/domain/market-data/ohlcv.js'
      import { inferTdpy } from './src/domain/market-data/tdpy.js'
      import { buildDecisionGraph } from './src/domain/strategy-planning/orderPlan.js'

      const rows = parseCsvText(await readFile('./public/data/600519-1d.csv', 'utf8')).slice(-260)
      const samples = [
        { symbol: '600519', tdpy: 242, rows },
        { symbol: '1810.HK', tdpy: 242, rows: parseCsvText(await readFile('./public/data/1810_HK-1d.csv', 'utf8')).slice(-220) },
        { symbol: '000001', tdpy: 242, rows: parseCsvText(await readFile('./public/data/000001-1d.csv', 'utf8')).slice(-220) },
      ]
      const market = buildMarketState(rows, 242)
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
        formulaHorizonSessions: 30,
        formulaHorizonSide: 'long',
        horizonTargetPrice: Math.max(...rows.map((row) => row.close)) * 1.1,
        horizonTargetSource: 'audit-explicit-scenario',
        horizonAvailableAt: 'audit-snapshot-known-at',
        optionTenorSessions: 30,
        horizonMode: 'explicit-scenario',
        pathUsesScenarioInputs: true,
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
        lpScenarioEnabled: true,
        lpScenarioStartPrice: market.costAnchor,
        lpScenarioRangeWidth: 0.1,
        lpScenarioSkew: 1.4,
        lpScenarioLiquidity: 10,
        hedgeSize: 0.1,
        feeIncomeQuote: 3,
        perpTwap: market.markPrice * 1.0002,
        spotTwap: market.markPrice,
        fundingPositionSide: 'short',
        fundingSessionDurationHours: 24,
        fundingSessionCalendarId: 'CRYPTO-UTC-24H',
        recoveryNotionalBasis: 'cycle-start-quote-notional',
        fundingNotionalBasis: 'cycle-start-quote-notional',
        tradingDaysPerYear: 365,
        dynamicHoldingGate: {
          status: '观察',
          candidateStatus: '观察',
          phase: 'repair-start',
          phaseLabel: '修复启动',
          blockedReasons: [],
          executionAuthority: 'none',
          source: 'audit-fixture',
        },
        lpOnchainSnapshot,
      }
      const formulaPath = buildFormulaPath(rows, input)
      const marketPath = buildMarketStatePath(rows, 365)
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
        momentumFast: 0.03,
        momentumSlow: 0.01,
        costSlopeRecent: 0,
        windowSpec: { recent: 3, cost: 9, vol: 9, mode: 'adaptive-prefix' },
        tradingDaysPerYear: 365,
      }
      const graph = buildDecisionGraph({ market: buyMarket, input: { ...input, entryPrice: 100, iv: 0.4, spotTwap: 100, perpTwap: 101 } })
      const bands = getDeltaBands({ entryPrice: 100, formulaHorizonSessions: 30, iv: 0.4, deltaSlope: 0.3, tradingDaysPerYear: 365 })
      const option = blackScholes({ entryPrice: 100, strikePrice: 105, timeToExpirySessions: 30, iv: 0.4, riskFreeRate: 0.04, type: 'put', tradingDaysPerYear: 365 })
      const asian = asianOption({ entryPrice: 100, strikePrice: 105, timeToExpirySessions: 30, iv: 0.4, riskFreeRate: 0.04, type: 'put', tradingDaysPerYear: 365 })
      const bach = bachelierOption({ entryPrice: 100, strikePrice: 105, timeToExpirySessions: 30, normalVol: 40, riskFreeRate: 0.04, type: 'put', tradingDaysPerYear: 365 })
      const lp = uniswapV3Inventory({ markPrice: 110, lowerPrice: 80, upperPrice: 130, liquidity: 10 })
      const lpResearchRange = deriveFormulaPathLpResearchRange({
        bandAnchor: 100,
        deltaBands: bands,
        horizon: { modelHorizonSessions: 30, recoveryFraction: 0.5, availableAt: 'audit-snapshot-known-at' },
      })
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
        volatility: 0.4,
        tradingDaysPerYear: 365,
      })
      const amm = ammCurve({ price: 100, invariant: 10000 })
      const numoen = numoenSnapshot()
      const ce = capitalEfficiency({ rangeWidth: 0.1, skew: 1.4 })
      const ckCe = ckCapitalEfficiencyReference()
      const funding = estimateCumulativeFundingProxy({ perpTwap: 101, spotTwap: 100, horizonHours: 24 })
      const il = fullRangeV2ImpermanentLoss({ markPrice: 110, startPrice: 100, liquidity: 10 })
      const v3Il = rangeV3ImpermanentLoss({ markPrice: 110, startPrice: 100, lowerPrice: 80, upperPrice: 130, liquidity: 10 })
      const lpCurve = hedgedLpPortfolioCurve({ startPrice: 100, lowerPrice: 80, upperPrice: 130, liquidity: 10, hedgeSize: 0.1, feeIncomeQuote: 2, fundingCashflowQuote: -0.5, fundingCashflowSource: 'explicit-scenario' })
      const dev = deviationScore({ costDistance: -0.1, annualVol: 0.4, formulaHorizonSessions: 30, tradingDaysPerYear: 365 })
      const surface = riskSurface({ entryPrice: 100, strikePrice: 105, timeToExpirySessions: 30, iv: 0.4, bandLow: 80, bandHigh: 130, tradingDaysPerYear: 365 })
      const netLp = lpResearchAttribution({
        capitalEfficiency: ce?.efficiency,
        lpIlFraction: v3Il?.rangeV3Il,
        ilModel: v3Il?.model,
        capitalBasis: 'same-entry-inventory-hold-value',
        horizonSessions: 30,
      })
      const portfolioLedger = buildPortfolioResearch({
        lpMark: lp.value,
        lpEntryValue: lp.value - 1,
        lpPnl: 1,
        optionPortfolio: { value: option.price, entryCost: option.price, pnl: 0, missingInputs: [] },
        hedgePnl: 0,
        feeIncomeQuote: 0,
        fundingCashflowQuote: -1,
        fundingCashflowSource: 'explicit-scenario',
      })
      const carry = netCarry({
        cycleStartPrice: 90,
        targetPrice: 100,
        side: 'long',
        cumulativeFundingProxy: funding?.cumulativeFundingProxy,
        fundingPositionSide: 'short',
        recoveryNotionalBasis: 'cycle-start-quote-notional',
        fundingNotionalBasis: 'cycle-start-quote-notional',
        fundingHorizonHours: 24,
        comparisonHorizon: {
          sessions: 1,
          sessionDurationHours: 24,
          sessionCalendarId: 'CRYPTO-UTC-24H',
          source: 'audit-explicit-scenario',
          availableAt: '2026-08-03T00:00:00.000Z',
        },
      })
      const halfLife = meanReversionHalfLife({ costDistanceSeries: marketPath.map((item) => item.costDistance) })
      const gp = gammaPnl({ gamma: option?.optionGamma, markPrice: market.markPrice, priceChange: 5, positionSize: 2 })
      const vc = volConfidence({ annualVol: market.annualVol, sampleSize: 60 })
      const dynamicHolding = deriveDynamicHoldingState({
        zScore: -2.8,
        halfLifeSessions: 6,
        entryPrice: 90,
        anchorPrice: 100,
        targetPrices: { costLower: 94, anchor: 100, lpUpper: 103 },
        costSlopePct: 0,
        drawdown: {
          status: 'ok',
          drawdownDepth: -0.22,
          drawdownSpeedFast: 0.002,
          drawdownSpeedSlow: 0.04,
          drawdownRepair: 0.22,
          drawdownAge: { peakSessions: 58, troughSessions: 6 },
        },
      })
      const finite = (value) => Number.isFinite(value)
      const nonEmpty = (arr) => Array.isArray(arr) && arr.length > 0
      const pathFinite = (field) => formulaPath.some((row) => finite(row[field]))
      const sampleMatrix = samples.map((sample) => {
        const sampleMarket = buildMarketState(sample.rows, sample.tdpy)
        const samplePath = buildFormulaPath(sample.rows, {
          ...input,
          entryPrice: sampleMarket.markPrice,
          iv: sampleMarket.annualVol,
          strikePrice: sampleMarket.markPrice * 1.05,
          lpScenarioStartPrice: sampleMarket.costAnchor,
          perpTwap: sampleMarket.markPrice * 1.0002,
          spotTwap: sampleMarket.markPrice,
          tradingDaysPerYear: sample.tdpy,
        })
        return {
          symbol: sample.symbol,
          rows: sample.rows.length,
          pathRows: samplePath.length,
          finiteFields: Object.fromEntries(['costAnchor', 'deltaUpper', 'optionGamma', 'lpValue', 'cumulativeFundingProxy', 'netCarry'].map((field) => [field, samplePath.filter((row) => finite(row[field])).length])),
        }
      })
      const missingFundingPath = buildFormulaPath(rows.slice(-120), { ...input, perpTwap: null, spotTwap: null, pathUsesScenarioInputs: false })
      const missingFundingLast = missingFundingPath.at(-1)
      const sampleMatrixOk = sampleMatrix.every((sample) => sample.rows >= 120 && sample.pathRows === sample.rows && Object.values(sample.finiteFields).every((count) => count > 0))
      const missingFundingOk = missingFundingLast?.status?.includes('missing-input') && missingFundingLast?.status?.includes('fallback-input') && missingFundingLast?.fieldStates?.cumulativeFundingProxy?.missingInputs?.includes('perpTwap')
      const stockIndex = JSON.parse(await readFile('./src/data/stock-index.json', 'utf8'))
      const invariantSamples = [
        ...stockIndex.map((item) => ({ ...item, file: `./public${item.url}`, parser: parseCsvText })),
      ]
      const formulaPathInvariant = {
        datasets: invariantSamples.length,
        rows: 0,
        fullyDefinedRows: 0,
        degenerateVolatilityRows: 0,
        eligibleDegenerateVolatilityRows: 0,
        failures: [],
      }
      const invariantDeltaSlope = 0.3
      const gateStatuses = new Set(['missing-input', 'not-applicable', 'model-gate-failed'])
      const recordFailure = (sample, row, field, reason) => {
        if (formulaPathInvariant.failures.length >= 20) return
        formulaPathInvariant.failures.push(`${sample.symbol}:${row.date}:${field}:${reason}`)
      }
      const inspectPair = (sample, row, fields, stateField) => {
        const finiteCount = fields.filter((field) => finite(row[field])).length
        if (finiteCount === 1) recordFailure(sample, row, fields.join('/'), 'partial-path-would-hard-connect')
        if (finiteCount !== 0) return
        const state = row.fieldStates?.[stateField]
        const reasons = [...(state?.missingInputs ?? []), ...(state?.blockedReasons ?? [])]
        if (!gateStatuses.has(state?.status) || !reasons.length) {
          recordFailure(sample, row, stateField, 'null-without-explicit-gate-reason')
        }
      }
      for (const sample of invariantSamples) {
        const sampleRows = sample.parser(await readFile(sample.file, 'utf8'))
        const sampleTdpy = inferTdpy(sample).value
        const path = buildFormulaPath(sampleRows, {
          deltaSlope: invariantDeltaSlope,
          tradingDaysPerYear: sampleTdpy,
        })
        formulaPathInvariant.rows += path.length
        for (const row of path) {
          const fullyDefined =
            row.formulaHorizonSessions > 0 &&
            row.iv > 0 &&
            row.bandAnchor > 0 &&
            sampleTdpy > 0 &&
            Number.isFinite(invariantDeltaSlope)
          if (fullyDefined) {
            formulaPathInvariant.fullyDefinedRows += 1
            for (const field of ['deltaLower', 'deltaUpper', 'lpLowerPrice', 'lpUpperPrice']) {
              if (!finite(row[field])) recordFailure(sample, row, field, 'finite-inputs-require-finite-output')
            }
          }
          inspectPair(sample, row, ['deltaLower', 'deltaUpper'], 'deltaUpper')
          inspectPair(sample, row, ['lpLowerPrice', 'lpUpperPrice'], 'lpUpperPrice')
          if (row.fieldStates?.iv?.context?.observedValue === 0) {
            formulaPathInvariant.degenerateVolatilityRows += 1
            if (row.formulaHorizonSessions > 0 && row.bandAnchor > 0) {
              formulaPathInvariant.eligibleDegenerateVolatilityRows += 1
            }
            for (const field of ['iv', 'deltaUpper', 'lpUpperPrice']) {
              const state = row.fieldStates?.[field]
              if (
                state?.status !== 'model-gate-failed' ||
                state?.missingInputs?.length ||
                !state?.blockedReasons?.includes('degenerate-volatility')
              ) {
                recordFailure(sample, row, field, 'zero-volatility-must-be-explicit-model-gate')
              }
            }
          }
        }
      }
      const formulaPathInvariantOk =
        formulaPathInvariant.datasets === stockIndex.length + 1 &&
        formulaPathInvariant.rows > 500000 &&
        formulaPathInvariant.fullyDefinedRows > 0 &&
        formulaPathInvariant.degenerateVolatilityRows > 0 &&
        formulaPathInvariant.eligibleDegenerateVolatilityRows >= 7 &&
        formulaPathInvariant.failures.length === 0

      const checks = {
        path: nonEmpty(marketPath) && finite(marketPath.at(-1)?.markPrice) && finite(marketPath.at(-1)?.annualVol) && sampleMatrixOk,
        cost: nonEmpty(costPath) && finite(costPath.at(-1)?.anchor) && finite(costPath.at(-1)?.upper) && finite(costPath.at(-1)?.lower),
        volatility: finite(market.annualVol) && market.annualVol > 0 && finite(market.atrPercent),
        'delta-band': finite(bands?.long?.low) && finite(bands?.long?.cost) && finite(bands?.long?.high) && pathFinite('deltaUpper') && formulaPathInvariantOk,
        'option-greeks': finite(option?.price) && finite(option?.optionDelta) && finite(option?.optionGamma) && pathFinite('optionGamma'),
        'asian-option': finite(asian?.price) && finite(asian?.optionDelta) && finite(bach?.price) && finite(bach?.optionDelta),
        'lp-inventory': finite(lp?.token0) && finite(lp?.token1) && finite(lp?.value) && lp?.inventoryDeltaToken0 === lp?.token0 && !Object.prototype.hasOwnProperty.call(lp, 'delta') && pathFinite('lpValue') && pathFinite('lpInventoryDeltaToken0') && lpBelow?.zone === 'token0' && lpInside?.zone === 'range' && lpAbove?.zone === 'token1',
        'lp-research-range': lpResearchRange?.status === 'research-only' && lpResearchRange?.claimClass === 'scenario-proxy' && lpResearchRange?.executionAuthority === 'none' && finite(lpResearchRange?.lowerPrice) && finite(lpResearchRange?.upperPrice) && lpResearchRange.lowerPrice < 100 && lpResearchRange.upperPrice > 100 && formulaPathInvariantOk,
        'lp-pool-coverage': finite(lpCoverage?.turnover24h) && finite(lpCoverage?.topReserveShare) && pathFinite('lpPoolTurnover24h') && pathFinite('lpPoolTopReserveShare'),
        'liquidity-fingerprint': nonEmpty(fingerprint?.segments) && fingerprint.inputMode === 'hybrid-model' && fingerprint.stats?.orderShare > 0 && Math.abs(fingerprint.segments.reduce((sum, seg) => sum + seg.weight, 0) - 1) < 1e-6,
        'amm-geometry': nonEmpty(amm?.points) && numoen?.status === 'protocol-unverified' && finite(numoen?.R0),
        'capital-efficiency': finite(ce?.efficiency) && ce.efficiency > 1 && finite(ckCe?.rangeWidth) && Math.abs(ckCe.secondDerivative) < 1e-10 && pathFinite('capitalEfficiency'),
        funding: funding?.status === 'proxy-only' && finite(funding?.basisFraction) && finite(funding?.cumulativeFundingProxy) && pathFinite('cumulativeFundingProxy') && missingFundingOk,
        portfolio: nonEmpty(lpCurve?.points) && finite(portfolioLedger?.pnl?.scenarioTotal) && portfolioLedger?.pnl?.total === null,
        'order-plan': Array.isArray(graph.plan?.primaryOrders) && graph.plan.primaryOrders.length > 0 && graph.plan.primaryOrders.every((order) => finite(order.price) && finite(order.targetPrice)),
        'deviation-score': finite(dev?.z) && finite(dev?.deviationPercentile) && finite(dev?.twoSidedTailProbability) && !Object.prototype.hasOwnProperty.call(dev, 'regressionProb'),
        'risk-surface': nonEmpty(surface?.points) && surface.points.some((point) => finite(point.gamma)),
        'net-lp-efficiency': finite(netLp?.geometry?.capitalEfficiency) && netLp?.returns?.netReturn === null && netLp?.missingInputs?.includes('realized-or-path-fee-return'),
        'net-carry': carry?.status === 'proxy-only' && finite(carry?.netReturn) && pathFinite('netCarry'),
        'mean-reversion': halfLife !== null && Object.prototype.hasOwnProperty.call(halfLife, 'halfLifeSessions') && typeof halfLife.speed === 'string',
        'dynamic-holding-state': dynamicHolding?.phase === 'repair-start' && nonEmpty(dynamicHolding?.milestones) && dynamicHolding?.holdingPlan?.shortTrade?.status === '观察',
        'gamma-pnl': finite(gp?.gammaPnl),
        'vol-confidence': finite(vc?.se) && finite(vc?.lower) && finite(vc?.upper),
      }
      const details = {
        formulaPathRows: formulaPath.length,
        chartFiniteFields: Object.fromEntries(['deltaUpper', 'optionGamma', 'lpValue', 'capitalEfficiency', 'cumulativeFundingProxy', 'netCarry'].map((field) => [field, formulaPath.filter((row) => finite(row[field])).length])),
        sampleMatrix,
        missingFundingStatus: missingFundingLast?.status ?? [],
        lpZones: [lpBelow?.zone, lpInside?.zone, lpAbove?.zone],
        lpResearchRange: {
          status: lpResearchRange?.status,
          claimClass: lpResearchRange?.claimClass,
          executionAuthority: lpResearchRange?.executionAuthority,
          lowerPrice: lpResearchRange?.lowerPrice,
          upperPrice: lpResearchRange?.upperPrice,
        },
        formulaPathInvariant,
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
