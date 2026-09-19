#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inferTdpy } from '../../../../src/domain/market-data/tdpy.js'
import { buildMarketStatePath } from '../../../../src/domain/market-data/cost.js'
import {
  deriveDrawdownFeatures,
  deriveDynamicHoldingState,
  deriveRecoveryHorizon,
  deviationScore,
  meanReversionHalfLife,
} from '../../../../src/domain/formulas/core.js'
import {
  CLAIM_CLASS_CONTRACT,
  SYNTHETIC_CK_GEOMETRY_DISCLOSURE,
  buildSyntheticCkGeometryState,
  canonicalizeFormulaSessionFields,
  deriveAdaptiveWindowSpec,
  empiricalDeviationStats,
  isPositiveMonotonicMeanReversion,
  loadNameMap,
  resolveInstrumentName,
} from './selection-helpers.mjs'

const SCHEMA_VERSION = 'china-stock-selection.replay.v4'
const SUPPORTED_MARKETS = new Set(['A股', '港股'])
const SUPPORTED_FORMATS = new Set(['markdown', 'json'])
const SUPPORTED_MODES = new Set(['replay', 'latest'])
const SUPPORTED_TARGET_MODES = new Set(['structure', 'fixed'])
const STATE_CONTRACT = Object.freeze({
  dataState: ['ready', 'provisional', 'stale', 'invalid'],
  scoreStatus: ['not-applicable'],
  candidateStatus: ['需刷新数据', '剔除', '等待', '观察'],
  executionStatus: ['blocked', 'simulation-only'],
})
const REPLAY_CLAIM_CLASSES = Object.freeze({
  costAnchor: 'sample-estimate',
  deviation: 'sample-estimate',
  empiricalDeviation: 'sample-estimate',
  meanReversion: 'sample-estimate',
  syntheticCkGeometry: 'scenario-proxy',
  target: 'scenario-proxy',
  dynamicHolding: 'scenario-proxy',
  historicalReplay: 'sample-estimate',
  execution: 'missing-input',
})
const SUPPORTED_FLAGS = new Set([
  'profile', 'mode', 'market', 'fee', 'min-rows', 'format',
  'index', 'data-dir', 'name-map', 'target', 'stop', 'min-z',
  'ck-geometry-max', 'lp-max', 'max-hl', 'min-slope', 'max-slope',
  'min-distance', 'max-distance', 'max-entry-gap', 'min-entry-gap',
  'max-hold', 'target-mode',
])
const BOOLEAN_FLAGS = new Set()
const ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const args = parseArgs(process.argv.slice(2), SUPPORTED_FLAGS, BOOLEAN_FLAGS)
const STRICT_DEFAULTS = {
  minimumGrossReturn: 0.03,
  stopLoss: 0.015,
  minZ: 2,
  maxCkGeometryPercentile: 3,
  maxHalfLifeSessions: 12,
  minCostSlopePct: -1,
  maxCostSlopePct: 1,
  minCostDistancePct: 10,
  maxCostDistancePct: 16,
  maxEntryGapPct: 0.5,
  minEntryGapPct: -3,
  targetMode: 'structure',
}
const SWING_DEFAULTS = {
  minimumGrossReturn: 0.04,
  stopLoss: 0.015,
  minZ: 2.5,
  maxCkGeometryPercentile: 5,
  maxHalfLifeSessions: 20,
  minCostSlopePct: -1,
  maxCostSlopePct: 0.5,
  minCostDistancePct: 12,
  maxCostDistancePct: 22,
  maxEntryGapPct: 0.5,
  minEntryGapPct: -3,
  targetMode: 'structure',
}

const profileMode = String(args.profile ?? 'strict')
const profiles = buildProfiles(profileMode)
const marketValues = parseMarkets(args.market ?? 'A股')
const mode = enumArg(args.mode ?? 'replay', SUPPORTED_MODES, 'mode')
const format = enumArg(args.format ?? 'markdown', SUPPORTED_FORMATS, 'format')
if (args.fee === undefined) fail('--fee is required; pass --fee 0 explicitly when no fee drag is intended')
const requestedFeeRate = finiteArg(args.fee, null, 'fee', { min: 0, max: 1, maxExclusive: true })
const explicitMinRows = optionalPositiveIntArg(args['min-rows'], 'min-rows')
const indexInput = String(args.index ?? 'src/data/stock-index.json')
const dataDirInput = String(args['data-dir'] ?? 'public/data')
const nameMapInput = String(args['name-map'] ?? defaultNameMapPath())
const nameMap = loadNameMap(resolvePath(nameMapInput))
const config = {
  profile: profileMode,
  mode,
  market: marketValues.join(','),
  markets: marketValues,
  feeRate: requestedFeeRate,
  feeAppliedToReturns: mode === 'replay',
  feeModel: {
    requestedRate: requestedFeeRate,
    appliedRate: mode === 'replay' ? requestedFeeRate : null,
    appliedToReturns: mode === 'replay',
    calculation: mode === 'replay' ? 'netReturn=grossReturn-feeRate-once' : 'not-applied-in-latest-observation-mode',
  },
  rowGate: {
    mode: explicitMinRows === null ? 'adaptive' : 'explicit-scenario',
    source: explicitMinRows === null
      ? 'per-instrument adaptive window spec from tradingDaysPerYear and visible prefix'
      : 'cli:--min-rows',
    explicitMinimumRows: explicitMinRows,
    adaptiveFormula: 'ceil(sqrt(tradingDaysPerYear))',
  },
  format,
  intrabarPolicy: 'stop-first-conservative-when-both-hit',
  targetTiming: 'signal-context-frozen-target-recomputed-with-next-session-open',
  targetContextPolicy: 'cost-band-half-life-and-drawdown-frozen-at-signal-close; deviation-rescaled-to-entry-derived-horizon',
  horizonPolicy: 'entry-to-cost-lower-recovery-horizon-recomputed-at-next-session-open',
  fixedHorizonApplied: profiles.some((profile) => profile.fixedHorizonApplied),
  executionAuthority: 'none',
  settlementPolicy: 'A-share-T+1; Hong-Kong-entry-session-daily-bar-check-with-stop-first-ambiguity-policy',
  profiles,
}
const researchBoundary = {
  status: config.mode === 'replay' ? 'historical-replay-only' : 'latest-observation-only',
  executionStatus: config.mode === 'replay' ? 'simulation-only' : 'blocked',
  executionAuthority: 'none',
  reasons: config.mode === 'replay'
    ? ['historical-daily-ohlcv-fill-model', 'not-live-tradability-or-future-expectancy']
    : ['no-return-or-fill-simulation', 'account-risk-budget-and-live-execution-inputs-unavailable'],
}

const index = readJson(resolvePath(indexInput))
if (!Array.isArray(index)) fail(`stock index must be an array: ${indexInput}`)
const dataDir = resolvePath(dataDirInput)
const rowsOut = []
const skipped = []
const coverage = []
let considered = 0

