#!/usr/bin/env node

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
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
const EVIDENCE_SCHEMA_VERSION = 'china-stock-selection.evidence.v1'
const SUPPORTED_VALIDATION_MODES = new Set(['none', 'walk-forward'])
const SUPPORTED_HOLDING_GATES = new Set(['enforce', 'diagnostic'])

const PRICE_LIMIT_BOARDS = Object.freeze([
  { pattern: /^(30|68)/, limitPct: 20, board: '创业板/科创板' },
  { pattern: /^(43|83|87|88)/, limitPct: 30, board: '北交所' },
  { pattern: /^\d{6}$/, limitPct: 10, board: '主板' },
])
const SUSPENSION_CALENDAR_GAP_DAYS = 15
const PRICE_LIMIT_EPSILON = 0.001

const PRICE_LIMIT_DISCLOSURE = Object.freeze({
  rule: 'A-share board prefix: 30/68 -> 20%, 43/83/87/88 -> 30%, other six-digit codes -> 10%',
  appliedTo: 'entry session open against the previous session close; a blocked entry is treated as untradable at that open',
  limitation: 'ST names and newly listed boards cannot be detected from local OHLCV, and back-adjusted prices make the limit price approximate',
  hongKong: 'no hard daily price limit is modeled for Hong Kong',
})

const SUSPENSION_DISCLOSURE = Object.freeze({
  rule: 'the entry session is suspended when its volume is zero or the calendar gap from the previous row exceeds the threshold',
  gapThresholdDays: SUSPENSION_CALENDAR_GAP_DAYS,
  limitation: 'a suspension inside the holding window is disclosed but not re-simulated, so the modeled exit stays optimistic',
})