for (const entry of index) {
  if (!config.markets.includes(entry.market)) continue
  considered += 1
  const file = join(dataDir, String(entry.url ?? '').split('/').at(-1))
  if (!existsSync(file)) {
    skipped.push(skipRecord(entry, 'missing-csv'))
    continue
  }
  const rows = parseCsv(readFileSync(file, 'utf8'))
  const tdpy = inferTdpy(entry).value
  const adaptiveWindowSpec = deriveAdaptiveWindowSpec({
    tradingDaysPerYear: tdpy,
    visibleRows: rows.length,
  })
  const requiredRows = explicitMinRows ?? adaptiveWindowSpec.minimumRequiredRows
  const rowGate = {
    mode: explicitMinRows === null ? 'adaptive' : 'explicit-scenario',
    source: explicitMinRows === null ? adaptiveWindowSpec.source : 'cli:--min-rows',
    requiredRows,
    explicitMinimumRows: explicitMinRows,
    adaptiveMinimumRows: adaptiveWindowSpec.minimumRequiredRows,
  }
  const dataset = datasetProvenance(entry, rows, { adaptiveWindowSpec, rowGate })
  coverage.push(dataset)
  if (rows.length < requiredRows) {
    skipped.push(skipRecord(entry, 'insufficient-rows', {
      rows: rows.length,
      requiredRows,
      rowGate,
      adaptiveWindowSpec,
    }))
    continue
  }
  const instrumentRows = config.mode === 'latest'
    ? scanLatestInstrument(entry, rows, dataset)
    : replayInstrument(entry, rows, dataset)
  if (!instrumentRows.length) {
    skipped.push(skipRecord(entry, config.mode === 'latest' ? 'no-eligible-latest-signal' : 'no-eligible-replay-trade', {
      dataThrough: dataset.dataThrough,
      rows: dataset.rows,
      staleDays: dataset.staleDays,
    }))
    continue
  }
  rowsOut.push(...instrumentRows)
}

const summary = config.mode === 'latest' ? summarizeSignals(rowsOut) : summarize(rowsOut)
const filters = {
  markets: config.markets,
}
const provenance = {
  runtime: '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  dataModel: 'local-daily-ohlcv',
  index: indexInput,
  dataDir: dataDirInput,
  nameMap: nameMapInput,
}
const freshness = summarizeFreshness(coverage)
const audit = {
  considered,
  dataReady: coverage.filter((item) => item.rowGate.passed).length,
  emitted: rowsOut.length,
  skipped: skipped.length,
  skipReasons: countReasons(skipped),
}
if (config.format === 'json') {
  const key = config.mode === 'latest' ? 'signals' : 'trades'
  console.log(JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    config: { ...config },
    provenance,
    filters,
    freshness,
    audit,
    stateContract: STATE_CONTRACT,
    claimClassContract: CLAIM_CLASS_CONTRACT,
    claimClasses: REPLAY_CLAIM_CLASSES,
    researchBoundary,
    syntheticCkGeometry: SYNTHETIC_CK_GEOMETRY_DISCLOSURE,
    summary,
    [key]: rowsOut,
    skipped,
  }, null, 2))
} else if (config.mode === 'latest') {
  printLatestMarkdown({ config, summary, signals: rowsOut })
} else {
  printMarkdown({ config, summary, trades: rowsOut })
}

function scanLatestInstrument(entry, rows, dataset) {
  const tdpy = inferTdpy(entry).value
  const marketPath = buildMarketStatePath(rows, tdpy)
  const ckGeometryStates = rows.map((row, index) => buildSyntheticCkGeometryState(marketPath[index], row))
  const ckGeometryValues = ckGeometryStates.map((state) => state?.normalizedValue)
  const signal = buildSignal({
    entry,
    rows,
    marketPath,
    ckGeometryValues,
    tdpy,
    index: rows.length - 1,
    dataset,
    adaptiveWindowSpec: dataset.adaptiveWindowSpec,
  })
  if (!signal?.eligible) return []
  const { profileConfig: _profileConfig, replayContext: _replayContext, ...signalRow } = signal
  return [signalRow]
}

function replayInstrument(entry, rows, dataset) {
  const tdpy = inferTdpy(entry).value
  const marketPath = buildMarketStatePath(rows, tdpy)
  const ckGeometryStates = rows.map((row, index) => buildSyntheticCkGeometryState(marketPath[index], row))
  const ckGeometryValues = ckGeometryStates.map((state) => state?.normalizedValue)
  const out = []
  let nextAllowedIndex = 0

  for (let i = 0; i < rows.length - 1; i += 1) {
    const adaptiveWindowSpec = deriveAdaptiveWindowSpec({
      tradingDaysPerYear: tdpy,
      visibleRows: i + 1,
    })
    const requiredPrefixRows = explicitMinRows ?? adaptiveWindowSpec.minimumRequiredRows
    if (i + 1 < requiredPrefixRows) continue
    if (i < nextAllowedIndex) continue
    const signal = buildSignal({
      entry,
      rows,
      marketPath,
      ckGeometryValues,
      tdpy,
      index: i,
      dataset,
      adaptiveWindowSpec,
    })
    if (!signal?.eligible) continue
    const { profileConfig, replayContext: _replayContext, ...signalRow } = signal
    const trade = simulateTrade(rows, i, profileConfig, signal, entry.market)
    if (!trade) continue
    out.push({ ...signalRow, ...trade })
    nextAllowedIndex = i + trade.appliedHorizonSessions + 1
  }
  return out
}