const DECAY_HORIZON_LADDER = Object.freeze([1, 2, 3, 5, 10, 20])
const SUPPORTED_SENSITIVITY_MODES = new Set(['off', 'thresholds'])
const SENSITIVITY_SAMPLE_FLOOR = 30
const SENSITIVITY_TRADES_TOLERANCE = 2
const SENSITIVITY_TARGETS = Object.freeze([
  { parameter: 'minZ', flag: '--min-z' },
  { parameter: 'maxCkGeometryPercentile', flag: '--ck-geometry-max' },
  { parameter: 'maxHalfLifeSessions', flag: '--max-hl' },
  { parameter: 'minCostDistancePct', flag: '--min-distance' },
  { parameter: 'maxCostDistancePct', flag: '--max-distance' },
  { parameter: 'minimumGrossReturn', flag: '--target' },
])
const DEFAULT_EVIDENCE_SEED = 20260101
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
  statistics: 'sample-estimate',
  benchmarks: 'sample-estimate',
  walkForward: 'sample-estimate',
  survivorshipBias: 'missing-input',
  reproducibility: 'exact-identity',
  hypothesis: 'exact-identity',
  execution: 'missing-input',
})
const SUPPORTED_FLAGS = new Set([
  'profile', 'mode', 'market', 'fee', 'min-rows', 'format',
  'index', 'data-dir', 'name-map', 'target', 'stop', 'min-z',
  'ck-geometry-max', 'lp-max', 'max-hl', 'min-slope', 'max-slope',
  'min-distance', 'max-distance', 'max-entry-gap', 'min-entry-gap',
  'max-hold', 'target-mode',
  'validate', 'train-sessions', 'test-sessions', 'step-sessions', 'min-folds',
  'holding-gate',
  'hypothesis', 'run-log', 'seed', 'bootstrap-samples', 'random-entry-samples',
  'slippage-bps', 'slippage-atr-fraction', 'volume-cap', 'order-notional',
  'min-avg-volume', 'min-avg-turnover',
  'sensitivity', 'sensitivity-factors', 'decay-horizons',
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
const holdingGate = enumArg(args['holding-gate'] ?? 'diagnostic', SUPPORTED_HOLDING_GATES, 'holding-gate')
const executionOptions = resolveExecutionOptions()
const researchOptions = resolveResearchOptions()
const evidenceConfig = resolveEvidenceOptions()
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
  holdingGate,
  execution: executionOptions,
  research: researchOptions,
  holdingGatePolicy: holdingGate === 'enforce'
    ? 'phase-gate-discards-signals-the-domain-holding-plan-does-not-mark-execute'
    : 'phase-gate-is-diagnostic-only; a blocked holding verdict is recorded on the row and never discards the candidate',
  profiles,
  evidence: evidenceConfig,
}
const researchBoundary = {
  status: config.mode === 'replay' ? 'historical-replay-only' : 'latest-observation-only',
  executionStatus: config.mode === 'replay' ? 'simulation-only' : 'blocked',
  executionAuthority: 'none',
  reasons: config.mode === 'replay'
    ? ['historical-daily-ohlcv-fill-model', 'not-live-tradability-or-future-expectancy']
    : ['no-return-or-fill-simulation', 'account-risk-budget-and-live-execution-inputs-unavailable'],
}

// ── P0 evidence gates ────────────────────────────────────────────────
// Survivorship disclosure, reproducibility hashes, sample statistics,
// same-universe benchmarks, and opt-in walk-forward splits. Every block below
// is a sample estimate or an explicit missing input: none of it is a forecast,
// and none of it can promote output to an executable order.

const SURVIVORSHIP_BIAS_DISCLOSURE = Object.freeze({
  warning: 'universe-is-current-membership-only',
  pointInTimeMembershipAvailable: false,
  biasDirection: 'upward',
  detail: 'the universe is the current local index, so delisted, merged, suspended and renamed instruments are absent from every historical window',
  affects: ['statistics', 'benchmarks', 'walkForward'],
  mitigation: [
    'compare the rule against the same-universe buy-and-hold and random-entry benchmarks',
    'prefer recent windows over the full available history',
    'treat absolute return levels as an upper bound rather than an estimate',
  ],
  claimClass: 'missing-input',
})

function resolveEvidenceOptions() {
  const validationMode = enumArg(args.validate ?? 'none', SUPPORTED_VALIDATION_MODES, 'validate')
  const hypothesisPath = args.hypothesis === undefined ? null : String(args.hypothesis)
  const runLogPath = args['run-log'] === undefined ? null : String(args['run-log'])
  if (validationMode === 'walk-forward' && mode !== 'replay') {
    fail('--validate walk-forward requires --mode replay; latest observation mode simulates no return')
  }
  return {
    seed: integerArg(args.seed, DEFAULT_EVIDENCE_SEED, 'seed'),
    bootstrapSamples: positiveIntArg(args['bootstrap-samples'], 2000, 'bootstrap-samples'),
    randomEntrySamples: positiveIntArg(args['random-entry-samples'], 200, 'random-entry-samples'),
    hypothesisPath,
    hypothesisDeclaration: hypothesisPath === null ? null : readJson(resolvePath(hypothesisPath)),
    runLogPath,
    validation: {
      mode: validationMode,
      trainSessions: positiveIntArg(args['train-sessions'], 400, 'train-sessions'),
      testSessions: positiveIntArg(args['test-sessions'], 60, 'test-sessions'),
      stepSessions: positiveIntArg(args['step-sessions'], 60, 'step-sessions'),
      minFolds: positiveIntArg(args['min-folds'], 3, 'min-folds'),
    },
  }
}

function buildEvidence({ trades, universeSessions, sessionCalendar, options }) {
  const reproducibility = buildReproducibility(options)
  const hypothesis = buildHypothesis(options, reproducibility)
  const base = {
    survivorshipBias: SURVIVORSHIP_BIAS_DISCLOSURE,
    reproducibility,
    hypothesis,
  }
  if (config.mode !== 'replay') {
    return {
      ...base,
      evidenceMode: 'latest-observation-only',
      evidenceModeReason: 'latest observation simulates no return, so statistics, benchmarks, walk-forward, equity and decay stay null rather than zero',
      statistics: null,
      benchmarks: null,
      walkForward: null,
      equityCurve: null,
      riskMetrics: null,
      signalDecay: null,
      signalDecayHorizonSource: null,
      signalDecaySemantics: null,
      sensitivity: null,
    }
  }
  const statistics = {
    ...computeReturnStatistics(trades, options),
    byDynamicPhase: groupedReturnBreakdown(trades, (row) => row.dynamicPhase),
    byHoldingGateVerdict: groupedReturnBreakdown(trades, (row) => row.holdingGateVerdict),
  }
  const research = computeResearchOutputs({
    trades,
    universeSessions,
    statistics,
    options: researchOptions,
  })
  return {
    ...base,
    evidenceMode: 'historical-replay',
    evidenceModeReason: null,
    statistics,
    equityCurve: research.equityCurve,
    riskMetrics: research.riskMetrics,
    signalDecay: research.signalDecay,
    signalDecayHorizonSource: research.signalDecayHorizonSource,
    signalDecaySemantics: research.signalDecaySemantics,
    sensitivity: researchOptions.sensitivityMode === 'thresholds'
      ? runSensitivity({ statistics, options: researchOptions })
      : disabledSensitivity(researchOptions),
    benchmarks: computeBenchmarks({ trades, statistics, universeSessions, options }),
    walkForward: options.validation.mode === 'walk-forward'
      ? computeWalkForward({ trades, sessionCalendar, validation: options.validation, options })
      : disabledWalkForward(options.validation),
  }
}

function buildReproducibility(options) {
  const configHash = hashOf({
    schemaVersion: SCHEMA_VERSION,
    evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
    profile: profileMode,
    mode,
    markets: marketValues,
    feeRate: requestedFeeRate,
    holdingGate,
    rowGate: config.rowGate,
    profiles,
    targetTiming: config.targetTiming,
    targetContextPolicy: config.targetContextPolicy,
    horizonPolicy: config.horizonPolicy,
    intrabarPolicy: config.intrabarPolicy,
    seed: options.seed,
    bootstrapSamples: options.bootstrapSamples,
    randomEntrySamples: options.randomEntrySamples,
    validation: options.validation,
  })
  const dataManifest = coverage.map((item) => [item.symbol, item.market, item.rows, item.dataThrough, item.source])
  return {
    configHash: `sha256:${configHash}`,
    dataHash: `sha256:${hashOf(dataManifest)}`,
    dataHashScope: 'coverage-manifest(symbol,market,rows,dataThrough,source)',
    nodeVersion: process.version,
    platform: process.platform,
    gitCommit: readGitCommit(),
    seed: options.seed,
    bootstrapSamples: options.bootstrapSamples,
    randomEntrySamples: options.randomEntrySamples,
    claimClass: 'exact-identity',
  }
}

function hashOf(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function readGitCommit() {
  try {
    const head = readFileSync(join(ROOT, '.git', 'HEAD'), 'utf8').trim()
    if (!head.startsWith('ref: ')) return head || null
    const ref = head.slice(5).trim()
    const refPath = join(ROOT, '.git', ...ref.split('/'))
    if (existsSync(refPath)) return readFileSync(refPath, 'utf8').trim() || null
    const packedPath = join(ROOT, '.git', 'packed-refs')
    if (!existsSync(packedPath)) return null
    const line = readFileSync(packedPath, 'utf8').split('\n').find((item) => item.endsWith(` ${ref}`))
    return line ? line.split(' ')[0] : null
  } catch {
    return null
  }
}

function computeReturnStatistics(rows, options) {
  const returns = rows.map((row) => row.netReturnPct / 100).filter(Number.isFinite).sort((a, b) => a - b)
  const n = returns.length
  const base = {
    metric: 'netReturnPct',
    scope: 'accepted replay trades',
    n,
    meanPct: null,
    medianPct: null,
    stdPct: null,
    tStat: null,
    pValue: null,
    testModel: null,
    bootstrapCI95Pct: null,
    bootstrapSamples: options.bootstrapSamples,
    seed: options.seed,
    sampleWarning: null,
    claimClass: 'sample-estimate',
    semantics: 'in-sample net-return sample statistics under the declared fill and fee assumptions; not expected future return and not an execution signal',
  }
  if (n === 0) {
    return { ...base, sampleWarning: 'no-sample: these thresholds produced no trade on this history' }
  }
  const mean = returns.reduce((sum, item) => sum + item, 0) / n
  const std = n > 1 ? Math.sqrt(returns.reduce((sum, item) => sum + (item - mean) ** 2, 0) / (n - 1)) : null
  const tStat = Number.isFinite(std) && std > 0 ? mean / (std / Math.sqrt(n)) : null
  const warnings = []
  if (n < 30) warnings.push('insufficient-sample: n<30, results are not statistically meaningful')
  if (Number.isFinite(std) && std === 0) warnings.push('no-dispersion: every trade returned the same net value')
  return {
    ...base,
    meanPct: round(mean * 100, 4),
    medianPct: round(quantile(returns, 0.5) * 100, 4),
    stdPct: Number.isFinite(std) ? round(std * 100, 4) : null,
    tStat: nullableRound(tStat, 4),
    pValue: nullableRound(Number.isFinite(tStat) ? 2 * (1 - normalCdf(Math.abs(tStat))) : null, 6),
    testModel: 'two-sided normal reference on the sample t statistic; a large-sample approximation, not an exact finite-sample test',
    bootstrapCI95Pct: bootstrapMeanCI(returns, options.bootstrapSamples, options.seed),
    sampleWarning: warnings.length ? warnings.join('; ') : null,
  }
}

function bootstrapMeanCI(returns, samples, seed) {
  if (!returns.length || !Number.isFinite(samples) || samples <= 0) return null
  const random = mulberry32(seed)
  const means = []
  for (let sample = 0; sample < samples; sample += 1) {
    let sum = 0
    for (let index = 0; index < returns.length; index += 1) {
      sum += returns[Math.floor(random() * returns.length)]
    }
    means.push(sum / returns.length)
  }
  means.sort((a, b) => a - b)
  return {
    lowPct: round(quantile(means, 0.025) * 100, 4),
    highPct: round(quantile(means, 0.975) * 100, 4),
    method: 'seeded percentile bootstrap of the sample mean',
    samples,
    seed,
  }
}

function mulberry32(seed) {
  let state = (Number.isFinite(seed) ? Math.floor(seed) : 0) >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const density = 0.3989422804014337 * Math.exp((-x * x) / 2)
  const tail = density * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x >= 0 ? 1 - tail : tail
}

function computeBenchmarks({ trades, statistics, universeSessions, options }) {
  const buyAndHold = computeBuyAndHoldSameHorizon(trades)
  const horizon = medianAppliedHorizonSessions(trades)
  const randomEntry = horizon === null
    ? { status: 'not-computable: no accepted trade defines a comparable holding horizon', n: 0, avgReturnPct: null, winRatePct: null }
    : computeRandomEntrySameUniverse({ universeSessions, horizon, samples: options.randomEntrySamples, seed: options.seed })
  return {
    feeModel: 'netReturn=grossReturn-feeRate-once; identical to the replay fee treatment',
    buyAndHoldSameHorizon: buyAndHold,
    randomEntrySameUniverse: randomEntry,
    excessReturnPctVsBuyAndHold: excessOf(statistics.meanPct, buyAndHold.avgReturnPct),
    excessReturnPctVsRandomEntry: excessOf(statistics.meanPct, randomEntry.avgReturnPct),
    claimClass: 'sample-estimate',
    semantics: 'same-universe historical comparisons under the declared fill and fee assumptions; they locate the rule inside its own null distribution, they do not prove an edge',
  }
}

function excessOf(strategyPct, benchmarkPct) {
  return Number.isFinite(strategyPct) && Number.isFinite(benchmarkPct) ? round(strategyPct - benchmarkPct, 4) : null
}

function computeBuyAndHoldSameHorizon(trades) {
  const usable = trades.filter((trade) => Number.isFinite(trade.entryPrice) && Number.isFinite(trade.exitClose))
  if (!usable.length) {
    return { status: 'not-computable: no accepted trade carries a matched entry price and exit close', n: 0, avgReturnPct: null, winRatePct: null }
  }
  const returns = usable.map((trade) => trade.exitClose / trade.entryPrice - 1 - config.feeRate)
  return {
    scope: 'buy at the accepted entry session open and hold to the accepted exit session close',
    n: usable.length,
    avgReturnPct: round((returns.reduce((sum, item) => sum + item, 0) / returns.length) * 100, 4),
    winRatePct: round((returns.filter((item) => item > 0).length / returns.length) * 100, 2),
    claimClass: 'sample-estimate',
  }
}

function medianAppliedHorizonSessions(trades) {
  const values = trades.map((trade) => trade.appliedHorizonSessions).filter(Number.isFinite).sort((a, b) => a - b)
  return values.length ? quantile(values, 0.5) : null
}

function computeRandomEntrySameUniverse({ universeSessions, horizon, samples, seed }) {
  const random = mulberry32(seed)
  const returns = []
  let instrumentsUsed = 0
  for (const instrument of universeSessions) {
    const opens = instrument.opens ?? []
    const closes = instrument.closes ?? []
    const lastEntry = opens.length - 1 - horizon
    if (lastEntry < 1) continue
    instrumentsUsed += 1
    for (let draw = 0; draw < samples; draw += 1) {
      const index = 1 + Math.floor(random() * lastEntry)
      const entryPrice = opens[index]
      const exitPrice = closes[index + horizon]
      if (!(entryPrice > 0) || !(exitPrice > 0)) continue
      returns.push(exitPrice / entryPrice - 1 - config.feeRate)
    }
  }
  if (!returns.length) {
    return { status: 'not-computable: no instrument carries a full random-entry window at this horizon', n: 0, avgReturnPct: null, winRatePct: null }
  }
  return {
    scope: 'seeded uniform random entry session per instrument, held for the median accepted applied horizon',
    horizonSessions: horizon,
    instruments: instrumentsUsed,
    n: returns.length,
    avgReturnPct: round((returns.reduce((sum, item) => sum + item, 0) / returns.length) * 100, 4),
    winRatePct: round((returns.filter((item) => item > 0).length / returns.length) * 100, 2),
    seed,
    samplesPerInstrument: samples,
    claimClass: 'sample-estimate',
  }
}

function disabledWalkForward(validation) {
  return {
    enabled: false,
    mode: validation.mode,
    declaration: validationDeclaration(validation),
    folds: [],
    aggregate: null,
    degradationPct: null,
    outOfSampleStatistics: null,
    warnings: [],
    note: 'walk-forward is opt-in: pass --validate walk-forward to cut the shared session calendar into train and test folds',
    claimClass: 'sample-estimate',
  }
}

function validationDeclaration(validation) {
  return {
    trainSessions: validation.trainSessions,
    testSessions: validation.testSessions,
    stepSessions: validation.stepSessions,
    minFolds: validation.minFolds,
    rule: 'thresholds are held fixed across folds; the split measures stability, it does not refit them',
  }
}

function computeWalkForward({ trades, sessionCalendar, validation, options }) {
  const warnings = []
  const position = new Map(sessionCalendar.map((date, index) => [date, index]))
  const total = sessionCalendar.length
  const folds = []
  const foldReturns = []
  for (let start = 0; start + validation.trainSessions + validation.testSessions <= total; start += validation.stepSessions) {
    const trainEnd = start + validation.trainSessions
    const testEnd = trainEnd + validation.testSessions
    const inSampleReturns = returnsWithin(trades, position, start, trainEnd)
    const outOfSampleReturns = returnsWithin(trades, position, trainEnd, testEnd)
    foldReturns.push({ inSample: inSampleReturns, outOfSample: outOfSampleReturns })
    folds.push({
      fold: folds.length + 1,
      trainStart: sessionCalendar[start],
      trainEnd: sessionCalendar[trainEnd - 1],
      testStart: sessionCalendar[trainEnd],
      testEnd: sessionCalendar[testEnd - 1],
      trainSessions: validation.trainSessions,
      testSessions: validation.testSessions,
      inSampleTrades: inSampleReturns.length,
      outOfSampleTrades: outOfSampleReturns.length,
      inSampleAvgPct: averagePct(inSampleReturns),
      outOfSampleAvgPct: averagePct(outOfSampleReturns),
      outOfSampleWinRatePct: winRatePctOf(outOfSampleReturns),
    })
    if (folds.length >= 200) break
  }
  if (!folds.length) {
    warnings.push(`insufficient-history: ${total} shared sessions cannot hold one ${validation.trainSessions}+${validation.testSessions} session window`)
  }
  if (folds.length && folds.length < validation.minFolds) {
    warnings.push(`requested-min-folds-not-met: produced ${folds.length} of ${validation.minFolds} folds`)
  }
  const withOutOfSample = folds.filter((fold) => fold.outOfSampleTrades > 0)
  if (folds.length && !withOutOfSample.length) {
    warnings.push('no-out-of-sample-trades: every fold is empty under these thresholds, so this history cannot validate the rule')
  } else if (withOutOfSample.length < folds.length) {
    warnings.push(`empty-out-of-sample-folds: ${folds.length - withOutOfSample.length} of ${folds.length} folds produced no out-of-sample trade`)
  }
  const inSampleReturns = foldReturns.flatMap((item) => item.inSample)
  const outOfSampleReturns = foldReturns.flatMap((item) => item.outOfSample)
  const aggregate = {
    folds: folds.length,
    requestedMinFolds: validation.minFolds,
    minFoldsSatisfied: folds.length >= validation.minFolds,
    sharedCalendarSessions: total,
    calendarStart: sessionCalendar[0] ?? null,
    calendarEnd: sessionCalendar.at(-1) ?? null,
    inSampleTrades: inSampleReturns.length,
    outOfSampleTrades: outOfSampleReturns.length,
    inSampleAvgPct: averagePct(inSampleReturns),
    outOfSampleAvgPct: averagePct(outOfSampleReturns),
    outOfSampleStdPct: stdPctOf(outOfSampleReturns),
    outOfSampleWinRatePct: winRatePctOf(outOfSampleReturns),
    foldsWithOutOfSampleTrades: withOutOfSample.length,
    positiveOutOfSampleFolds: withOutOfSample.filter((fold) => fold.outOfSampleAvgPct > 0).length,
    consistency: withOutOfSample.length
      ? round(withOutOfSample.filter((fold) => fold.outOfSampleAvgPct > 0).length / withOutOfSample.length, 4)
      : null,
  }
  return {
    enabled: true,
    mode: validation.mode,
    declaration: validationDeclaration(validation),
    folds,
    aggregate,
    degradationPct: excessOf(aggregate.outOfSampleAvgPct, aggregate.inSampleAvgPct),
    outOfSampleStatistics: computeReturnStatistics(
      outOfSampleReturns.map((value) => ({ netReturnPct: value * 100 })),
      options,
    ),
    warnings,
    note: 'folds hold the supplied thresholds fixed; a fold is out-of-sample with respect to the time split only, not with respect to how the thresholds were chosen',
    claimClass: 'sample-estimate',
  }
}

function returnsWithin(trades, position, start, end) {
  const out = []
  for (const trade of trades) {
    const index = position.get(trade.signalDate)
    if (!Number.isFinite(index) || index < start || index >= end) continue
    const value = trade.netReturnPct / 100
    if (Number.isFinite(value)) out.push(value)
  }
  return out
}

function averagePct(returns) {
  return returns.length ? round((returns.reduce((sum, item) => sum + item, 0) / returns.length) * 100, 4) : null
}

function stdPctOf(returns) {
  if (returns.length < 2) return null
  const mean = returns.reduce((sum, item) => sum + item, 0) / returns.length
  const variance = returns.reduce((sum, item) => sum + (item - mean) ** 2, 0) / (returns.length - 1)
  return round(Math.sqrt(variance) * 100, 4)
}

function winRatePctOf(returns) {
  return returns.length ? round((returns.filter((item) => item > 0).length / returns.length) * 100, 2) : null
}

function buildHypothesis(options, reproducibility) {
  if (!options.hypothesisPath) {
    return {
      provided: false,
      source: null,
      declaration: null,
      configHash: reproducibility.configHash,
      configHashMatches: null,
      mismatches: [],
      multipleComparisonsWarning: null,
      note: 'no pre-registered hypothesis was supplied, so every threshold in this run is exploratory and may have been chosen after looking at the same history',
      claimClass: 'exact-identity',
    }
  }
  const declaration = options.hypothesisDeclaration ?? readJson(resolvePath(options.hypothesisPath))
  const declaredHash = typeof declaration?.configHash === 'string' && declaration.configHash.length ? declaration.configHash : null
  const configHashMatches = declaredHash === null ? null : declaredHash === reproducibility.configHash
  const mismatches = []
  if (configHashMatches === false) mismatches.push('declaration.configHash does not match this run configuration')
  if (typeof declaration?.rule !== 'string' || !declaration.rule.trim()) mismatches.push('declaration.rule is missing')
  if (typeof declaration?.prediction !== 'string' || !declaration.prediction.trim()) mismatches.push('declaration.prediction is missing')
  return {
    provided: true,
    source: options.hypothesisPath,
    declaration,
    configHash: reproducibility.configHash,
    configHashMatches,
    mismatches,
    multipleComparisonsWarning: resolveMultipleComparisons(options, reproducibility),
    note: 'the declaration is echoed, not enforced: this runtime cannot prove which thresholds were tried before this run',
    claimClass: 'exact-identity',
  }
}

function resolveMultipleComparisons(options, reproducibility) {
  if (!options.runLogPath) return null
  const path = resolvePath(options.runLogPath)
  const previous = []
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try { previous.push(JSON.parse(trimmed)) } catch (error) { void error }
    }
  }
  const otherConfigs = new Set(
    previous
      .filter((entry) => entry && entry.dataHash === reproducibility.dataHash)
      .map((entry) => entry.configHash)
      .filter((hash) => typeof hash === 'string' && hash !== reproducibility.configHash),
  )
  try {
    appendFileSync(path, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      configHash: reproducibility.configHash,
      dataHash: reproducibility.dataHash,
      hypothesis: options.hypothesisPath,
    })}\n`, 'utf8')
  } catch (error) {
    return `run-log-not-writable: ${error.message}`
  }
  if (!otherConfigs.size) return null
  return `multiple-comparisons: ${otherConfigs.size} other configuration(s) were already logged against the same dataset hash; repeated threshold search on one history inflates the apparent edge`
}

function printEvidenceMarkdown(evidence) {
  if (!evidence) return
  console.log(``)
  console.log(`Evidence gates (P0):`)
  console.log(`- Survivorship: ${evidence.survivorshipBias.warning}; point-in-time membership ${evidence.survivorshipBias.pointInTimeMembershipAvailable}; bias direction ${evidence.survivorshipBias.biasDirection}`)
  if (config.mode === 'replay') {
    const overridden = (evidence.statistics?.byHoldingGateVerdict ?? []).filter((item) => item.key !== 'execute')
    const overriddenTrades = overridden.reduce((sum, item) => sum + item.n, 0)
    console.log(`- Holding gate: policy ${config.holdingGate} | overridden trades n=${overriddenTrades}${overridden.length ? ` (${overridden.map((item) => `${item.key}:${item.n}`).join(', ')})` : ''}`)
    console.log(`- Execution reality: signals ${executionAudit.signals} | accepted ${executionAudit.accepted} | blocked liquidity ${executionAudit['insufficient-liquidity']} / suspension ${executionAudit['suspended-entry-session']} / limit-up ${executionAudit['entry-at-price-limit-up']} / volume-cap ${executionAudit['order-exceeds-volume-cap']} | entry-gate ${executionAudit['entry-gate-rejected']} | slippage ${config.execution.slippageModel}`)
  }
  if (evidence.statistics) {
    const statistics = evidence.statistics
    const interval = statistics.bootstrapCI95Pct
      ? `${statistics.bootstrapCI95Pct.lowPct}%..${statistics.bootstrapCI95Pct.highPct}%`
      : '-'
    console.log(`- Statistics: n=${statistics.n} mean ${statistics.meanPct ?? '-'}% median ${statistics.medianPct ?? '-'}% std ${statistics.stdPct ?? '-'}% t ${statistics.tStat ?? '-'} p ${statistics.pValue ?? '-'} bootstrap95 ${interval}`)
    if (statistics.sampleWarning) console.log(`  [WARN] ${statistics.sampleWarning}`)
  } else {
    console.log(`- Statistics: not computed in this mode (${evidence.evidenceMode})`)
  }
  if (evidence.benchmarks) {
    const benchmarks = evidence.benchmarks
    console.log(`- Benchmark buy-and-hold same horizon: n=${benchmarks.buyAndHoldSameHorizon.n} avg ${benchmarks.buyAndHoldSameHorizon.avgReturnPct ?? '-'}% win ${benchmarks.buyAndHoldSameHorizon.winRatePct ?? '-'}%`)
    console.log(`- Benchmark random entry same universe: n=${benchmarks.randomEntrySameUniverse.n} avg ${benchmarks.randomEntrySameUniverse.avgReturnPct ?? '-'}% win ${benchmarks.randomEntrySameUniverse.winRatePct ?? '-'}%`)
    console.log(`- Excess vs buy-and-hold ${benchmarks.excessReturnPctVsBuyAndHold ?? '-'}% | excess vs random entry ${benchmarks.excessReturnPctVsRandomEntry ?? '-'}%`)
  }
  if (evidence.walkForward?.enabled) {
    const walkForward = evidence.walkForward
    console.log(`- Walk-forward: folds ${walkForward.aggregate.folds} | OOS trades ${walkForward.aggregate.outOfSampleTrades} | OOS avg ${walkForward.aggregate.outOfSampleAvgPct ?? '-'}% | consistency ${walkForward.aggregate.consistency ?? '-'} | degradation ${walkForward.degradationPct ?? '-'}%`)
    for (const warning of walkForward.warnings) console.log(`  [WARN] ${warning}`)
  }
  if (evidence.hypothesis?.provided) {
    console.log(`- Hypothesis: ${evidence.hypothesis.source} | configHash match ${evidence.hypothesis.configHashMatches}`)
    for (const mismatch of evidence.hypothesis.mismatches) console.log(`  [WARN] ${mismatch}`)
  } else {
    console.log(`- Hypothesis: none pre-registered (exploratory run)`)
  }
  if (evidence.riskMetrics) {
    console.log(`- Risk (simulation-only, trade sequence): points ${evidence.riskMetrics.points} | total ${evidence.riskMetrics.totalReturnPct ?? '-'}% | max drawdown ${evidence.riskMetrics.maxDrawdownPct ?? '-'}% | per-trade Sharpe ${evidence.riskMetrics.perTradeSharpe ?? '-'} | annualized Sharpe ${evidence.riskMetrics.annualizedSharpe ?? '-'} | Calmar ${evidence.riskMetrics.calmar ?? '-'} | profit factor ${evidence.riskMetrics.profitFactor ?? '-'} | avg hold ${evidence.riskMetrics.avgHoldSessions ?? '-'} sessions`)
    if (evidence.riskMetrics.sampleWarning) console.log(`  [WARN] ${evidence.riskMetrics.sampleWarning}`)
  }
  if (evidence.signalDecay?.length) {
    console.log(`- Signal decay (forward net return after entry, ${evidence.signalDecayHorizonSource}): ${evidence.signalDecay.map((bucket) => `${bucket.sessions}s ${bucket.avgNetPct ?? '-'}% (n=${bucket.n})`).join(' | ')}`)
  }
  if (evidence.sensitivity?.enabled) {
    console.log(`- Sensitivity: stabilityScore ${evidence.sensitivity.stabilityScore ?? '-'} over ${evidence.sensitivity.variants.length} variant(s)`)
    for (const warning of evidence.sensitivity.warnings) console.log(`  [WARN] ${warning}`)
  }
  if (evidence.hypothesis?.multipleComparisonsWarning) console.log(`  [WARN] ${evidence.hypothesis.multipleComparisonsWarning}`)
  console.log(`- Reproducibility: configHash ${evidence.reproducibility.configHash} dataHash ${evidence.reproducibility.dataHash} node ${evidence.reproducibility.nodeVersion} commit ${evidence.reproducibility.gitCommit ?? '-'}`)
}

const index = readJson(resolvePath(indexInput))
if (!Array.isArray(index)) fail(`stock index must be an array: ${indexInput}`)
const dataDir = resolvePath(dataDirInput)
const rowsOut = []
const skipped = []
const coverage = []
const universeSessions = []
const sessionCalendar = new Set()
const executionAudit = createExecutionAudit()
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
  if (config.mode === 'replay') {
    universeSessions.push({
      symbol: entry.symbol,
      market: entry.market,
      opens: rows.map((row) => row.open),
      closes: rows.map((row) => row.close),
    })
    for (const row of rows) sessionCalendar.add(row.date)
  }
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
const evidence = buildEvidence({
  trades: rowsOut,
  universeSessions,
  sessionCalendar: [...sessionCalendar].sort(),
  options: evidenceConfig,
})
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
    evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
    evidenceMode: evidence.evidenceMode,
    executionAudit,
    survivorshipBias: evidence.survivorshipBias,
    reproducibility: evidence.reproducibility,
    hypothesis: evidence.hypothesis,
    statistics: evidence.statistics,
    benchmarks: evidence.benchmarks,
    walkForward: evidence.walkForward,
    equityCurve: evidence.equityCurve,
    riskMetrics: evidence.riskMetrics,
    signalDecay: evidence.signalDecay,
    signalDecayHorizonSource: evidence.signalDecayHorizonSource,
    signalDecaySemantics: evidence.signalDecaySemantics,
    sensitivity: evidence.sensitivity,
    summary,
    [key]: rowsOut,
    skipped,
  }, null, 2))
} else if (config.mode === 'latest') {
  printLatestMarkdown({ config, summary, signals: rowsOut, evidence })
} else {
  printMarkdown({ config, summary, trades: rowsOut, evidence })
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
    const execution = evaluateExecutionReality({
      instrument: entry,
      rows,
      signalIndex: i,
      marketPath,
      adaptiveWindowSpec,
      executionOptions,
    })
    executionAudit.signals += 1
    if (execution.blocked) {
      executionAudit[execution.blocked] = (executionAudit[execution.blocked] ?? 0) + 1
      continue
    }
    const trade = simulateTrade(rows, i, profileConfig, signal, entry.market, execution)
    if (!trade) {
      executionAudit['entry-gate-rejected'] += 1
      continue
    }
    executionAudit.accepted += 1
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

function simulateTrade(rows, signalIndex, profile, signalPlan, market, execution) {
  const entryIndex = signalIndex + 1
  const signal = rows[signalIndex]
  const entry = rows[entryIndex]
  const entryGap = entry.open / signal.close - 1
  if (entryGap > profile.maxEntryGapPct / 100 || entryGap < profile.minEntryGapPct / 100) return null

  const entryPrice = entry.open
  const entryTarget = recomputeTargetAtEntry({ rows, signalIndex, entry, profile, signalPlan })
  if (!entryTarget?.eligible) return null
  const targetPrice = entryTarget.targetPrice
  const entryFillPrice = entryPrice * (1 + (execution?.rate ?? 0))
  if (targetPrice <= entryFillPrice) return null
  const stopPrice = entryFillPrice * (1 - profile.stopLoss)
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
      entryIndex,
      exitIndex: i,
      rows,
      execution,
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
      entryIndex,
      exitIndex: i,
      rows,
      execution,
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
    entryIndex,
    exitIndex: lastExitIndex,
    rows,
    execution,
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

function holdingWindowZeroVolumeSessions(rows, entryIndex, exitIndex) {
  let count = 0
  for (let i = entryIndex; i <= exitIndex; i += 1) {
    if (!(rows[i]?.volume > 0)) count += 1
  }
  return count
}

function exitParticipationExceedsCap(rows, exitIndex, exitFillPrice, execution) {
  if (!execution || execution.orderNotional === null || execution.orderNotional === undefined) return null
  const row = rows[exitIndex]
  if (!row || !(row.volume > 0) || !(exitFillPrice > 0)) return null
  return execution.orderNotional / (exitFillPrice * row.volume) > execution.volumeCap
}

function exitSessionAtLimitDown(rows, exitIndex, execution) {
  const limitRule = execution?.limitRule
  const previousRow = rows[exitIndex - 1]
  const exitRow = rows[exitIndex]
  if (!limitRule || !previousRow || !exitRow || !(previousRow.close > 0)) return null
  const limitDownPrice = previousRow.close * (1 - limitRule.limitPct / 100)
  return exitRow.close <= limitDownPrice * (1 + PRICE_LIMIT_EPSILON)
}

function tradeResult({
  entry,
  exit,
  entryIndex,
  exitIndex,
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
  rows = [],
  execution = null,
}) {
  const slippageRate = execution?.rate ?? 0
  const entryFillPrice = entryPrice * (1 + slippageRate)
  const exitFillPrice = exitPrice * (1 - slippageRate)
  const grossReturn = exitFillPrice / entryFillPrice - 1
  const netReturn = grossReturn - config.feeRate
  const actualTargetGrossReturn = targetPrice / entryFillPrice - 1
  return {
    entryDate: entry.date,
    exitDate: exit.date,
    entryGapPct: round(entryGap * 100, 2),
    entryPrice: round(entryPrice, 3),
    exitPrice: round(exitPrice, 3),
    entryIndex,
    exitIndex,
    exitClose: round(exit.close, 3),
    entryFillPrice: round(entryFillPrice, 4),
    exitFillPrice: round(exitFillPrice, 4),
    slippageRate: round(slippageRate, 8),
    slippageModel: execution?.slippageModel ?? 'none-declared',
    entryParticipation: nullableRound(execution?.participation?.participation, 8),
    entryVolumeCap: execution?.participation?.volumeCap ?? null,
    entryVolumeCapExceeded: execution?.participation?.exceedsCap ?? null,
    entryLiquidityAvgVolume: nullableRound(execution?.liquidity?.avgVolume, 2),
    entryLiquidityAvgTurnover: nullableRound(execution?.liquidity?.avgTurnover, 2),
    entryLiquidityWindowRows: execution?.liquidity?.windowRows ?? null,
    entryPriceLimitPct: execution?.limitRule?.limitPct ?? null,
    entryPriceLimitBoard: execution?.limitRule?.board ?? null,
    entryAtPriceLimitUp: execution?.limitUp?.atLimitUp ?? null,
    exitVolumeCapExceeded: exitParticipationExceedsCap(rows, exitIndex, exitFillPrice, execution),
    exitSessionLimitDown: exitSessionAtLimitDown(rows, exitIndex, execution),
    holdingWindowZeroVolumeSessions: holdingWindowZeroVolumeSessions(rows, entryIndex, exitIndex),
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

// Holding-gate evaluation: the domain holding plan is always computed and its verdict is
// always recorded on the row. `enforce` keeps it a hard gate; `diagnostic` keeps the verdict
// as disclosure only and lets the other research gates decide.
// ── P1 execution reality: price limits, suspensions, liquidity, slippage ──

function createExecutionAudit() {
  return {
    signals: 0,
    accepted: 0,
    'entry-gate-rejected': 0,
    'insufficient-liquidity': 0,
    'suspended-entry-session': 0,
    'entry-at-price-limit-up': 0,
    'order-exceeds-volume-cap': 0,
  }
}

function nonNegativeArg(value, fallback, name) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) fail(`invalid --${name} value "${value}", expected a non-negative number`)
  return parsed
}

function resolveExecutionOptions() {
  const slippageBps = nonNegativeArg(args['slippage-bps'], 0, 'slippage-bps')
  const slippageAtrFraction = nonNegativeArg(args['slippage-atr-fraction'], 0, 'slippage-atr-fraction')
  if (slippageBps > 0 && slippageAtrFraction > 0) {
    fail('--slippage-bps and --slippage-atr-fraction are mutually exclusive')
  }
  const minAvgVolume = nonNegativeArg(args['min-avg-volume'], 0, 'min-avg-volume')
  const minAvgTurnover = nonNegativeArg(args['min-avg-turnover'], 0, 'min-avg-turnover')
  const volumeCap = args['volume-cap'] === undefined
    ? null
    : finiteArg(args['volume-cap'], null, 'volume-cap', { min: 0, max: 1, minExclusive: true })
  const orderNotional = args['order-notional'] === undefined
    ? null
    : finiteArg(args['order-notional'], null, 'order-notional', { min: 0, minExclusive: true })
  if ((volumeCap === null) !== (orderNotional === null)) {
    fail('--volume-cap and --order-notional must be supplied together; participation cannot be computed from either alone')
  }
  const slippageModel = slippageBps > 0 ? 'fixed-bps' : slippageAtrFraction > 0 ? 'atr-fraction' : 'none-declared'
  const clean = slippageModel === 'none-declared' && volumeCap === null && minAvgVolume === 0 && minAvgTurnover === 0
  return {
    slippageBps,
    slippageAtrFraction,
    slippageModel,
    slippageContextPolicy: 'rate frozen at signal close and applied to both fills; the structural target level is unchanged',
    volumeCap,
    orderNotional,
    minAvgVolume,
    minAvgTurnover,
    liquidityWindowSource: 'adaptiveWindowSpec.analysisWindowRows',
    priceLimit: PRICE_LIMIT_DISCLOSURE,
    suspension: SUSPENSION_DISCLOSURE,
    assumptionSource: clean ? 'default-none-declared' : 'explicit-scenario',
  }
}

function slippageRateFor({ executionOptions, marketPath, signalIndex }) {
  const bps = (executionOptions.slippageBps ?? 0) / 10000
  const atrPercent = marketPath?.[signalIndex]?.atrPercent
  const atrPart = executionOptions.slippageAtrFraction > 0 && Number.isFinite(atrPercent)
    ? executionOptions.slippageAtrFraction * atrPercent
    : 0
  return bps + atrPart
}

function averageLiquidity(rows, index, windowRows) {
  const window = Math.max(1, Math.floor(Number(windowRows) || 1))
  const start = Math.max(0, index - window + 1)
  let volume = 0
  let turnover = 0
  let sessions = 0
  for (let i = start; i <= index; i += 1) {
    const row = rows[i]
    if (!row || !(row.volume > 0) || !(row.close > 0)) continue
    volume += row.volume
    turnover += row.volume * row.close
    sessions += 1
  }
  if (!sessions) return null
  return { sessions, windowRows: window, avgVolume: volume / sessions, avgTurnover: turnover / sessions }
}

function calendarDaysBetween(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00Z`).getTime()
  const to = new Date(`${toDate}T00:00:00Z`).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return Math.round((to - from) / 86400000)
}