function buildSignal({
  entry,
  rows,
  marketPath,
  ckGeometryValues,
  tdpy,
  index,
  dataset,
  adaptiveWindowSpec,
}) {
  const row = rows[index]
  const market = marketPath[index]
  if (!market || !Number.isFinite(market.costDistance) || market.costDistance >= 0) return null
  const observationDataset = datasetAtObservation({
    dataset,
    row,
    visibleRows: index + 1,
    adaptiveWindowSpec,
    historical: config.mode === 'replay',
  })

  const costDistancePct = Math.abs(market.costDistance * 100)
  const costSlopePct = (market.costSlopeRecent ?? market.costSlope5 ?? 0) * 100

  const ckGeometryPercentile = percentile(
    ckGeometryValues.slice(
      Math.max(0, index - adaptiveWindowSpec.ckGeometryRankWindowRows + 1),
      index + 1,
    ),
    ckGeometryValues[index],
  )
  const deviationStats = empiricalDeviationStats(
    marketPath
      .slice(Math.max(0, index - adaptiveWindowSpec.empiricalDeviationWindowRows + 1), index + 1)
      .map((item) => item?.costDistance),
    market.costDistance,
  )

  const meanReversion = meanReversionHalfLife({
    costDistanceSeries: marketPath
      .slice(Math.max(0, index - adaptiveWindowSpec.meanReversionWindowRows + 1), index + 1)
      .map((item) => item?.costDistance)
      .filter(Number.isFinite),
    tradingDaysPerYear: tdpy,
  })
  const halfLifeSessions = isPositiveMonotonicMeanReversion(meanReversion)
    ? meanReversion.halfLifeSessions
    : null
  const signalRecovery = deriveRecoveryHorizon({
    cycleStartPrice: row.close,
    anchorPrice: market.costAnchor,
    targetPrice: market.costLow,
    halfLifeSessions,
    availableAt: `${row.date}:close`,
  })
  if (!signalRecovery?.eligible) return null
  const deviation = deviationScore({
    costDistance: market.costDistance,
    annualVol: Math.max(market.annualVol ?? 0, 0.01),
    formulaHorizonSessions: signalRecovery.modelHorizonSessions,
    tradingDaysPerYear: tdpy,
  })
  if (!deviation) return null

  for (const profile of profiles) {
    if (costDistancePct < profile.minCostDistancePct || costDistancePct > profile.maxCostDistancePct) continue
    if (costSlopePct < profile.minCostSlopePct || costSlopePct > profile.maxCostSlopePct) continue
    if (!deviation || deviation.z > -profile.minZ) continue
    if (!Number.isFinite(ckGeometryPercentile) || ckGeometryPercentile > profile.maxCkGeometryPercentile) continue
    if (!Number.isFinite(halfLifeSessions) || halfLifeSessions > profile.maxHalfLifeSessions) continue

    const target = buildTargetPlan({
      row,
      rows,
      index,
      market,
      profile,
      deviation,
      halfLifeSessions,
      costSlopePct,
      availableAt: `${row.date}:close`,
    })
    if (!target?.eligible) continue
    const dataState = dataStateRecord(observationDataset.freshness)
    const signalDecision = resolveSignalStatus({ dataState: dataState.status, dynamicHolding: target.dynamicHolding, targetMode: profile.targetMode })

    return {
      profile: profile.name,
      profileMinimumGrossReturnPct: Number.isFinite(profile.minimumGrossReturn)
        ? round(profile.minimumGrossReturn * 100, 2)
        : null,
      profileFixedTargetReturnPct: Number.isFinite(profile.fixedTargetReturn)
        ? round(profile.fixedTargetReturn * 100, 2)
        : null,
      signalTargetGrossReturnPct: Number.isFinite(target.grossReturn)
        ? round(target.grossReturn * 100, 2)
        : null,
      profileStopPct: round(profile.stopLoss * 100, 2),
      targetMode: profile.targetMode,
      targetId: target.id,
      targetPrice: Number.isFinite(target.targetPrice) ? round(target.targetPrice, 3) : null,
      symbol: entry.symbol,
      name: observationDataset.name,
      nameSource: observationDataset.nameSource,
      market: entry.market,
      source: observationDataset.source,
      dataThrough: observationDataset.dataThrough,
      rows: observationDataset.rows,
      staleDays: observationDataset.staleDays,
      freshness: observationDataset.freshness,
      dataState: dataState.status,
      dataStateReasons: dataState.reasons,
      scoreStatus: 'not-applicable',
      provenance: {
        marketSource: observationDataset.source,
        nameSource: observationDataset.nameSource,
        dataThrough: observationDataset.dataThrough,
        rows: observationDataset.rows,
        rowGate: observationDataset.rowGate,
        adaptiveWindowSpec,
      },
      adaptiveWindowSpec,
      candidateStatus: signalDecision.status,
      // Compatibility alias. New consumers must use candidateStatus.
      status: signalDecision.status,
      statusReasons: signalDecision.reasons,
      executionStatus: researchBoundary.executionStatus,
      executionReasons: researchBoundary.reasons,
      executionAuthority: 'none',
      claimClasses: REPLAY_CLAIM_CLASSES,
      signalDate: row.date,
      deviationZ: round(deviation.z, 2),
      deviationHorizonSessions: signalRecovery.modelHorizonSessions,
      halfLifeSessions: round(halfLifeSessions, 1),
      arCoefficient: round(meanReversion.arCoefficient, 6),
      meanReversionDecayMode: meanReversion.decayMode,
      deviationPercentilePct: round(deviation.deviationPercentile * 100, 1),
      deviationTwoSidedTailProbabilityPct: round(deviation.twoSidedTailProbability * 100, 1),
      deviationProbabilitySemantics: deviation.probabilitySemantics,
      empiricalDeviationPercentilePct: nullableRound(deviationStats?.percentilePct, 1),
      empiricalDeviationLowerTailPct: nullableRound(deviationStats?.lowerTailPct, 1),
      empiricalDeviationUpperTailPct: nullableRound(deviationStats?.upperTailPct, 1),
      empiricalDeviationTwoSidedTailPct: nullableRound(deviationStats?.twoSidedTailPct, 1),
      empiricalDeviationSampleSize: deviationStats?.sampleSize ?? 0,
      empiricalDeviationInterpretation: deviationStats?.interpretation ?? null,
      ckGeometryPercentile: round(ckGeometryPercentile, 1),
      ckGeometryModel: SYNTHETIC_CK_GEOMETRY_DISCLOSURE.model,
      ckGeometryInterpretation: SYNTHETIC_CK_GEOMETRY_DISCLOSURE.interpretation,
      costDistancePct: round(market.costDistance * 100, 2),
      costSlopePct: round(costSlopePct, 2),
      signalTargetRecoveryFraction: nullableRound(target.targetRecoveryFraction, 6),
      signalStructuralRecoveryFraction: nullableRound(target.structuralRecoveryFraction, 6),
      signalModelHorizonSessions: target.modelHorizonSessions,
      modelHorizonSessions: config.mode === 'latest' ? null : target.modelHorizonSessions,
      modelHorizonStatus: config.mode === 'latest'
        ? 'awaiting-next-session-open'
        : 'signal-context-only-awaiting-entry-recompute',
      horizonMode: target.horizonMode,
      fixedHorizonApplied: target.fixedHorizonApplied,
      appliedHorizonSessions: target.fixedHorizonApplied ? target.fixedHorizonSessions : null,
      dynamicHolding: target.dynamicHolding ?? null,
      ...dynamicColumns(target.dynamicHolding),
      eligible: true,
      profileConfig: profile,
      replayContext: { market, deviation, halfLifeSessions, costSlopePct, index, tdpy },
    }
  }

  return null
}