function suspensionState(previousRow, row) {
  const gapCalendarDays = previousRow ? calendarDaysBetween(previousRow.date, row.date) : null
  const zeroVolume = !(row?.volume > 0)
  return {
    suspended: zeroVolume || (Number.isFinite(gapCalendarDays) && gapCalendarDays > SUSPENSION_CALENDAR_GAP_DAYS),
    zeroVolume,
    gapCalendarDays,
    gapThresholdDays: SUSPENSION_CALENDAR_GAP_DAYS,
  }
}

function priceLimitForInstrument(instrument) {
  if (instrument.market !== 'A股') return null
  const code = String(instrument.symbol ?? '').replace(/\.HK$/i, '')
  for (const board of PRICE_LIMIT_BOARDS) {
    if (board.pattern.test(code)) return { limitPct: board.limitPct, board: board.board }
  }
  return null
}

function evaluateExecutionReality({ instrument, rows, signalIndex, marketPath, adaptiveWindowSpec, executionOptions }) {
  const rate = slippageRateFor({ executionOptions, marketPath, signalIndex })
  const entryIndex = signalIndex + 1
  const entryRow = rows[entryIndex]
  const previousRow = rows[entryIndex - 1]
  const base = {
    blocked: null,
    rate,
    slippageModel: executionOptions.slippageModel,
    liquidity: null,
    participation: null,
    limitRule: priceLimitForInstrument(instrument),
    limitUp: null,
  }
  if (!entryRow || !previousRow) {
    return { ...base, blocked: 'suspended-entry-session', detail: { reason: 'entry-session-missing', zeroVolume: true } }
  }
  if (executionOptions.minAvgVolume > 0 || executionOptions.minAvgTurnover > 0) {
    const liquidity = averageLiquidity(rows, signalIndex, adaptiveWindowSpec.analysisWindowRows)
    if (!liquidity) {
      return {
        ...base,
        blocked: 'insufficient-liquidity',
        detail: { failure: 'no-visible-volume', windowSource: executionOptions.liquidityWindowSource },
      }
    }
    if (executionOptions.minAvgVolume > 0 && liquidity.avgVolume < executionOptions.minAvgVolume) {
      return { ...base, blocked: 'insufficient-liquidity', detail: { failure: 'min-avg-volume', ...liquidity } }
    }
    if (executionOptions.minAvgTurnover > 0 && liquidity.avgTurnover < executionOptions.minAvgTurnover) {
      return { ...base, blocked: 'insufficient-liquidity', detail: { failure: 'min-avg-turnover', ...liquidity } }
    }
    base.liquidity = liquidity
  }
  const suspension = suspensionState(previousRow, entryRow)
  if (suspension.suspended) return { ...base, blocked: 'suspended-entry-session', detail: suspension }
  if (base.limitRule && previousRow.close > 0) {
    const limitUpPrice = previousRow.close * (1 + base.limitRule.limitPct / 100)
    const atLimitUp = entryRow.open >= limitUpPrice * (1 - PRICE_LIMIT_EPSILON)
    base.limitUp = {
      previousClose: round(previousRow.close, 4),
      limitUpPrice: round(limitUpPrice, 4),
      entryOpen: round(entryRow.open, 4),
      atLimitUp,
      limitPct: base.limitRule.limitPct,
      board: base.limitRule.board,
    }
    if (atLimitUp) return { ...base, blocked: 'entry-at-price-limit-up', detail: base.limitUp }
  }
  if (executionOptions.orderNotional !== null) {
    const fillPrice = entryRow.open * (1 + rate)
    const sessionTurnover = fillPrice * entryRow.volume
    const participation = sessionTurnover > 0 ? executionOptions.orderNotional / sessionTurnover : null
    base.participation = {
      orderNotional: executionOptions.orderNotional,
      sessionVolume: entryRow.volume,
      sessionTurnover: round(sessionTurnover, 2),
      participation: nullableRound(participation, 8),
      volumeCap: executionOptions.volumeCap,
      exceedsCap: Number.isFinite(participation) ? participation > executionOptions.volumeCap : null,
    }
    if (base.participation.exceedsCap === true) {
      return { ...base, blocked: 'order-exceeds-volume-cap', detail: base.participation }
    }
  }
  return base
}

// ── P2 research outputs: equity curve, risk metrics, signal decay, sensitivity ──

function resolveResearchOptions() {
  const sensitivityMode = enumArg(args.sensitivity ?? 'off', SUPPORTED_SENSITIVITY_MODES, 'sensitivity')
  if (sensitivityMode === 'thresholds' && mode !== 'replay') {
    fail('--sensitivity thresholds requires --mode replay; latest observation mode simulates no return')
  }
  const factors = parseNumberList(args['sensitivity-factors'], '0.8,1.2', 'sensitivity-factors', { positive: true })
  const horizons = parseNumberList(args['decay-horizons'], DECAY_HORIZON_LADDER.join(','), 'decay-horizons', { integer: true, positive: true })
  return {
    sensitivityMode,
    sensitivityFactors: factors,
    sensitivitySampleFloor: SENSITIVITY_SAMPLE_FLOOR,
    decayHorizons: [...new Set(horizons)].sort((a, b) => a - b),
    decayHorizonSource: args['decay-horizons'] === undefined ? 'default-research-ladder' : 'cli:--decay-horizons',
  }
}

function parseNumberList(value, fallbackText, name, { integer = false, positive = false } = {}) {
  const text = value === undefined ? fallbackText : String(value)
  const parts = text.split(',').map((item) => Number(item.trim()))
  if (!parts.length) fail(`invalid --${name} value "${text}", expected a comma-separated list`)
  for (const parsed of parts) {
    if (!Number.isFinite(parsed)) fail(`invalid --${name} value "${text}", expected numbers`)
    if (integer && !Number.isInteger(parsed)) fail(`invalid --${name} value "${text}", expected integers`)
    if (positive && parsed <= 0) fail(`invalid --${name} value "${text}", expected positive values`)
  }
  return parts
}