function simulateTrade(rows, signalIndex, profile, signalPlan, market) {
  const entryIndex = signalIndex + 1
  const signal = rows[signalIndex]
  const entry = rows[entryIndex]
  const entryGap = entry.open / signal.close - 1
  if (entryGap > profile.maxEntryGapPct / 100 || entryGap < profile.minEntryGapPct / 100) return null

  const entryPrice = entry.open
  const entryTarget = recomputeTargetAtEntry({ rows, signalIndex, entry, profile, signalPlan })
  if (!entryTarget?.eligible) return null
  const targetPrice = entryTarget.targetPrice
  if (targetPrice <= entryPrice) return null
  const stopPrice = entryPrice * (1 - profile.stopLoss)
  const modelHorizonSessions = entryTarget.modelHorizonSessions
  const appliedHorizonSessions = entryTarget.fixedHorizonApplied
    ? entryTarget.fixedHorizonSessions
    : modelHorizonSessions
  if (!Number.isInteger(appliedHorizonSessions) || appliedHorizonSessions <= 0) return null
  const settlementLagSessions = market === 'A股' ? 1 : 0
  const lastExitIndex = entryIndex + appliedHorizonSessions
  if (lastExitIndex >= rows.length || entryIndex + settlementLagSessions > lastExitIndex) return null

  for (let i = entryIndex + settlementLagSessions; i <= lastExitIndex; i += 1) {
    const row = rows[i]
    const stopHit = row.low <= stopPrice
    const targetHit = row.high >= targetPrice
    if (stopHit) return tradeResult({
      entry,
      exit: row,
      entryGap,
      entryPrice,
      exitPrice: stopPrice,
      reason: 'stop',
      actualHoldSessions: i - entryIndex,
      targetPrice,
      entryTarget,
      signalPlan,
      intrabarBothHit: targetHit,
      modelHorizonSessions,
      appliedHorizonSessions,
      settlementLagSessions,
    })
    if (targetHit) return tradeResult({
      entry,
      exit: row,
      entryGap,
      entryPrice,
      exitPrice: targetPrice,
      reason: 'target',
      actualHoldSessions: i - entryIndex,
      targetPrice,
      entryTarget,
      signalPlan,
      modelHorizonSessions,
      appliedHorizonSessions,
      settlementLagSessions,
    })
  }
  const exit = rows[lastExitIndex]
  return tradeResult({
    entry,
    exit,
    entryGap,
    entryPrice,
    exitPrice: exit.close,
    reason: entryTarget.fixedHorizonApplied ? 'fixedHorizonScenario' : 'modelHorizon',
    actualHoldSessions: lastExitIndex - entryIndex,
    targetPrice,
    entryTarget,
    signalPlan,
    modelHorizonSessions,
    appliedHorizonSessions,
    settlementLagSessions,
  })
}

function recomputeTargetAtEntry({ rows, signalIndex, entry, profile, signalPlan }) {
  const context = signalPlan?.replayContext
  if (!context) return null
  const entryRecovery = deriveRecoveryHorizon({
    cycleStartPrice: entry.open,
    anchorPrice: context.market.costAnchor,
    targetPrice: context.market.costLow,
    halfLifeSessions: context.halfLifeSessions,
    availableAt: `${entry.date}:open`,
  })
  if (!entryRecovery?.eligible) return null
  const entryDeviation = deviationScore({
    costDistance: context.market.costDistance,
    annualVol: Math.max(context.market.annualVol ?? 0, 0.01),
    formulaHorizonSessions: entryRecovery.modelHorizonSessions,
    tradingDaysPerYear: context.tdpy,
  })
  if (!entryDeviation) return null
  return buildTargetPlan({
    row: { ...entry, close: entry.open },
    rows,
    index: signalIndex,
    market: context.market,
    profile,
    deviation: entryDeviation,
    halfLifeSessions: context.halfLifeSessions,
    costSlopePct: context.costSlopePct,
    availableAt: `${entry.date}:open`,
  })
}

function tradeResult({
  entry,
  exit,
  entryGap,
  entryPrice,
  exitPrice,
  reason,
  actualHoldSessions,
  targetPrice = null,
  entryTarget = null,
  signalPlan = null,
  intrabarBothHit = false,
  modelHorizonSessions,
  appliedHorizonSessions,
  settlementLagSessions,
}) {
  const grossReturn = exitPrice / entryPrice - 1
  const netReturn = grossReturn - config.feeRate
  const actualTargetGrossReturn = targetPrice / entryPrice - 1
  return {
    entryDate: entry.date,
    exitDate: exit.date,
    entryGapPct: round(entryGap * 100, 2),
    entryPrice: round(entryPrice, 3),
    exitPrice: round(exitPrice, 3),
    signalTargetPrice: Number.isFinite(signalPlan?.targetPrice) ? round(signalPlan.targetPrice, 3) : null,
    targetPrice: Number.isFinite(targetPrice) ? round(targetPrice, 3) : null,
    targetId: entryTarget?.id ?? signalPlan?.targetId ?? null,
    targetRecomputedAtEntry: true,
    targetTiming: config.targetTiming,
    targetContextPolicy: config.targetContextPolicy,
    entryDeviationZ: nullableRound(entryTarget?.deviationZ, 6),
    entryDeviationHorizonSessions: modelHorizonSessions,
    actualTargetGrossReturnPct: round(actualTargetGrossReturn * 100, 6),
    targetRecoveryFraction: nullableRound(entryTarget?.targetRecoveryFraction, 6),
    structuralRecoveryFraction: nullableRound(entryTarget?.structuralRecoveryFraction, 6),
    horizonCycleStartPrice: nullableRound(entryTarget?.horizonCycleStartPrice, 6),
    horizonCostLowerPrice: nullableRound(entryTarget?.horizonCostLowerPrice, 6),
    horizonAnchorPrice: nullableRound(entryTarget?.horizonAnchorPrice, 6),
    modelHorizonSessions,
    modelHorizonRaw: nullableRound(entryTarget?.modelHorizonRaw, 6),
    modelHorizonStatus: 'recomputed-from-actual-entry-open',
    horizonMode: entryTarget?.horizonMode ?? null,
    appliedHorizonSessions,
    fixedHorizonApplied: entryTarget?.fixedHorizonApplied === true,
    executionAuthority: 'none',
    settlementLagSessions,
    dynamicHolding: entryTarget?.dynamicHolding ?? null,
    ...dynamicColumns(entryTarget?.dynamicHolding),
    reason,
    intrabarBothHit,
    intrabarPolicy: config.intrabarPolicy,
    actualHoldSessions,
    grossReturnPct: round(grossReturn * 100, 2),
    netReturnPct: round(netReturn * 100, 2),
  }
}

function buildTargetPlan({
  row,
  rows,
  index,
  market,
  profile,
  deviation,
  halfLifeSessions,
  costSlopePct,
  availableAt,
}) {
  const structuralRecovery = deriveRecoveryHorizon({
    cycleStartPrice: row.close,
    anchorPrice: market.costAnchor,
    targetPrice: market.costLow,
    halfLifeSessions,
    availableAt,
  })
  if (!structuralRecovery?.eligible) return null
  const activeGrossReturnThreshold = profile.targetMode === 'fixed'
    ? profile.fixedTargetReturn
    : profile.minimumGrossReturn
  const rawDynamicHolding = deriveDynamicHoldingState({
    zScore: deviation.z,
    halfLifeSessions,
    entryPrice: row.close,
    anchorPrice: market.costAnchor,
    targetPrices: {
      costLower: market.costLow,
      anchor: market.costAnchor,
    },
    minAbsZ: profile.minZ,
    costSlopePct,
    drawdown: deriveDrawdownFeatures({ rows, index }),
    profiles: {
      shortTrade: { targetOrder: ['firstRepair'], minGrossReturn: activeGrossReturnThreshold },
      fundCycle: { targetOrder: ['firstRepair'], minGrossReturn: activeGrossReturnThreshold },
    },
  })
  const dynamicHolding = canonicalizeFormulaSessionFields(rawDynamicHolding)
  if (config.mode === 'replay' && dynamicHolding.holdingPlan.shortTrade.action !== 'execute') return null
  if (config.mode === 'latest' && dynamicHolding.status === '剔除') return null

  if (profile.targetMode === 'fixed') {
    const targetPrice = row.close * (1 + profile.fixedTargetReturn)
    const targetRecoveryFraction = (targetPrice - row.close) / (market.costAnchor - row.close)
    return {
      eligible: true,
      id: 'fixed',
      targetPrice,
      grossReturn: profile.fixedTargetReturn,
      targetRecoveryFraction,
      structuralRecoveryFraction: structuralRecovery.recoveryFraction,
      horizonCycleStartPrice: row.close,
      horizonCostLowerPrice: market.costLow,
      horizonAnchorPrice: market.costAnchor,
      modelHorizonRaw: structuralRecovery.modelHorizonRaw,
      modelHorizonSessions: structuralRecovery.modelHorizonSessions,
      horizonMode: 'explicit-fixed-target-and-horizon-scenario',
      fixedHorizonApplied: true,
      fixedHorizonSessions: profile.fixedHorizonSessions,
      executionAuthority: 'none',
      deviationZ: deviation.z,
      dynamicHolding: {
        ...dynamicHolding,
        targetInputMode: 'explicit-fixed-return-and-horizon-scenario-with-structural-gates',
        syntheticCkGeometryUsedAsTarget: false,
        fixedHorizonApplied: true,
        executionAuthority: 'none',
      },
    }
  }
  const selected = dynamicHolding.milestones.find((item) => item.sourceId === 'costLower')
  if (
    !selected
    || selected.grossReturn < profile.minimumGrossReturn
    || selected.effectiveTargetPrice <= row.close
  ) return null
  return {
    eligible: true,
    id: selected.sourceId,
    targetPrice: selected.effectiveTargetPrice,
    grossReturn: selected.grossReturn,
    targetRecoveryFraction: structuralRecovery.recoveryFraction,
    structuralRecoveryFraction: structuralRecovery.recoveryFraction,
    horizonCycleStartPrice: row.close,
    horizonCostLowerPrice: market.costLow,
    horizonAnchorPrice: market.costAnchor,
    modelHorizonRaw: structuralRecovery.modelHorizonRaw,
    modelHorizonSessions: structuralRecovery.modelHorizonSessions,
    horizonMode: 'formula-derived-from-entry-to-cost-lower-target',
    fixedHorizonApplied: false,
    fixedHorizonSessions: null,
    executionAuthority: 'none',
    deviationZ: deviation.z,
    dynamicHolding: {
      ...dynamicHolding,
      targetInputMode: 'cost-band-and-anchor-only',
      syntheticCkGeometryUsedAsTarget: false,
      fixedHorizonApplied: false,
      executionAuthority: 'none',
    },
  }
}

function summarize(rows) {
  if (!rows.length) return { trades: 0, byProfile: {} }
  return {
    ...summarizeStats(rows),
    byProfile: Object.fromEntries([...new Set(rows.map((row) => row.profile))].map((profile) => [
      profile,
      summarizeStats(rows.filter((row) => row.profile === profile)),
    ])),
  }
}

function summarizeSignals(rows) {
  return {
    signals: rows.length,
    byProfile: Object.fromEntries([...new Set(rows.map((row) => row.profile))].map((profile) => [
      profile,
      rows.filter((row) => row.profile === profile).length,
    ])),
  }
}

function summarizeStats(rows) {
  const returns = rows.map((row) => row.netReturnPct / 100).sort((a, b) => a - b)
  const avg = returns.reduce((sum, item) => sum + item, 0) / returns.length
  const winCount = rows.filter((row) => row.netReturnPct > 0).length
  const targetCount = rows.filter((row) => row.reason === 'target').length
  const stopCount = rows.filter((row) => row.reason === 'stop').length
  return {
    trades: rows.length,
    winRatePct: round(winCount / rows.length * 100, 2),
    targetHitPct: round(targetCount / rows.length * 100, 2),
    stopPct: round(stopCount / rows.length * 100, 2),
    avgNetPct: round(avg * 100, 2),
    medianNetPct: round(quantile(returns, 0.5) * 100, 2),
    p10NetPct: round(quantile(returns, 0.1) * 100, 2),
    p90NetPct: round(quantile(returns, 0.9) * 100, 2),
    worstNetPct: round(returns[0] * 100, 2),
    bestNetPct: round(returns.at(-1) * 100, 2),
  }
}

function printMarkdown({ config, summary, trades }) {
  console.log(`# T+1 Short-Hold Replay`)
  console.log(``)
  console.log(`Markets: ${config.markets.join(', ')} | profile: ${config.profile} | fee: ${pct(config.feeRate)} applied once to each replay return`)
  console.log(`Source: ${provenance.index} + ${provenance.dataDir} | freshness: ${freshnessText(freshness)}`)
  console.log(`Skipped: ${reasonSummary(audit.skipReasons)}`)
  for (const profile of config.profiles) {
    const horizon = profile.fixedHorizonApplied
      ? `explicit fixed horizon ${profile.fixedHorizonSessions} sessions (scenario only)`
      : 'per-event H from actual entry -> costLower recovery'
    const returnRule = profile.targetMode === 'fixed'
      ? `fixed target ${pct(profile.fixedTargetReturn)}`
      : `minimum structural gross return ${pct(profile.minimumGrossReturn)}`
    console.log(`- ${profile.name}: ${returnRule}, stop ${pct(profile.stopLoss)}, ${horizon}, z(H)<=-${profile.minZ}, synthetic CK geometry P<=${profile.maxCkGeometryPercentile}, HL<=${profile.maxHalfLifeSessions} sessions, costDistance ${profile.minCostDistancePct}-${profile.maxCostDistancePct}%`)
  }
  console.log(``)
  console.log(`Trades: ${summary.trades ?? 0} | win ${summary.winRatePct ?? 0}% | target ${summary.targetHitPct ?? 0}% | stop ${summary.stopPct ?? 0}% | avg ${summary.avgNetPct ?? 0}% | median ${summary.medianNetPct ?? 0}%`)
  console.log(`Profile mix: ${formatProfileMix(summary.byProfile)}`)
  console.log(`Risk: p10 ${summary.p10NetPct ?? 0}% | p90 ${summary.p90NetPct ?? 0}% | worst ${summary.worstNetPct ?? 0}% | best ${summary.bestNetPct ?? 0}%`)
  console.log(``)
  console.log(`| profile | status / phase | status reason | target | q | model H / applied H | symbol | name | source | through / rows / age | signal | exit | exit reason | hold | net | z(H) | HL | normal P | normal tail | empirical P | CK geom P | costDist | gap |`)
  console.log(`| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`)
  for (const row of trades.slice(0, 20)) {
    console.log(`| ${row.profile} | ${row.status} / ${row.dynamicPhase ?? '-'} | ${row.statusReasons.join(',')} | ${targetLabel(row)} | ${row.targetRecoveryFraction ?? '-'} | ${row.modelHorizonSessions ?? '-'} / ${row.appliedHorizonSessions ?? '-'} | ${row.symbol} | ${row.name} | ${row.source} | ${row.dataThrough} / ${row.rows} / ${row.staleDays ?? '?'}d | ${row.signalDate} | ${row.exitDate} | ${row.reason} | ${row.actualHoldSessions} | ${row.netReturnPct}% | ${row.deviationZ} | ${row.halfLifeSessions} | ${nullablePct(row.deviationPercentilePct)} | ${nullablePct(row.deviationTwoSidedTailProbabilityPct)} | ${nullablePct(row.empiricalDeviationPercentilePct)} | ${nullablePct(row.ckGeometryPercentile)} | ${row.costDistancePct}% | ${row.entryGapPct}% |`)
  }
  console.log(``)
  console.log(`Replay assumptions: signal-day cost band, half-life and drawdown stay frozen; q=(costLower-entry)/(costAnchor-entry) and H=HL*log2(1/(1-q)) are recomputed with the actual next-session open. In structure mode the same H controls tail sufficiency, horizon exit, and non-overlap. When stop and target are both inside one OHLC bar, stop wins conservatively. Only positive monotonic AR decay is eligible. A requested social-security whitelist is a current static list, not point-in-time history.`)
  console.log(`Research replay only. Normal-reference deviation P/tail and empirical ranks describe extremeness, not mean-reversion probability. Synthetic CK geometry is a normalized shape diagnostic, not a real LP position, token holding, fee income, or investment return; it is not used as a target price. No RSI/KDJ/EMA/MA or external factors are used.`)
}