function disabledSensitivity(options) {
  return {
    enabled: false,
    mode: options.sensitivityMode,
    base: null,
    factors: options.sensitivityFactors,
    variants: [],
    stabilityScore: null,
    stabilityScoreInterpretable: false,
    stabilityScoreFormula: null,
    warnings: [],
    note: 'sensitivity is opt-in: pass --sensitivity thresholds to replay the same inputs once per perturbed threshold',
    claimClass: 'sample-estimate',
  }
}

function childArgsWithoutSensitivity() {
  const raw = process.argv.slice(2)
  const expectedValueFlags = new Set(['--sensitivity', '--sensitivity-factors', '--decay-horizons', '--run-log'])
  const out = []
  for (let i = 0; i < raw.length; i += 1) {
    if (expectedValueFlags.has(raw[i])) {
      i += 1
      continue
    }
    out.push(raw[i])
  }
  return out
}

function runSensitivity({ statistics, options }) {
  const base = { profile: profileMode, trades: statistics.n, meanPct: statistics.meanPct }
  if (config.profiles.length !== 1) {
    return {
      ...disabledSensitivity(options),
      enabled: false,
      base,
      reason: 'sensitivity requires exactly one resolved profile; pass --profile strict or --profile swing',
    }
  }
  const profile = config.profiles[0]
  const baseArgs = childArgsWithoutSensitivity()
  const variants = []
  for (const target of SENSITIVITY_TARGETS) {
    const baseValue = profile[target.parameter]
    if (!Number.isFinite(baseValue) || baseValue === 0) continue
    for (const factor of options.sensitivityFactors) {
      const value = round(baseValue * factor, 6)
      const result = spawnSync(process.execPath, [
        fileURLToPath(import.meta.url),
        ...baseArgs,
        target.flag,
        String(value),
        '--format',
        'json',
      ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
      const variant = {
        parameter: target.parameter,
        flag: target.flag,
        factor,
        value,
        status: 'ok',
        trades: null,
        meanPct: null,
        sampleWarning: null,
      }
      if (result.status !== 0) {
        variants.push({ ...variant, status: 'invalid', detail: `${result.stderr ?? ''}${result.stdout ?? ''}`.trim().split('\n').slice(0, 2).join(' ') })
        continue
      }
      let payload = null
      try {
        payload = JSON.parse(result.stdout)
      } catch (error) {
        payload = null
      }
      if (!payload) {
        variants.push({ ...variant, status: 'failed', detail: 'child output was not valid JSON' })
        continue
      }
      variants.push({
        ...variant,
        trades: payload.statistics?.n ?? 0,
        meanPct: payload.statistics?.meanPct ?? null,
        sampleWarning: payload.statistics?.sampleWarning ?? null,
      })
    }
  }
  const baseTrades = statistics.n
  const tolerance = SENSITIVITY_TRADES_TOLERANCE
  const scored = variants.filter((variant) => variant.status === 'ok' && variant.trades > 0)
  const stable = scored.filter((variant) => Number.isFinite(variant.meanPct)
    && variant.meanPct > 0
    && baseTrades > 0
    && variant.trades >= baseTrades / tolerance
    && variant.trades <= baseTrades * tolerance)
  const byParameter = SENSITIVITY_TARGETS
    .map((target) => ({ target, group: variants.filter((variant) => variant.parameter === target.parameter) }))
    .filter((entry) => entry.group.length)
    .map(({ target, group }) => {
      const counts = group.filter((variant) => variant.status === 'ok').map((variant) => variant.trades).filter(Number.isFinite)
      const minTrades = counts.length ? Math.min(...counts) : null
      const maxTrades = counts.length ? Math.max(...counts) : null
      return {
        parameter: target.parameter,
        flag: target.flag,
        baseValue: profile[target.parameter] ?? null,
        variants: group.length,
        minTrades,
        maxTrades,
        tradesRangeRatio: Number.isFinite(minTrades) && minTrades > 0 ? round(maxTrades / minTrades, 4) : null,
        signFlips: group.filter((variant) => variant.status === 'ok' && variant.trades > 0 && !(variant.meanPct > 0)).length,
      }
    })
  const fragile = byParameter.filter((entry) => entry.tradesRangeRatio !== null && entry.tradesRangeRatio >= tolerance)
  const warnings = []
  const interpretable = baseTrades >= SENSITIVITY_SAMPLE_FLOOR
  if (!baseTrades) warnings.push('base-configuration-produced-no-trade; sensitivity cannot be interpreted')
  if (!interpretable && baseTrades > 0) {
    warnings.push(`base-sample-is-${baseTrades}, below the ${SENSITIVITY_SAMPLE_FLOOR}-trade floor; stabilityScore is a descriptive count, not evidence`)
  }
  if (scored.length < variants.length) warnings.push(`${variants.length - scored.length} variant(s) produced no sample or failed`)
  if (scored.length && stable.length < scored.length) {
    warnings.push(`${scored.length - stable.length} variant(s) lost the positive mean or moved the sample size outside ${tolerance}x of the base`)
  }
  if (fragile.length) {
    warnings.push(`sample-size-unstable: ${fragile.map((entry) => `${entry.parameter} produced ${entry.minTrades}..${entry.maxTrades} trades`).join('; ')}`)
  }
  return {
    enabled: true,
    mode: 'thresholds',
    base,
    factors: options.sensitivityFactors,
    variants,
    byParameter,
    tradesToleranceFactor: tolerance,
    stabilityScore: scored.length ? round(stable.length / scored.length, 4) : null,
    stabilityScoreInterpretable: interpretable,
    stabilityScoreFormula: `variants keeping a positive sample mean and a trade count within ${tolerance}x of the base, divided by variants with at least one trade`,
    warnings,
    note: 'each variant is a separate full replay with identical inputs except one perturbed threshold, applied to the resolved profile value',
    claimClass: 'sample-estimate',
  }
}

function closesBySymbol(universeSessions) {
  const map = new Map()
  for (const instrument of universeSessions) map.set(instrument.symbol, instrument.closes ?? [])
  return map
}

function computeEquityCurve(trades) {
  const ordered = trades
    .map((trade, ordinal) => ({ trade, ordinal }))
    .sort((a, b) => {
      if (a.trade.exitDate === b.trade.exitDate) return a.ordinal - b.ordinal
      return a.trade.exitDate < b.trade.exitDate ? -1 : 1
    })
  let equity = 1
  let peak = 1
  let maxDrawdown = 0
  const points = []
  for (const { trade } of ordered) {
    equity *= 1 + trade.netReturnPct / 100
    if (equity > peak) peak = equity
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, equity / peak - 1)
    points.push({ date: trade.exitDate, symbol: trade.symbol, equity: round(equity, 6), netReturnPct: trade.netReturnPct })
  }
  return { points, finalEquity: equity, maxDrawdownFraction: maxDrawdown }
}

function computeRiskMetrics({ trades, equity, statistics }) {
  const base = {
    model: 'equal-weight one-unit-per-accepted-trade compounded in exit-date order',
    capitalModel: 'no position limit and no cash ledger; concurrent trades compound sequentially, so this is a trade-sequence research curve, not a portfolio NAV',
    simulationOnly: true,
    claimClass: 'scenario-proxy',
    points: trades.length,
    finalEquity: round(equity.finalEquity, 6),
    totalReturnPct: round((equity.finalEquity - 1) * 100, 4),
    maxDrawdownPct: round(equity.maxDrawdownFraction * 100, 4),
    avgHoldSessions: null,
    profitFactor: null,
    perTradeSharpe: null,
    annualizedSharpe: null,
    annualizedSharpeBasis: null,
    annualizedReturnPct: null,
    calmar: null,
    sampleWarning: null,
  }
  if (!trades.length) return { ...base, sampleWarning: 'no-sample: these thresholds produced no trade on this history' }
  const holds = trades.map((trade) => trade.actualHoldSessions).filter(Number.isFinite)
  const next = { ...base, avgHoldSessions: holds.length ? round(holds.reduce((sum, item) => sum + item, 0) / holds.length, 2) : null }
  const wins = trades.filter((trade) => trade.netReturnPct > 0)
  const losses = trades.filter((trade) => trade.netReturnPct <= 0)
  const grossWin = wins.reduce((sum, trade) => sum + trade.netReturnPct / 100, 0)
  const grossLoss = losses.reduce((sum, trade) => sum + trade.netReturnPct / 100, 0)
  next.profitFactor = grossLoss < 0 ? round(grossWin / Math.abs(grossLoss), 4) : null
  if (Number.isFinite(statistics.stdPct) && statistics.stdPct > 0) {
    next.perTradeSharpe = round(statistics.meanPct / statistics.stdPct, 4)
  }
  const dates = trades.map((trade) => trade.exitDate).filter(Boolean).sort()
  const spanDays = dates.length > 1 ? calendarDaysBetween(dates[0], dates.at(-1)) : null
  if (Number.isFinite(spanDays) && spanDays > 0 && Number.isFinite(next.perTradeSharpe)) {
    const years = spanDays / 365.25
    const tradesPerYear = trades.length / years
    next.annualizedSharpe = round(next.perTradeSharpe * Math.sqrt(tradesPerYear), 4)
    next.annualizedSharpeBasis = `per-trade Sharpe scaled by sqrt(${round(tradesPerYear, 2)} trades/year derived from the ${round(years, 2)}-year exit-date span)`
    const growth = equity.finalEquity > 0 ? Math.pow(equity.finalEquity, 1 / years) - 1 : null
    if (Number.isFinite(growth)) {
      next.annualizedReturnPct = round(growth * 100, 4)
      if (equity.maxDrawdownFraction < 0) {
        next.calmar = round(growth / Math.abs(equity.maxDrawdownFraction), 4)
      }
    }
  }
  if (trades.length < SENSITIVITY_SAMPLE_FLOOR) {
    next.sampleWarning = 'insufficient-sample: n<30, results are not statistically meaningful'
  }
  return next
}

function computeSignalDecay({ trades, universeSessions, options }) {
  const closes = closesBySymbol(universeSessions)
  const buckets = options.decayHorizons.map((sessions) => ({ sessions, n: 0, sum: 0, wins: 0 }))
  for (const trade of trades) {
    const series = closes.get(trade.symbol)
    if (!series || !Number.isFinite(trade.entryFillPrice) || !(trade.entryFillPrice > 0)) continue
    for (const bucket of buckets) {
      const close = series[trade.entryIndex + bucket.sessions]
      if (!(close > 0)) continue
      const net = close / trade.entryFillPrice - 1 - config.feeRate
      bucket.n += 1
      bucket.sum += net
      if (net > 0) bucket.wins += 1
    }
  }
  return buckets.map((bucket) => ({
    sessions: bucket.sessions,
    n: bucket.n,
    avgNetPct: bucket.n ? round((bucket.sum / bucket.n) * 100, 4) : null,
    winRatePct: bucket.n ? round((bucket.wins / bucket.n) * 100, 2) : null,
    sampleWarning: bucket.n >= SENSITIVITY_SAMPLE_FLOOR ? null : 'insufficient-sample: n<30, results are not statistically meaningful',
  }))
}

function computeResearchOutputs({ trades, universeSessions, statistics, options }) {
  const equity = computeEquityCurve(trades)
  return {
    equityCurve: equity.points,
    riskMetrics: computeRiskMetrics({ trades, equity, statistics }),
    signalDecay: computeSignalDecay({ trades, universeSessions, options }),
    signalDecayHorizonSource: options.decayHorizonSource,
    signalDecaySemantics: 'forward net return at each horizon after the accepted entry fill under the same fee; a fixed research ladder, not a holding recommendation',
  }
}

function evaluateHoldingGate(dynamicHolding) {
  const shortTrade = dynamicHolding?.holdingPlan?.shortTrade ?? null
  const action = shortTrade?.action ?? null
  const blocked = config.mode === 'replay' ? action !== 'execute' : dynamicHolding?.status === '剔除'
  return {
    holdingGatePolicy: config.holdingGate,
    holdingGateEnforced: config.holdingGate === 'enforce',
    holdingGateBlocked: blocked,
    holdingGateVerdict: blocked
      ? config.mode === 'replay'
        ? (dynamicHolding?.status ?? 'unknown')
        : '剔除'
      : 'execute',
    holdingGatePhase: dynamicHolding?.phase ?? null,
    holdingGatePhaseLabel: dynamicHolding?.phaseLabel ?? null,
    holdingGateShortTradeAction: action,
    holdingGateBlockedReasons: blocked ? (dynamicHolding?.blockedReasons ?? []).slice(0, 4) : [],
  }
}

function groupedReturnBreakdown(trades, selectKey) {
  const groups = new Map()
  for (const trade of trades) {
    const key = selectKey(trade) ?? 'unknown'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(trade)
  }
  return [...groups.entries()]
    .map(([key, rows]) => {
      const returns = rows.map((row) => row.netReturnPct / 100).filter(Number.isFinite).sort((a, b) => a - b)
      if (!returns.length) {
        return { key, n: 0, meanPct: null, medianPct: null, winRatePct: null, sampleWarning: 'no-sample' }
      }
      return {
        key,
        n: returns.length,
        meanPct: round((returns.reduce((sum, item) => sum + item, 0) / returns.length) * 100, 4),
        medianPct: round(quantile(returns, 0.5) * 100, 4),
        winRatePct: winRatePctOf(returns),
        sampleWarning: returns.length < 30 ? 'insufficient-sample: n<30, results are not statistically meaningful' : null,
      }
    })
    .sort((a, b) => b.n - a.n)
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
  const holdingGateState = evaluateHoldingGate(dynamicHolding)
  if (holdingGateState.holdingGateBlocked && config.holdingGate === 'enforce') return null

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
        ...holdingGateState,
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
      ...holdingGateState,
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

function printMarkdown({ config, summary, trades, evidence }) {
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
  printEvidenceMarkdown(evidence)
  console.log(``)
  console.log(`| profile | status / phase | status reason | target | q | model H / applied H | symbol | name | source | through / rows / age | signal | exit | exit reason | hold | net | z(H) | HL | normal P | normal tail | empirical P | CK geom P | costDist | gap |`)
  console.log(`| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`)
  for (const row of trades.slice(0, 20)) {
    console.log(`| ${row.profile} | ${row.status} / ${row.dynamicPhase ?? '-'} | ${row.statusReasons.join(',')} | ${targetLabel(row)} | ${row.targetRecoveryFraction ?? '-'} | ${row.modelHorizonSessions ?? '-'} / ${row.appliedHorizonSessions ?? '-'} | ${row.symbol} | ${row.name} | ${row.source} | ${row.dataThrough} / ${row.rows} / ${row.staleDays ?? '?'}d | ${row.signalDate} | ${row.exitDate} | ${row.reason} | ${row.actualHoldSessions} | ${row.netReturnPct}% | ${row.deviationZ} | ${row.halfLifeSessions} | ${nullablePct(row.deviationPercentilePct)} | ${nullablePct(row.deviationTwoSidedTailProbabilityPct)} | ${nullablePct(row.empiricalDeviationPercentilePct)} | ${nullablePct(row.ckGeometryPercentile)} | ${row.costDistancePct}% | ${row.entryGapPct}% |`)
  }
  console.log(``)
  console.log(`Replay assumptions: signal-day cost band, half-life and drawdown stay frozen; q=(costLower-entry)/(costAnchor-entry) and H=HL*log2(1/(1-q)) are recomputed with the actual next-session open. In structure mode the same H controls tail sufficiency, horizon exit, and non-overlap. When stop and target are both inside one OHLC bar, stop wins conservatively. Only positive monotonic AR decay is eligible.`)
  console.log(`Research replay only. Normal-reference deviation P/tail and empirical ranks describe extremeness, not mean-reversion probability. Synthetic CK geometry is a normalized shape diagnostic, not a real LP position, token holding, fee income, or investment return; it is not used as a target price. No RSI/KDJ/EMA/MA or external factors are used.`)
}

function printLatestMarkdown({ config, summary, signals, evidence }) {
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
  printEvidenceMarkdown(evidence)
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
    holdingGatePolicy: dynamicHolding.holdingGatePolicy ?? null,
    holdingGateEnforced: dynamicHolding.holdingGateEnforced ?? null,
    holdingGateBlocked: dynamicHolding.holdingGateBlocked ?? null,
    holdingGateVerdict: dynamicHolding.holdingGateVerdict ?? null,
    holdingGatePhase: dynamicHolding.holdingGatePhase ?? null,
    holdingGateShortTradeAction: dynamicHolding.holdingGateShortTradeAction ?? null,
    holdingGateBlockedReasons: dynamicHolding.holdingGateBlockedReasons ?? [],
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

function integerArg(value, fallback, name) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) fail(`invalid --${name} value "${value}", expected an integer`)
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