function printLatestMarkdown({ config, summary, signals }) {
  console.log(`# T+1 Short-Hold Latest Scan`)
  console.log(``)
  console.log(`Markets: ${config.markets.join(', ')} | profile: ${config.profile} | mode: latest | fee: not applied (requested ${pct(config.feeRate)} is ignored because no return is simulated)`)
  console.log(`Source: ${provenance.index} + ${provenance.dataDir} | freshness: ${freshnessText(freshness)}`)
  console.log(`Skipped: ${reasonSummary(audit.skipReasons)}`)
  for (const profile of config.profiles) {
    const horizon = profile.fixedHorizonApplied
      ? `explicit fixed horizon ${profile.fixedHorizonSessions} sessions (scenario only)`
      : 'actual-entry model horizon pending next open'
    const returnRule = profile.targetMode === 'fixed'
      ? `fixed target ${pct(profile.fixedTargetReturn)}`
      : `minimum structural gross return ${pct(profile.minimumGrossReturn)}`
    console.log(`- ${profile.name}: ${returnRule}, stop ${pct(profile.stopLoss)}, ${horizon}, z(H)<=-${profile.minZ}, synthetic CK geometry P<=${profile.maxCkGeometryPercentile}, HL<=${profile.maxHalfLifeSessions} sessions, costDistance ${profile.minCostDistancePct}-${profile.maxCostDistancePct}%`)
  }
  console.log(``)
  console.log(`Signals: ${summary.signals ?? 0} | Profile mix: ${formatSignalProfileMix(summary.byProfile)}`)
  console.log(``)
  console.log(`| profile | status / phase | status reason | target | structural q / H | actual-entry H | symbol | name | source | through / rows / age | signal | normal P | normal tail | empirical P | CK geom P | shortReturn | fundReturn | firstReview | base | stretch | short | fund | dynamic reasons |`)
  console.log(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | --- | --- | --- |`)
  for (const row of signals.slice(0, 30)) {
    console.log(`| ${row.profile} | ${row.status} / ${row.dynamicPhase ?? '-'} | ${row.statusReasons.join(',')} | ${targetLabel(row)} | ${row.signalStructuralRecoveryFraction ?? '-'} / ${row.signalModelHorizonSessions ?? '-'} | ${row.modelHorizonStatus} | ${row.symbol} | ${row.name} | ${row.source} | ${row.dataThrough} / ${row.rows} / ${row.staleDays ?? '?'}d | ${row.signalDate} | ${nullablePct(row.deviationPercentilePct)} | ${nullablePct(row.deviationTwoSidedTailProbabilityPct)} | ${nullablePct(row.empiricalDeviationPercentilePct)} | ${nullablePct(row.ckGeometryPercentile)} | ${row.shortExpectedReturnPct ?? '-'} | ${row.fundExpectedReturnPct ?? '-'} | ${row.firstReviewSessions ?? '-'} | ${row.baseAnchorSessions ?? '-'} | ${row.stretchSessions ?? '-'} | ${row.shortPlan ?? '-'} | ${row.fundPlan ?? '-'} | ${row.waitingReasons || '-'} |`)
  }
  console.log(``)
  console.log(`Observation scan only. Normal-reference deviation P/tail and empirical ranks describe extremeness, not mean-reversion probability. Synthetic CK geometry is a normalized shape diagnostic, not a real LP position, token holding, fee income, or investment return; it is not used as a target price. No RSI/KDJ/EMA/MA or external factors are used.`)
}

function targetLabel(row) {
  return row.targetPrice === null
    ? `${row.targetId}@${nullablePct(row.signalTargetGrossReturnPct)}`
    : `${row.targetId}@${row.targetPrice}`
}

function dynamicColumns(dynamicHolding) {
  if (!dynamicHolding) return {}
  const expectation = dynamicHolding.expectation ?? {}
  const shortExpectation = expectation.profileExpectations?.shortTrade
  const fundExpectation = expectation.profileExpectations?.fundCycle
  const short = dynamicHolding.holdingPlan?.shortTrade
  const fund = dynamicHolding.holdingPlan?.fundCycle
  return {
    dynamicStatus: dynamicHolding.status,
    dynamicPhase: dynamicHolding.phaseLabel,
    shortPlan: short ? `${short.status}/${short.action}` : null,
    fundPlan: fund ? `${fund.status}/${fund.action}` : null,
    firstReviewSessions: fund?.firstReviewSessions ?? expectation.firstRepairSessions ?? null,
    baseAnchorSessions: expectation.baseAnchorSessions ?? null,
    stretchSessions: expectation.stretchSessions ?? null,
    expectedReturnRange: expectation.baseReturnPct ?? null,
    shortExpectedReturnPct: shortExpectation?.expectedReturnPct ?? null,
    fundExpectedReturnPct: fundExpectation?.expectedReturnPct ?? null,
    waitingReasons: dynamicHolding.blockedReasons?.join(',') ?? '',
  }
}

function resolveSignalStatus({ dataState, dynamicHolding, targetMode }) {
  if (dataState === 'stale' || dataState === 'invalid') {
    return {
      status: '需刷新数据',
      reasons: [`data-state-${dataState}`],
    }
  }
  if (!dynamicHolding) {
    return {
      status: '等待',
      reasons: ['dynamic-holding-missing'],
    }
  }
  if (dynamicHolding?.status === '剔除') {
    return {
      status: '剔除',
      reasons: uniqueStrings(['dynamic-holding-excluded', ...(dynamicHolding.blockedReasons ?? [])]),
    }
  }
  if (dynamicHolding?.status === '等待') {
    return {
      status: '等待',
      reasons: uniqueStrings(['dynamic-holding-wait', ...(dynamicHolding.blockedReasons ?? [])]),
    }
  }
  return {
    status: '观察',
    reasons: [
      'profile-thresholds-passed',
      'positive-monotonic-mean-reversion',
      targetMode === 'fixed' ? 'fixed-target-replay-assumption' : 'forward-structural-target-available',
    ],
  }
}

function datasetAtObservation({ dataset, row, visibleRows, adaptiveWindowSpec, historical }) {
  const requiredRows = explicitMinRows ?? adaptiveWindowSpec.minimumRequiredRows
  const freshness = historical
    ? {
        status: 'historical-as-of-observation',
        dataThrough: row.date,
        rows: visibleRows,
        staleDays: 0,
        asOf: row.date,
        basis: 'historical-visible-prefix-as-of-signal-close',
        staleThresholdDays: null,
        futureRowsUsed: false,
      }
    : freshnessRecord(row.date, visibleRows)
  return {
    ...dataset,
    dataThrough: row.date,
    rows: visibleRows,
    staleDays: freshness.staleDays,
    freshness,
    adaptiveWindowSpec,
    rowGate: {
      mode: explicitMinRows === null ? 'adaptive' : 'explicit-scenario',
      source: explicitMinRows === null ? adaptiveWindowSpec.source : 'cli:--min-rows',
      requiredRows,
      explicitMinimumRows: explicitMinRows,
      adaptiveMinimumRows: adaptiveWindowSpec.minimumRequiredRows,
      passed: visibleRows >= requiredRows,
      evaluatedAt: `${row.date}:close`,
      futureRowsUsed: false,
    },
  }
}

function datasetProvenance(entry, rows, sampleContext) {
  const latest = rows.at(-1)
  const nameInfo = resolveInstrumentName(entry, nameMap)
  const freshness = freshnessRecord(latest?.date, rows.length)
  return {
    symbol: entry.symbol,
    market: entry.market,
    source: entry.source ?? 'local csv',
    name: nameInfo.name,
    nameSource: nameInfo.source,
    dataThrough: latest?.date ?? null,
    rows: rows.length,
    staleDays: freshness.staleDays,
    freshness,
    adaptiveWindowSpec: sampleContext.adaptiveWindowSpec,
    rowGate: {
      ...sampleContext.rowGate,
      passed: rows.length >= sampleContext.rowGate.requiredRows,
    },
  }
}

function skipRecord(entry, reason, detail = {}) {
  return {
    symbol: entry.symbol,
    market: entry.market,
    source: entry.source ?? 'local csv',
    reason,
    ...detail,
  }
}

function freshnessRecord(dataThrough, rows) {
  const staleDays = ageInDays(dataThrough)
  return {
    status: !Number.isFinite(staleDays) ? 'invalid-date' : staleDays > 10 ? 'stale' : 'current-enough-for-research',
    dataThrough,
    rows,
    staleDays: Number.isFinite(staleDays) ? staleDays : null,
    basis: 'calendar-days-from-latest-local-row',
    staleThresholdDays: 10,
  }
}

function dataStateRecord(freshness) {
  if (freshness.status === 'invalid-date') {
    return { status: 'invalid', reasons: ['latest-local-row-date-invalid'] }
  }
  if (freshness.status === 'stale') {
    return { status: 'stale', reasons: ['data-stale-over-10-calendar-days'] }
  }
  if (freshness.status === 'historical-as-of-observation') {
    return {
      status: 'provisional',
      reasons: [
        'historical-visible-prefix-only; later-rows-corporate-actions-and-live-execution-state-not-consumed',
      ],
    }
  }
  return {
    status: 'provisional',
    reasons: ['local-daily-ohlcv-path-only; corporate-actions-and-live-execution-state-not-verified'],
  }
}

function summarizeFreshness(rows) {
  if (!rows.length) {
    return {
      status: 'no-local-csv-coverage',
      basis: 'calendar-days-from-latest-local-row',
      staleThresholdDays: 10,
      staleInstruments: 0,
    }
  }
  const dates = rows.map((row) => row.dataThrough).filter(Boolean).sort()
  const staleValues = rows.map((row) => row.staleDays).filter(Number.isFinite)
  const staleInstruments = rows.filter((row) => row.freshness.status !== 'current-enough-for-research').length
  return {
    status: staleInstruments > 0 ? 'contains-stale-or-invalid-data' : 'current-enough-for-research',
    oldestDataThrough: dates[0] ?? null,
    newestDataThrough: dates.at(-1) ?? null,
    maxStaleDays: staleValues.length ? Math.max(...staleValues) : null,
    basis: 'calendar-days-from-latest-local-row',
    staleThresholdDays: 10,
    staleInstruments,
  }
}

function countReasons(rows) {
  const counts = {}
  for (const row of rows) counts[row.reason] = (counts[row.reason] ?? 0) + 1
  return counts
}

function ageInDays(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY
  return Math.floor((Date.now() - date.getTime()) / 86400000)
}

function parseCsv(text) {
  return text.trim().split(/\r?\n/).slice(1).map((line) => {
    const [date, open, high, low, close, volume] = line.split(',')
    return { date, open: +open, high: +high, low: +low, close: +close, volume: +volume }
  }).filter((row) => row.date && [row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

function percentile(values, current) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!valid.length || !Number.isFinite(current)) return null
  return valid.filter((value) => value <= current).length / valid.length * 100
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch (error) { fail(`cannot read ${path}: ${error.message}`) }
}

function defaultNameMapPath() {
  const candidates = [
    'skills/china-stock-selection/references/stock-names.json',
    '.agents/skills/china-stock-selection/references/stock-names.json',
    '.claude/skills/china-stock-selection/references/stock-names.json',
  ]
  return candidates.find((candidate) => existsSync(resolvePath(candidate))) ?? candidates[1]
}

function quantile(sorted, q) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))]
}

function parseArgs(values, supported, booleanFlags) {
  const parsed = {}
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (!value.startsWith('--')) fail(`unexpected positional argument "${value}"`)
    const key = value.slice(2)
    if (!supported.has(key)) fail(`unknown option --${key}`)
    const next = values[i + 1]
    if (!next || next.startsWith('--')) {
      if (!booleanFlags.has(key)) fail(`missing value for --${key}`)
      parsed[key] = true
      continue
    }
    parsed[key] = next
    i += 1
  }
  return parsed
}

function buildProfiles(mode) {
  if (mode === 'strict') return [profileFromArgs('strict', STRICT_DEFAULTS)]
  if (mode === 'swing') return [profileFromArgs('swing', SWING_DEFAULTS)]
  if (mode === 'combo') {
    return [
      profileFromArgs('strict', STRICT_DEFAULTS),
      profileFromArgs('swing', SWING_DEFAULTS),
    ]
  }
  fail(`unknown profile "${mode}", expected strict, swing, or combo`)
}

function profileFromArgs(profileId, defaults) {
  const targetMode = enumArg(args['target-mode'] ?? defaults.targetMode, SUPPORTED_TARGET_MODES, 'target-mode')
  if (targetMode === 'structure' && args['max-hold'] !== undefined) {
    fail('--max-hold is allowed only with explicit --target-mode fixed')
  }
  if (targetMode === 'fixed' && args['max-hold'] === undefined) {
    fail('--target-mode fixed requires explicit --max-hold')
  }
  if (targetMode === 'fixed' && args.target === undefined) {
    fail('--target-mode fixed requires explicit --target')
  }
  const minimumGrossReturn = targetMode === 'structure'
    ? finiteArg(args.target, defaults.minimumGrossReturn, 'target', {
      min: 0,
      max: 1,
      minExclusive: true,
      maxExclusive: true,
    })
    : null
  const fixedTargetReturn = targetMode === 'fixed'
    ? finiteArg(args.target, null, 'target', {
      min: 0,
      max: 1,
      minExclusive: true,
      maxExclusive: true,
    })
    : null
  const profile = {
    name: targetMode === 'fixed' ? `${profileId}-fixed-scenario` : `${profileId}-structure`,
    minimumGrossReturn,
    fixedTargetReturn,
    stopLoss: finiteArg(args.stop, defaults.stopLoss, 'stop', { min: 0, max: 1, minExclusive: true, maxExclusive: true }),
    minZ: finiteArg(args['min-z'], defaults.minZ, 'min-z', { min: 0 }),
    maxCkGeometryPercentile: finiteArg(
      args['ck-geometry-max'] ?? args['lp-max'],
      defaults.maxCkGeometryPercentile,
      args['ck-geometry-max'] === undefined && args['lp-max'] !== undefined ? 'lp-max' : 'ck-geometry-max',
      { min: 0, max: 100 },
    ),
    maxHalfLifeSessions: finiteArg(args['max-hl'], defaults.maxHalfLifeSessions, 'max-hl', {
      min: 0,
      minExclusive: true,
    }),
    minCostSlopePct: finiteArg(args['min-slope'], defaults.minCostSlopePct, 'min-slope'),
    maxCostSlopePct: finiteArg(args['max-slope'], defaults.maxCostSlopePct, 'max-slope'),
    minCostDistancePct: finiteArg(args['min-distance'], defaults.minCostDistancePct, 'min-distance', { min: 0 }),
    maxCostDistancePct: finiteArg(args['max-distance'], defaults.maxCostDistancePct, 'max-distance', { min: 0 }),
    maxEntryGapPct: finiteArg(args['max-entry-gap'], defaults.maxEntryGapPct, 'max-entry-gap'),
    minEntryGapPct: finiteArg(args['min-entry-gap'], defaults.minEntryGapPct, 'min-entry-gap'),
    targetMode,
    fixedHorizonApplied: targetMode === 'fixed',
    fixedHorizonSessions: targetMode === 'fixed'
      ? positiveIntArg(args['max-hold'], null, 'max-hold')
      : null,
    executionAuthority: 'none',
  }
  if (profile.minCostSlopePct > profile.maxCostSlopePct) fail('invalid slope bounds: --min-slope must be <= --max-slope')
  if (profile.minCostDistancePct > profile.maxCostDistancePct) fail('invalid distance bounds: --min-distance must be <= --max-distance')
  if (profile.minEntryGapPct > profile.maxEntryGapPct) fail('invalid entry-gap bounds: --min-entry-gap must be <= --max-entry-gap')
  return profile
}

function formatProfileMix(byProfile = {}) {
  const entries = Object.entries(byProfile)
  if (!entries.length) return 'none'
  return entries.map(([profile, stats]) => `${profile} ${stats.trades} (avg ${stats.avgNetPct}%, median ${stats.medianNetPct}%)`).join(' | ')
}

function formatSignalProfileMix(byProfile = {}) {
  const entries = Object.entries(byProfile)
  if (!entries.length) return 'none'
  return entries.map(([profile, count]) => `${profile} ${count}`).join(' | ')
}

function resolvePath(path) { return resolve(ROOT, String(path)) }
function finiteArg(value, fallback, name, {
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  minExclusive = false,
  maxExclusive = false,
} = {}) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  const belowMin = minExclusive ? parsed <= min : parsed < min
  const aboveMax = maxExclusive ? parsed >= max : parsed > max
  if (!Number.isFinite(parsed) || belowMin || aboveMax) {
    const lower = Number.isFinite(min) ? `${minExclusive ? '(' : '['}${min}` : '(-inf'
    const upper = Number.isFinite(max) ? `${max}${maxExclusive ? ')' : ']'}` : 'inf)'
    fail(`invalid --${name} value "${value}", expected a finite number in ${lower}, ${upper}`)
  }
  return parsed
}

function positiveIntArg(value, fallback, name) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) fail(`invalid --${name} value "${value}", expected a positive integer`)
  return parsed
}

function optionalPositiveIntArg(value, name) {
  return value === undefined ? null : positiveIntArg(value, null, name)
}

function parseMarkets(value) {
  const parsed = [...new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean))]
  if (!parsed.length) fail('market must contain A股 or 港股')
  const invalid = parsed.filter((market) => !SUPPORTED_MARKETS.has(market))
  if (invalid.length) fail(`unknown market "${invalid.join(',')}", expected A股, 港股, or A股,港股`)
  return parsed
}

function enumArg(value, supported, name) {
  const normalized = String(value)
  if (!supported.has(normalized)) fail(`unknown ${name} "${normalized}", expected ${[...supported].join(' or ')}`)
  return normalized
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))]
}

function freshnessText(value) {
  if (value.status === 'no-local-csv-coverage') return value.status
  return `${value.status}, ${value.oldestDataThrough}..${value.newestDataThrough}, maxAge=${value.maxStaleDays ?? '?'}d`
}

function reasonSummary(reasons) {
  const entries = Object.entries(reasons)
  return entries.length ? entries.map(([reason, count]) => `${reason}=${count}`).join(', ') : 'none'
}

function pct(value) { return `${round(value * 100, 2)}%` }
function nullablePct(value) { return Number.isFinite(value) ? `${value}%` : '-' }
function round(value, digits = 2) { const factor = 10 ** digits; return Math.round(value * factor) / factor }
function nullableRound(value, digits = 2) { return Number.isFinite(value) ? round(value, digits) : null }
function fail(message) { console.error(message); process.exit(1) }
