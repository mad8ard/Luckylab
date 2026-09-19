#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  canonicalizeFormulaSessionFields,
  deriveAdaptiveWindowSpec,
  isPositiveMonotonicMeanReversion,
} from '../.agents/skills/china-stock-selection/scripts/selection-helpers.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const CLAIM_CLASS_ENUM = new Set([
  'exact-identity',
  'sample-estimate',
  'calibrated-estimate',
  'scenario-proxy',
  'missing-input',
])

const prefixWindow = deriveAdaptiveWindowSpec({ tradingDaysPerYear: 242, visibleRows: 100 })
const samePrefixAfterHypotheticalAppend = deriveAdaptiveWindowSpec({ tradingDaysPerYear: 242, visibleRows: 100 })
const longerPrefixWindow = deriveAdaptiveWindowSpec({ tradingDaysPerYear: 242, visibleRows: 400 })
const missingTdpyWindow = deriveAdaptiveWindowSpec({ visibleRows: 100 })
assert.deepEqual(prefixWindow, samePrefixAfterHypotheticalAppend)
assert.equal(missingTdpyWindow.status, 'missing-input')
assert.equal(missingTdpyWindow.tradingDaysPerYear, null)
assert.deepEqual(missingTdpyWindow.missingInputs, ['tradingDaysPerYear'])
assert.equal(prefixWindow.mode, 'adaptive-tdpy-visible-prefix')
assert.equal(prefixWindow.futureRowsUsed, false)
assert.ok(longerPrefixWindow.analysisWindowRows > prefixWindow.analysisWindowRows)
assert.equal(
  isPositiveMonotonicMeanReversion({
    isMeanReverting: true,
    decayMode: 'monotonic-decay',
    arCoefficient: 0.8,
    halfLifeSessions: 3.1,
  }),
  true,
)
assert.equal(
  isPositiveMonotonicMeanReversion({
    isMeanReverting: true,
    decayMode: 'monotonic-decay',
    rho: 0.8,
    halfLifeDays: 3.1,
  }),
  false,
)
const canonicalSessionPayload = canonicalizeFormulaSessionFields({
  halfLifeSessions: 3,
  halfLifeDays: 3,
  modelHorizonDays: 7,
  legacyAliases: { halfLifeDays: 'halfLifeSessions' },
})
assert.deepEqual(canonicalSessionPayload, { halfLifeSessions: 3, modelHorizonSessions: 7 })

const canonicalScripts = [
  '.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs',
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  '.agents/skills/china-stock-selection/scripts/selection-helpers.mjs',
]

const wrappers = [
  {
    path: 'skills/china-stock-selection/scripts/screen-cn-stocks.mjs',
    target: '.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs',
  },
  {
    path: 'skills/china-stock-selection/scripts/replay-short-hold.mjs',
    target: '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  },
  {
    path: 'skills/china-stock-selection/scripts/selection-helpers.mjs',
    target: '.agents/skills/china-stock-selection/scripts/selection-helpers.mjs',
  },
  {
    path: '.claude/skills/china-stock-selection/scripts/screen-cn-stocks.mjs',
    target: '.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs',
  },
  {
    path: '.claude/skills/china-stock-selection/scripts/replay-short-hold.mjs',
    target: '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  },
  {
    path: '.claude/skills/china-stock-selection/scripts/selection-helpers.mjs',
    target: '.agents/skills/china-stock-selection/scripts/selection-helpers.mjs',
  },
]

const skillDocs = [
  '.agents/skills/china-stock-selection/SKILL.md',
  'skills/china-stock-selection/SKILL.md',
  '.claude/skills/china-stock-selection/SKILL.md',
]

const canonicalReferences = [
  '.agents/skills/china-stock-selection/references/retail-decision-contract.md',
  '.agents/skills/china-stock-selection/references/formula-risk-contract.md',
  '.agents/skills/china-stock-selection/references/cli-contract.md',
]

for (const path of canonicalScripts) syntaxCheck(path)

for (const { path, target } of wrappers) {
  const source = read(path)
  assert.match(source, new RegExp(escapeRegExp(target)), `${path} must delegate to ${target}`)
  syntaxCheck(path)
}

for (const path of skillDocs) {
  const source = read(path)
  assert.match(
    source,
    /Canonical implementation: `\.agents\/skills\/china-stock-selection`|sole semantic and safety contract/,
  )
  assert.match(
    source,
    /probabilitySemantics|not (?:a )?(?:future )?(?:mean-)?reversion probability|not a probability that price will revert|不是未来回归概率/i,
  )
  assert.match(source, /synthetic CK geometry/i)
}

for (const path of canonicalReferences) {
  assert.ok(existsSync(resolve(path)), `${path} must exist`)
}

const canonicalSkill = read('.agents/skills/china-stock-selection/SKILL.md')
for (const path of canonicalReferences) {
  const name = path.split('/references/').at(-1)
  assert.ok(canonicalSkill.includes(`references/${name}`), `canonical SKILL.md must route to references/${name}`)
}

const cliContract = read('.agents/skills/china-stock-selection/references/cli-contract.md')
assertTokens(
  cliContract,
  [
    'china-stock-selection.screen.v3',
    'china-stock-selection.replay.v4',
    'scoreStatus',
    'dataState',
    'candidateStatus',
    'status',
    'statusReasons',
    'executionStatus',
    'schemaVersion',
    'stateContract',
    'claimClassContract',
    'claimClasses',
    'provenance',
    'filters',
    'freshness',
    'audit',
    'historical-realized-scenario',
    'isMarketIv=false',
    'adaptiveWindowSpec',
    'minimumRequiredRows',
    'analysisWindowRows',
    'adaptive-tdpy-visible-prefix',
    'minimumGrossReturn',
    'fixedTargetReturn',
    'profileMinimumGrossReturnPct',
    'profileFixedTargetReturnPct',
    'nextAllowedIndex',
    'modelHorizonSessions',
    'actualHoldSessions',
    'arCoefficient',
    'fixedHorizonApplied=true',
    'executionAuthority=none',
    '0.875',
    'signal-context-frozen-target-recomputed-with-next-session-open',
    'cost-band-half-life-and-drawdown-frozen-at-signal-close; deviation-rescaled-to-entry-derived-horizon',
    'stop-first-conservative-when-both-hit',
    'feeAppliedToReturns=false',
    'round-trip drag',
    'Hong Kong',
    'same-day',
    'bid/ask',
    'slippage',
    'stamp duty',
    'Unmodeled Execution and Cost Mechanisms',
    'grossReturn',
    'netReturn',
    'feeRate',
    'eligible=true',
    'research-only',
    'Supplied numeric overrides are strict',
    'Unknown flag names',
    '--fee 0',
    'historical-visible-prefix-as-of-signal-close',
    '--option-tenor-sessions',
    'optionScenario',
    'timeToExpirySessions',
    'explicit-option-tenor-sessions',
    'gammaConvexity=null',
  ],
  'CLI contract',
)

const screenSource = read('.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs')
assertTokens(
  screenSource,
  [
    'china-stock-selection.screen.v3',
    'scoreStatus',
    'dataState',
    'dataStateReasons',
    'candidateStatus',
    'status',
    'statusReasons',
    'executionStatus',
    'executionReasons',
    'nameSource',
    'source',
    'dataThrough',
    'rows',
    'staleDays',
    'freshness',
    'provenance',
    'filters',
    'audit',
    'skipped',
    'researchBoundary',
    'stateContract',
    'claimClassContract',
    'claimClasses',
    'historical-realized-scenario',
    'isMarketIv',
    'missingInputs',
    'syntheticCkGeometry',
    'orderPlan',
    'blockedReasons',
    'capitalEfficiencyValuationBasis',
    'capitalEfficiencyAtArithmeticCenterMultiple',
    'fullRangeV2IlProxyPct',
    'fullRangeV2IlProxyBasis',
    'candidateStatusPriority',
    'phase-${phase',
    'adaptiveWindowSpec',
    'rowGate',
    'fullRangeV2ImpermanentLoss',
    'lpIlFraction',
    'ilModel',
    'capitalBasis',
    'horizonSessions',
    'option-tenor-sessions',
    'optionScenario',
    'timeToExpirySessions',
    'explicit-option-tenor-sessions',
  ],
  'screen runtime',
)

const replaySource = read('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs')
assertTokens(
  replaySource,
  [
    'china-stock-selection.replay.v4',
    'STRICT_DEFAULTS',
    'SWING_DEFAULTS',
    'strict',
    'swing',
    'combo',
    'signalDate',
    'entryDate',
    'exitDate',
    'nameSource',
    'source',
    'dataThrough',
    'rows',
    'staleDays',
    'freshness',
    'provenance',
    'filters',
    'audit',
    'skipped',
    'statusReasons',
    'dataState',
    'dataStateReasons',
    'scoreStatus',
    'candidateStatus',
    'executionStatus',
    'executionReasons',
    'researchBoundary',
    'stateContract',
    'claimClassContract',
    'claimClasses',
    'deviationProbabilitySemantics',
    'ckGeometryInterpretation',
    'feeAppliedToReturns',
    'feeModel',
    'targetRecomputedAtEntry',
    'targetTiming',
    'targetContextPolicy',
    'targetRecoveryFraction',
    'structuralRecoveryFraction',
    'modelHorizonRaw',
    'modelHorizonSessions',
    'appliedHorizonSessions',
    'actualHoldSessions',
    'fixedHorizonApplied',
    'executionAuthority',
    'settlementLagSessions',
    'intrabarPolicy',
    'grossReturnPct',
    'netReturnPct',
    'adaptiveWindowSpec',
    'minimumGrossReturn',
    'fixedTargetReturn',
    'profileMinimumGrossReturnPct',
    'profileFixedTargetReturnPct',
    'halfLifeSessions',
    'arCoefficient',
    'historical-visible-prefix-as-of-signal-close',
  ],
  'replay runtime',
)

const compactReplay = withoutWhitespace(replaySource)
assertCompactTokens(
  replaySource,
  [
    "parseMarkets(args.market??'A股')",
    'config.markets.includes(entry.market)',
    "explicitMinRows=optionalPositiveIntArg(args['min-rows'],'min-rows')",
    "mode:explicitMinRows===null?'adaptive':'explicit-scenario'",
    "source:explicitMinRows===null?adaptiveWindowSpec.source:'cli:--min-rows'",
    'tradingDaysPerYear:tdpy,visibleRows:i+1',
    "if(args.fee===undefined)fail('--fee is required; pass --fee 0 explicitly when no fee drag is intended')",
    "requestedFeeRate=finiteArg(args.fee,null,'fee',{min:0,max:1,maxExclusive:true})",
    "targetTiming:'signal-context-frozen-target-recomputed-with-next-session-open'",
    "targetContextPolicy:'cost-band-half-life-and-drawdown-frozen-at-signal-close; deviation-rescaled-to-entry-derived-horizon'",
    "calculation:mode==='replay'?'netReturn=grossReturn-feeRate-once':'not-applied-in-latest-observation-mode'",
  ],
  'replay runtime semantics',
)
assert.ok(
  compactReplay.includes('for(leti=0;'),
  'replay must start from the causal prefix gate rather than a hidden fixed historical index',
)
assert.ok(
  compactReplay.includes('if(i+1<requiredPrefixRows)continue'),
  'replay must gate each visible prefix with the resolved adaptive or explicit sample gate',
)
assert.ok(
  compactReplay.includes('entryIndex=signalIndex+1'),
  'replay entry must remain the next session after the signal',
)
assert.ok(
  compactReplay.includes('lastExitIndex=entryIndex+appliedHorizonSessions'),
  'replay exit boundary must consume the event-applied horizon',
)
assert.ok(
  compactReplay.includes('nextAllowedIndex=i+trade.appliedHorizonSessions+1'),
  'replay must keep accepted trades non-overlapping with the event-applied horizon',
)
assert.ok(
  compactReplay.includes('lastExitIndex>=rows.length'),
  'replay tail sufficiency must be checked against the event-applied horizon',
)
assert.ok(
  compactReplay.includes('cycleStartPrice:row.close') && compactReplay.includes('targetPrice:market.costLow'),
  'replay structural horizon must derive q from the event start to costLower target',
)
assert.doesNotMatch(
  replaySource,
  /0\.875|anchorRecovery|anchor-recovery/,
  'replay must not retain the 0.875 anchor proxy',
)
assert.doesNotMatch(
  replaySource,
  /\btargetReturn\b|for\s*\(let\s+i\s*=\s*260|index\s*-\s*(?:241|725|179)|positiveIntArg\(args\['min-rows'\],\s*360|finiteArg\(args\.fee,\s*0\.0011/,
  'replay must not retain an ambiguous return field or hidden fixed sample periods',
)
assert.doesNotMatch(replaySource, /strict-5d|fast-5d|swing-10d/, 'profile names must not encode fixed holding buckets')
assert.ok(
  compactReplay.includes('netReturn=grossReturn-config.feeRate'),
  'replay fee must remain a single aggregate return drag',
)
assert.ok(
  compactReplay.includes("intrabarPolicy:'stop-first-conservative-when-both-hit'"),
  'replay must retain the conservative same-bar policy',
)
assert.ok(
  compactReplay.includes("targetTiming:'signal-context-frozen-target-recomputed-with-next-session-open'"),
  'replay must retain next-open target recomputation',
)

assertObjectDefaults(replaySource, 'STRICT_DEFAULTS', {
  minimumGrossReturn: '0.03',
  stopLoss: '0.015',
  minZ: '2',
  maxCkGeometryPercentile: '3',
  maxHalfLifeSessions: '12',
  minCostSlopePct: '-1',
  maxCostSlopePct: '1',
  minCostDistancePct: '10',
  maxCostDistancePct: '16',
  maxEntryGapPct: '0.5',
  minEntryGapPct: '-3',
  targetMode: "'structure'",
})

assertObjectDefaults(replaySource, 'SWING_DEFAULTS', {
  minimumGrossReturn: '0.04',
  stopLoss: '0.015',
  minZ: '2.5',
  maxCkGeometryPercentile: '5',
  maxHalfLifeSessions: '20',
  minCostSlopePct: '-1',
  maxCostSlopePct: '0.5',
  minCostDistancePct: '12',
  maxCostDistancePct: '22',
  maxEntryGapPct: '0.5',
  minEntryGapPct: '-3',
  targetMode: "'structure'",
})

assertCompactTokens(
  screenSource,
  [
    "parseMarkets(args.market??'A股,港股')",
    "top=positiveIntArg(args.top,20,'top')",
    "explicitMinRows=optionalPositiveIntArg(args['min-rows'],'min-rows')",
    "explicitOptionTenorSessions=optionalPositiveIntArg(args['option-tenor-sessions'],'option-tenor-sessions')",
    "mode:explicitMinRows===null?'adaptive':'explicit-scenario'",
    'getDeltaBands({entryPrice:latest.close,formulaHorizonSessions,iv,deltaSlope,tradingDaysPerYear:tdpy.value',
    'timeToExpirySessions===null?null:{entryPrice:latest.close,strikePrice,timeToExpirySessions,iv',
    "format=enumArg(args.format??'markdown',SUPPORTED_FORMATS,'format')",
  ],
  'screen runtime defaults',
)
assert.doesNotMatch(
  screenSource,
  /marketPath\.slice\(-(?:726|180)\)|marketPath\.length\s*-\s*242|positiveIntArg\(args\['min-rows'\],\s*180/,
  'screen must not retain hidden fixed sample periods',
)
assert.doesNotMatch(
  screenSource,
  /\bimpermanentLoss\s*\(/,
  'screen must call the explicitly named full-range v2 IL implementation',
)
assert.doesNotMatch(
  screenSource,
  /deprecatedOptionHorizonAdapter|\bholdingDays\b/,
  'screen must not adapt the stock-repair horizon into an option tenor',
)
assert.doesNotMatch(
  screenSource,
  /option\?\.(?:delta|gamma|thetaDaily)|\b(?:delta|gamma|thetaPerSession)\s*:\s*option\s*\?/,
  'screen must publish canonical option Greek names and preserve missingness',
)
assert.doesNotMatch(
  replaySource,
  /\b(?:halfLifeDays|modelHorizonDays|appliedHorizonDays|fixedHorizonDays|holdDays|meanReversionRho|meanReversionArCoefficient)\b/,
  'new replay source/output fields must use canonical session and AR names',
)

assertCliFails(
  '.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs',
  ['--top', '0'],
  'expected a positive integer',
)
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs',
  ['--typo', '1'],
  'unknown option --typo',
)
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs',
  ['--option-tenor-sessions', '0'],
  'expected a positive integer',
)
assertCliFails('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', ['--fee', '-0.1'], 'invalid --fee')
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  [],
  '--fee is required; pass --fee 0 explicitly',
)
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  ['--fee', '0', '--min-distance', '20', '--max-distance', '10'],
  'invalid distance bounds',
)
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  ['--fee', '0', '--target-mode', 'structure', '--max-hold', '5'],
  '--max-hold is allowed only with explicit --target-mode fixed',
)
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  ['--fee', '0', '--target-mode', 'fixed', '--target', '0.03'],
  '--target-mode fixed requires explicit --max-hold',
)
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  ['--fee', '0', '--target-mode', 'fixed', '--max-hold', '10'],
  '--target-mode fixed requires explicit --target',
)
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  ['--fee', '0', '--anchor-recovery', '0.875'],
  'unknown option --anchor-recovery',
)

const poolGeneratorSource = read('scripts/generate-recommended-pool.mjs')
assert.doesNotMatch(
  poolGeneratorSource,
  /computeRSI|computeKDJ|\brsi\s*:|\bj\s*:/,
  'recommended-pool generator must not compute or emit RSI/KDJ',
)
const poolDomainSource = read('src/domain/strategy-planning/recommendedStockPool.js')
assertTokens(
  poolDomainSource,
  [
    'FORBIDDEN_SCORE_INPUT_KEYS',
    'allowedDimensionIds',
    'canonicalDimensionsById',
    'duplicate-dimension-id',
    'dimension-id-not-in-library',
    'forbidden-indicator-input',
  ],
  'recommended-pool score boundary',
)

const screenPayload = runCliJson('.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs', [
  '--market',
  '港股',
  '--top',
  '1',
  '--format',
  'json',
])
assert.equal(screenPayload.schemaVersion, 'china-stock-selection.screen.v3')
assert.equal(screenPayload.rowGate.mode, 'adaptive')
assert.equal(screenPayload.rowGate.explicitMinimumRows, null)
assert.deepEqual(screenPayload.optionScenario, {
  mode: 'missing-input',
  timeToExpirySessions: null,
  source: 'missing-input',
  executionAuthority: 'none',
})
assert.equal(screenPayload.claimClasses.optionAndGreeks, 'missing-input')
assertStateContract(screenPayload.stateContract, 'screen JSON')
assertClaimClassContract(screenPayload.claimClassContract, 'screen JSON')
assertClaimClasses(screenPayload.claimClasses, 'screen JSON')
assert.ok(screenPayload.ranked.length > 0, 'screen JSON smoke requires at least one ranked candidate')
const screenCandidate = screenPayload.ranked[0]
assertFourStateRow(screenCandidate, 'screen candidate')
assertClaimClasses(screenCandidate.claimClasses, 'screen candidate')
assert.equal(screenCandidate.status, screenCandidate.candidateStatus, 'screen legacy status must alias candidateStatus')
assert.ok(
  Object.hasOwn(screenCandidate.formula.syntheticCkGeometry, 'fullRangeV2IlProxyPct'),
  'screen must name the full-range v2 IL proxy explicitly',
)
assert.ok(
  !Object.hasOwn(screenCandidate.formula.syntheticCkGeometry, 'relativeIlShapePct'),
  'screen must not imply the full-range v2 proxy is v3 range IL',
)
assert.equal(screenCandidate.formula.windowSpec.mode, 'adaptive-tdpy-visible-prefix')
assert.equal(screenCandidate.formula.windowSpec.futureRowsUsed, false)
assert.equal(screenCandidate.provenance.rowGate.mode, 'adaptive')
assert.equal(screenCandidate.provenance.adaptiveWindowSpec.visibleRows, screenCandidate.rows)
const screenAttribution = screenCandidate.formula.syntheticCkGeometry.researchAttribution
assert.equal(screenAttribution.status, 'calibration-required')
assert.equal(screenAttribution.researchBoundary, 'research-only')
assert.equal(screenAttribution.executionStatus, 'blocked')
assert.ok(Number.isFinite(screenAttribution.returns.lpIlFraction))
assert.equal(screenAttribution.returns.ilModel, 'constant-product-v2-full-range-no-fees')
assert.equal(screenAttribution.returns.capitalBasis, 'full-range-v2-entry-hold-value-at-current-mark')
assert.equal(screenAttribution.returns.horizonSessions, null)
assert.equal(screenAttribution.returns.netReturn, null)
assert.ok(screenCandidate.formula.deltaBands, 'GetDelta must still consume the independently derived formula horizon')
assert.ok(Number.isFinite(screenCandidate.formula.deltaBands.formulaHorizonSessions))
const missingOptionScenario = screenCandidate.formula.options
assert.equal(screenCandidate.claimClasses.optionAndGreeks, 'missing-input')
assert.equal(missingOptionScenario.status, 'missing-input')
assert.equal(missingOptionScenario.claimClass, 'missing-input')
assert.equal(missingOptionScenario.horizonMode, 'missing-input')
assert.equal(missingOptionScenario.timeToExpirySessions, null)
assert.equal(missingOptionScenario.timeToExpirySource, 'missing-input')
assert.ok(missingOptionScenario.missingInputs.includes('explicit-option-tenor-sessions'))
for (const field of [
  'optionDelta',
  'optionGamma',
  'optionThetaPerSession',
  'asianPrice',
  'bachelierPrice',
  'positionGamma',
  'dollarGamma',
  'gammaPnl',
]) {
  assert.equal(missingOptionScenario[field], null, `missing option tenor must keep options.${field} null`)
}
assert.equal(missingOptionScenario.riskSurfacePoints, 0)
assert.equal(screenCandidate.formula.gammaConvexity, null)
assertNoDeprecatedFormulaKeys(screenCandidate.formula, 'screen formula')

const explicitOptionPayload = runCliJson('.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs', [
  '--market',
  '港股',
  '--top',
  '1',
  '--format',
  'json',
  '--option-tenor-sessions',
  '30',
])
assert.deepEqual(explicitOptionPayload.optionScenario, {
  mode: 'explicit-scenario',
  timeToExpirySessions: 30,
  source: 'cli:--option-tenor-sessions',
  executionAuthority: 'none',
})
assert.equal(explicitOptionPayload.claimClasses.optionAndGreeks, 'scenario-proxy')
assert.ok(explicitOptionPayload.ranked.length > 0, 'explicit option-tenor smoke requires a ranked candidate')
const explicitOptionCandidate = explicitOptionPayload.ranked[0]
const explicitOptionScenario = explicitOptionCandidate.formula.options
assert.equal(explicitOptionCandidate.claimClasses.optionAndGreeks, 'scenario-proxy')
assert.equal(explicitOptionScenario.status, 'research-only')
assert.equal(explicitOptionScenario.claimClass, 'scenario-proxy')
assert.equal(explicitOptionScenario.horizonMode, 'explicit-scenario')
assert.equal(explicitOptionScenario.timeToExpirySessions, 30)
assert.equal(explicitOptionScenario.timeToExpirySource, 'cli:--option-tenor-sessions')
assert.equal(explicitOptionScenario.missingInputs.includes('explicit-option-tenor-sessions'), false)
for (const field of [
  'optionDelta',
  'optionGamma',
  'optionThetaPerSession',
  'asianPrice',
  'bachelierPrice',
  'positionGamma',
  'dollarGamma',
  'gammaPnl',
]) {
  assert.ok(Number.isFinite(explicitOptionScenario[field]), `explicit option tenor must compute options.${field}`)
}
assert.ok(explicitOptionScenario.riskSurfacePoints > 0)
assert.equal(explicitOptionCandidate.formula.gammaConvexity.timeToExpirySessions, 30)
assert.equal(explicitOptionCandidate.formula.gammaConvexity.timeToExpirySource, 'cli:--option-tenor-sessions')
assert.equal(
  explicitOptionCandidate.formula.deltaBands.formulaHorizonSessions,
  screenCandidate.formula.deltaBands.formulaHorizonSessions,
  'an option-tenor scenario must not mutate the stock-repair formula horizon',
)
assertNoDeprecatedFormulaKeys(explicitOptionCandidate.formula, 'explicit option screen formula')

const explicitScreenGatePayload = runCliJson('.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs', [
  '--market',
  '港股',
  '--top',
  '1',
  '--format',
  'json',
  '--min-rows',
  '24',
])
assert.equal(explicitScreenGatePayload.rowGate.mode, 'explicit-scenario')
assert.equal(explicitScreenGatePayload.rowGate.source, 'cli:--min-rows')
assert.equal(explicitScreenGatePayload.rowGate.explicitMinimumRows, 24)

const replayPayload = runCliJson('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', [
  '--mode',
  'latest',
  '--market',
  '港股',
  '--format',
  'json',
  '--fee',
  '0',
  '--target',
  '0.0001',
  '--min-z',
  '0',
  '--ck-geometry-max',
  '100',
  '--max-hl',
  '10000',
  '--min-slope',
  '-100',
  '--max-slope',
  '100',
  '--min-distance',
  '0',
  '--max-distance',
  '100',
  '--max-entry-gap',
  '100',
  '--min-entry-gap',
  '-100',
])
assert.equal(replayPayload.schemaVersion, 'china-stock-selection.replay.v4')
assert.equal(replayPayload.config.feeRate, 0)
assert.equal(replayPayload.config.rowGate.mode, 'adaptive')
assert.equal(replayPayload.config.rowGate.explicitMinimumRows, null)
assertStateContract(replayPayload.stateContract, 'replay JSON')
assertClaimClassContract(replayPayload.claimClassContract, 'replay JSON')
assertClaimClasses(replayPayload.claimClasses, 'replay JSON')
assert.ok(replayPayload.signals.length > 0, 'latest replay smoke must exercise an awaiting-entry horizon')
for (const row of replayPayload.signals) {
  assertFourStateRow(row, 'replay signal')
  assertClaimClasses(row.claimClasses, 'replay signal')
  assert.equal(row.status, row.candidateStatus, 'replay legacy status must alias candidateStatus')
  assert.equal(row.modelHorizonSessions, null, 'latest observation must not pretend the next-session entry is known')
  assert.equal(row.modelHorizonStatus, 'awaiting-next-session-open')
  assert.equal(row.executionAuthority, 'none')
  assert.ok(Number.isFinite(row.arCoefficient))
  assert.ok(Number.isFinite(row.profileMinimumGrossReturnPct))
  assert.equal(row.profileFixedTargetReturnPct, null)
  assert.equal(row.adaptiveWindowSpec.mode, 'adaptive-tdpy-visible-prefix')
  assert.equal(row.adaptiveWindowSpec.futureRowsUsed, false)
  assertNoDeprecatedFormulaKeys(row, 'latest replay signal')
}

const structureReplayPayload = runCliJson('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', [
  '--mode',
  'replay',
  '--market',
  '港股',
  '--profile',
  'strict',
  '--format',
  'json',
  '--fee',
  '0',
  '--target',
  '0.0001',
  '--min-z',
  '0',
  '--ck-geometry-max',
  '100',
  '--max-hl',
  '10000',
  '--min-slope',
  '-100',
  '--max-slope',
  '100',
  '--min-distance',
  '0',
  '--max-distance',
  '100',
  '--max-entry-gap',
  '100',
  '--min-entry-gap',
  '-100',
])
assert.ok(structureReplayPayload.trades.length > 0, 'structure replay smoke must exercise event-derived horizons')
assert.equal(structureReplayPayload.config.fixedHorizonApplied, false)
assert.equal(structureReplayPayload.config.executionAuthority, 'none')
assert.ok(Number.isFinite(structureReplayPayload.config.profiles[0].minimumGrossReturn))
assert.equal(structureReplayPayload.config.profiles[0].fixedTargetReturn, null)
for (const row of structureReplayPayload.trades) {
  assert.match(row.profile, /-structure$/)
  assert.equal(row.fixedHorizonApplied, false)
  assert.equal(row.appliedHorizonSessions, row.modelHorizonSessions)
  assert.equal(row.modelHorizonSessions, Math.ceil(row.modelHorizonRaw))
  assert.ok(row.targetRecoveryFraction > 0 && row.targetRecoveryFraction < 1)
  assert.equal(row.entryDeviationHorizonSessions, row.modelHorizonSessions)
  assert.ok(Number.isFinite(row.entryDeviationZ))
  const recoveryFromTargetPosition =
    (row.horizonCostLowerPrice - row.horizonCycleStartPrice) / (row.horizonAnchorPrice - row.horizonCycleStartPrice)
  assert.ok(Math.abs(recoveryFromTargetPosition - row.targetRecoveryFraction) < 0.00001)
  assert.equal(row.executionAuthority, 'none')
  assert.ok(['stop', 'target', 'modelHorizon'].includes(row.reason))
  assert.equal(row.dataThrough, row.signalDate)
  assert.equal(row.rows, row.adaptiveWindowSpec.visibleRows)
  assert.equal(row.freshness.asOf, row.signalDate)
  assert.equal(row.freshness.basis, 'historical-visible-prefix-as-of-signal-close')
  assert.equal(row.freshness.futureRowsUsed, false)
  assert.ok(row.dataStateReasons.some((reason) => reason.includes('historical-visible-prefix-only')))
  assert.equal(row.provenance.dataThrough, row.signalDate)
  assert.equal(row.provenance.rows, row.rows)
  assert.equal(row.provenance.rowGate.futureRowsUsed, false)
  assertNoDeprecatedFormulaKeys(row, 'structure replay trade')
}

const fixedReplayPayload = runCliJson('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', [
  '--mode',
  'replay',
  '--market',
  'A股',
  '--profile',
  'strict',
  '--format',
  'json',
  '--fee',
  '0',
  '--holding-gate',
  'enforce',
  '--target-mode',
  'fixed',
  '--target',
  '0.03',
  '--min-z',
  '0',
  '--ck-geometry-max',
  '100',
  '--max-hl',
  '10000',
  '--min-slope',
  '-100',
  '--max-slope',
  '100',
  '--min-distance',
  '0',
  '--max-distance',
  '100',
  '--max-entry-gap',
  '100',
  '--min-entry-gap',
  '-100',
  '--max-hold',
  '30',
])
assert.ok(fixedReplayPayload.trades.length > 0, 'fixed-target replay smoke must exercise at least one trade')
for (const row of fixedReplayPayload.trades) {
  assert.match(row.profile, /-fixed-scenario$/)
  assertFourStateRow(row, 'fixed replay trade')
  assert.ok(row.dynamicHolding, 'fixed-target replay must retain dynamic-holding gates')
  assert.notEqual(row.dynamicHolding.phase, 'low-compression', 'fixed-target replay must not execute low-compression')
  assert.equal(
    row.dynamicHolding.targetInputMode,
    'explicit-fixed-return-and-horizon-scenario-with-structural-gates',
    'fixed target must remain behind structural gates',
  )
  assert.equal(row.fixedHorizonApplied, true)
  assert.equal(row.appliedHorizonSessions, 30)
  assert.equal(row.actualHoldSessions <= row.appliedHorizonSessions, true)
  assert.equal(row.executionAuthority, 'none')
  assert.equal(row.dataThrough, row.signalDate)
  assert.equal(row.rows, row.adaptiveWindowSpec.visibleRows)
  assertNoDeprecatedFormulaKeys(row, 'fixed replay trade')
}
assert.equal(fixedReplayPayload.config.profiles[0].minimumGrossReturn, null)
assert.equal(fixedReplayPayload.config.profiles[0].fixedTargetReturn, 0.03)

const explicitGatePayload = runCliJson('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', [
  '--mode',
  'latest',
  '--market',
  '港股',
  '--format',
  'json',
  '--fee',
  '0',
  '--min-rows',
  '24',
])
assert.equal(explicitGatePayload.config.rowGate.mode, 'explicit-scenario')
assert.equal(explicitGatePayload.config.rowGate.source, 'cli:--min-rows')
assert.equal(explicitGatePayload.config.rowGate.explicitMinimumRows, 24)

assert.equal(structureReplayPayload.evidenceSchemaVersion, 'china-stock-selection.evidence.v1')
assert.equal(structureReplayPayload.survivorshipBias.warning, 'universe-is-current-membership-only')
assert.equal(structureReplayPayload.survivorshipBias.pointInTimeMembershipAvailable, false)
assert.equal(structureReplayPayload.claimClasses.survivorshipBias, 'missing-input')
assert.equal(structureReplayPayload.claimClasses.statistics, 'sample-estimate')
assert.match(structureReplayPayload.reproducibility.configHash, /^sha256:[0-9a-f]{64}$/)
assert.match(structureReplayPayload.reproducibility.dataHash, /^sha256:[0-9a-f]{64}$/)
assert.equal(structureReplayPayload.reproducibility.seed, 20260101)
assert.equal(structureReplayPayload.reproducibility.bootstrapSamples, 2000)
assert.equal(structureReplayPayload.evidenceMode, 'historical-replay')
assert.equal(structureReplayPayload.statistics.n, structureReplayPayload.trades.length)
assert.ok(Number.isFinite(structureReplayPayload.statistics.meanPct), 'replay statistics must report a sample mean')
assert.ok(Number.isFinite(structureReplayPayload.statistics.pValue))
assert.ok(
  structureReplayPayload.statistics.bootstrapCI95Pct.lowPct <= structureReplayPayload.statistics.bootstrapCI95Pct.highPct,
  'bootstrap interval must be ordered',
)
assert.equal(structureReplayPayload.benchmarks.buyAndHoldSameHorizon.n, structureReplayPayload.trades.length)
assert.ok(structureReplayPayload.benchmarks.randomEntrySameUniverse.n > 0, 'random-entry benchmark must draw samples')
assert.equal(structureReplayPayload.walkForward.enabled, false)
assert.equal(structureReplayPayload.hypothesis.provided, false)
assert.equal(replayPayload.statistics, null, 'latest mode must not fabricate statistics without returns')
assert.equal(replayPayload.benchmarks, null)
assert.equal(replayPayload.walkForward, null)
assert.equal(replayPayload.evidenceMode, 'latest-observation-only')

const replayLooseArgs = [
  '--market', '港股', '--fee', '0', '--target', '0.0001', '--min-z', '0',
  '--ck-geometry-max', '100', '--max-hl', '10000', '--min-slope', '-100', '--max-slope', '100',
  '--min-distance', '0', '--max-distance', '100', '--max-entry-gap', '100', '--min-entry-gap', '-100',
]
const deterministicPayload = runCliJson('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', [
  '--mode', 'replay', '--profile', 'strict', '--format', 'json', ...replayLooseArgs,
])
assert.equal(
  deterministicPayload.statistics.meanPct,
  structureReplayPayload.statistics.meanPct,
  'identical inputs and seed must reproduce identical statistics',
)
assert.equal(
  deterministicPayload.benchmarks.randomEntrySameUniverse.avgReturnPct,
  structureReplayPayload.benchmarks.randomEntrySameUniverse.avgReturnPct,
  'seeded random-entry benchmark must be reproducible',
)

const walkForwardPayload = runCliJson('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', [
  '--mode', 'replay', '--profile', 'strict', '--format', 'json', '--validate', 'walk-forward',
  '--train-sessions', '200', '--test-sessions', '50', '--step-sessions', '50', '--min-folds', '3',
  ...replayLooseArgs,
])
assert.equal(walkForwardPayload.walkForward.enabled, true)
assert.ok(walkForwardPayload.walkForward.folds.length >= 3, 'walk-forward smoke must produce folds')
assert.equal(walkForwardPayload.walkForward.aggregate.minFoldsSatisfied, true)
assert.ok(walkForwardPayload.walkForward.aggregate.sharedCalendarSessions > 0)
assert.ok(walkForwardPayload.walkForward.aggregate.outOfSampleTrades > 0, 'walk-forward smoke must place trades out of sample')
assert.equal(walkForwardPayload.walkForward.folds[0].fold, 1)
assert.ok(walkForwardPayload.walkForward.folds[0].trainStart < walkForwardPayload.walkForward.folds[0].testStart)
assert.equal(walkForwardPayload.claimClasses.walkForward, 'sample-estimate')
assert.equal(
  walkForwardPayload.walkForward.warnings.filter((warning) => warning.startsWith('insufficient-history')).length,
  0,
  'a supported calendar must not report insufficient history',
)

assertCliFails('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', ['--fee', '0', '--validate', 'bogus'], 'unknown validate')
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  ['--fee', '0', '--mode', 'latest', '--validate', 'walk-forward'],
  'requires --mode replay',
)
assertCliFails('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', ['--fee', '0', '--seed', '1.5'], 'expected an integer')
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  ['--fee', '0', '--hypothesis', 'missing-hypothesis.json'],
  'cannot read',
)

assert.equal(structureReplayPayload.config.holdingGate, 'diagnostic')
assert.match(structureReplayPayload.config.holdingGatePolicy, /^phase-gate-is-diagnostic-only/)
assert.ok(
  structureReplayPayload.trades.length > 0
    && structureReplayPayload.trades.some((row) => row.holdingGateEnforced === false),
  'the default diagnostic gate must keep overridden research samples instead of discarding them',
)
assert.ok(Array.isArray(structureReplayPayload.statistics.byHoldingGateVerdict))
assert.ok(Array.isArray(structureReplayPayload.statistics.byDynamicPhase))
assert.equal(structureReplayPayload.config.execution.slippageModel, 'none-declared')
assert.equal(structureReplayPayload.config.execution.assumptionSource, 'default-none-declared')
assert.match(structureReplayPayload.config.execution.priceLimit.rule, /^A-share board prefix/)
assert.equal(structureReplayPayload.executionAudit.accepted, structureReplayPayload.trades.length)
assert.equal(
  structureReplayPayload.executionAudit.signals,
  structureReplayPayload.executionAudit.accepted + structureReplayPayload.executionAudit['entry-gate-rejected'],
  'the execution audit must account for every emitted signal that passed the research gates',
)

const enforcedReplayPayload = runCliJson('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', [
  '--mode', 'replay', '--profile', 'strict', '--format', 'json', '--holding-gate', 'enforce', ...replayLooseArgs,
])
assert.equal(enforcedReplayPayload.config.holdingGate, 'enforce')
assert.match(enforcedReplayPayload.config.holdingGatePolicy, /^phase-gate-discards-signals/)
assert.ok(
  enforcedReplayPayload.trades.every((row) => row.holdingGateEnforced === true && row.holdingGateVerdict === 'execute'),
  'enforce mode must keep every accepted trade at an execute holding verdict',
)
assert.ok(
  enforcedReplayPayload.trades.length <= structureReplayPayload.trades.length,
  'enforce mode must not accept more trades than diagnostic mode on identical inputs',
)

const slippageReplayPayload = runCliJson('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', [
  '--mode', 'replay', '--profile', 'strict', '--format', 'json', '--slippage-bps', '10', ...replayLooseArgs,
])
assert.equal(slippageReplayPayload.config.execution.slippageModel, 'fixed-bps')
assert.equal(slippageReplayPayload.config.execution.assumptionSource, 'explicit-scenario')
assert.ok(slippageReplayPayload.trades.every((row) => row.slippageRate === 0.001))
assert.ok(
  slippageReplayPayload.trades.every((row) => row.entryFillPrice >= row.entryPrice && row.exitFillPrice <= row.exitPrice),
  'slippage must worsen both fills',
)
assert.ok(
  slippageReplayPayload.statistics.meanPct < structureReplayPayload.statistics.meanPct,
  'slippage must lower the sample mean on identical inputs',
)

const liquidityBlockedPayload = runCliJson('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', [
  '--mode', 'replay', '--profile', 'strict', '--format', 'json', '--min-avg-turnover', '1e15', ...replayLooseArgs,
])
assert.equal(liquidityBlockedPayload.trades.length, 0)
assert.ok(liquidityBlockedPayload.executionAudit['insufficient-liquidity'] > 0)

const participationBlockedPayload = runCliJson('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', [
  '--mode', 'replay', '--profile', 'strict', '--format', 'json',
  '--volume-cap', '0.001', '--order-notional', '1e12', ...replayLooseArgs,
])
assert.equal(participationBlockedPayload.trades.length, 0)
assert.ok(participationBlockedPayload.executionAudit['order-exceeds-volume-cap'] > 0)

assertCliFails(
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  ['--fee', '0', '--holding-gate', 'bogus'],
  'unknown holding-gate',
)
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  ['--fee', '0', '--volume-cap', '0.01'],
  'must be supplied together',
)
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  ['--fee', '0', '--slippage-bps', '10', '--slippage-atr-fraction', '0.1'],
  'mutually exclusive',
)
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  ['--fee', '0', '--slippage-bps', '-1'],
  'expected a non-negative number',
)

assert.equal(structureReplayPayload.riskMetrics.simulationOnly, true)
assert.equal(structureReplayPayload.riskMetrics.points, structureReplayPayload.trades.length)
assert.equal(structureReplayPayload.equityCurve.length, structureReplayPayload.trades.length)
assert.ok(structureReplayPayload.riskMetrics.maxDrawdownPct <= 0)
assert.ok(Number.isFinite(structureReplayPayload.riskMetrics.finalEquity))
assert.equal(
  structureReplayPayload.equityCurve.at(-1).equity,
  structureReplayPayload.riskMetrics.finalEquity,
  'the equity curve must end at the reported final equity',
)
assert.equal(structureReplayPayload.signalDecayHorizonSource, 'default-research-ladder')
assert.deepEqual(
  structureReplayPayload.signalDecay.map((bucket) => bucket.sessions),
  [1, 2, 3, 5, 10, 20],
)
assert.ok(structureReplayPayload.signalDecay.every((bucket) => bucket.n > 0 && Number.isFinite(bucket.avgNetPct)))
assert.equal(structureReplayPayload.sensitivity.enabled, false)
assert.equal(replayPayload.riskMetrics, null, 'latest mode must not fabricate an equity curve without returns')
assert.equal(replayPayload.signalDecay, null)
assert.equal(replayPayload.equityCurve, null)

const sensitivityPayload = runCliJson('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', [
  '--mode', 'replay', '--market', '港股', '--fee', '0', '--format', 'json',
  '--sensitivity', 'thresholds', '--sensitivity-factors', '1.1',
])
assert.equal(sensitivityPayload.sensitivity.enabled, true)
assert.equal(sensitivityPayload.sensitivity.variants.length, 6)
assert.ok(sensitivityPayload.sensitivity.variants.every((variant) => ['ok', 'invalid', 'failed'].includes(variant.status)))
assert.equal(typeof sensitivityPayload.sensitivity.stabilityScoreInterpretable, 'boolean')
assert.equal(sensitivityPayload.sensitivity.tradesToleranceFactor, 2)
assert.equal(sensitivityPayload.sensitivity.byParameter.length, 6)
assert.ok(sensitivityPayload.sensitivity.byParameter.every((entry) => Number.isFinite(entry.baseValue)))
assert.ok(
  sensitivityPayload.sensitivity.warnings.some((warning) => warning.includes('below the 30-trade floor')),
  'a base sample under the floor must be disclosed as non-evidence',
)
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  ['--fee', '0', '--mode', 'latest', '--sensitivity', 'thresholds'],
  'requires --mode replay',
)
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  ['--fee', '0', '--decay-horizons', '1,zero'],
  'expected numbers',
)

console.log('china-stock-selection runtime parity: ok')

function read(path) {
  return readFileSync(new URL(path, new URL(`file://${root}/`)), 'utf8')
}

function resolve(path) {
  return fileURLToPath(new URL(path, new URL(`file://${root}/`)))
}

function assertTokens(source, tokens, label) {
  for (const token of tokens) {
    assert.ok(source.includes(token), `${label} must include ${token}`)
  }
}

function assertCompactTokens(source, tokens, label) {
  const compact = withoutWhitespace(source)
  for (const token of tokens) {
    assert.ok(compact.includes(withoutWhitespace(token)), `${label} must include ${token}`)
  }
}

function assertObjectDefaults(source, constantName, expected) {
  const body = objectLiteral(source, constantName)
  const compact = withoutWhitespace(body)
  for (const [key, value] of Object.entries(expected)) {
    assert.ok(compact.includes(`${key}:${withoutWhitespace(value)}`), `${constantName}.${key} must remain ${value}`)
  }
}

function objectLiteral(source, constantName) {
  const marker = `const ${constantName} =`
  const markerIndex = source.indexOf(marker)
  assert.notEqual(markerIndex, -1, `${constantName} declaration must exist`)
  const start = source.indexOf('{', markerIndex + marker.length)
  assert.notEqual(start, -1, `${constantName} must be an object literal`)

  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  assert.fail(`${constantName} object literal must be closed`)
}

function withoutWhitespace(source) {
  return source.replace(/\s+/g, '')
}

function syntaxCheck(path) {
  const result = spawnSync(process.execPath, ['--check', path], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, `${path} syntax check failed: ${result.stderr || result.stdout}`)
}

function assertCliFails(path, args, expectedMessage) {
  const result = spawnSync(process.execPath, [path, ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  })
  assert.notEqual(result.status, 0, `${path} ${args.join(' ')} must fail`)
  assert.match(
    `${result.stderr}${result.stdout}`,
    new RegExp(escapeRegExp(expectedMessage)),
    `${path} ${args.join(' ')} must report ${expectedMessage}`,
  )
}

function runCliJson(path, args) {
  const result = spawnSync(process.execPath, [path, ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  })
  assert.equal(result.status, 0, `${path} JSON smoke failed: ${result.stderr || result.stdout}`)
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    assert.fail(`${path} must emit valid JSON: ${error.message}`)
  }
}

function assertStateContract(contract, label) {
  assert.deepEqual(
    Object.keys(contract),
    ['dataState', 'scoreStatus', 'candidateStatus', 'executionStatus'],
    `${label} must declare four separate states`,
  )
  for (const values of Object.values(contract)) {
    assert.ok(Array.isArray(values) && values.length > 0, `${label} state enum must be non-empty`)
  }
}

function assertFourStateRow(row, label) {
  for (const field of ['dataState', 'scoreStatus', 'candidateStatus', 'executionStatus']) {
    assert.ok(Object.hasOwn(row, field), `${label} must include ${field}`)
  }
  assert.notEqual(row.dataState, row.scoreStatus, `${label} must not conflate data and score state`)
}

function assertClaimClasses(claimClasses, label) {
  assert.ok(claimClasses && typeof claimClasses === 'object', `${label} must include claimClasses`)
  assert.ok(Object.keys(claimClasses).length > 0, `${label} claimClasses must be non-empty`)
  for (const [claim, claimClass] of Object.entries(claimClasses)) {
    assert.ok(CLAIM_CLASS_ENUM.has(claimClass), `${label}.${claim} has invalid claim class ${claimClass}`)
  }
}

function assertClaimClassContract(contract, label) {
  assert.deepEqual(
    contract?.allowedValues,
    [...CLAIM_CLASS_ENUM],
    `${label} must expose the complete five-value claim-class enum`,
  )
}

function assertNoDeprecatedFormulaKeys(value, label, path = '') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoDeprecatedFormulaKeys(item, label, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  const forbidden = new Set([
    'delta',
    'gamma',
    'thetaPerSession',
    'rho',
    'theta',
    'halfLifeDays',
    'modelHorizonDays',
    'signalModelHorizonDays',
    'appliedHorizonDays',
    'fixedHorizonDays',
    'deviationHorizonDays',
    'entryDeviationHorizonDays',
    'holdDays',
    'holdingDays',
    'expectedDays',
    'executableDays',
    'firstRepairDays',
    'baseAnchorDays',
    'stretchDays',
    'partialRecoveryDays',
    'executableHoldingDays',
    'minExecutableDays',
    'maxHoldingDays',
    'daysToZExit',
    'returnPerDayPct',
    'monthlyEfficiencyPct',
    'lookbackDays',
    'peakDays',
    'troughDays',
    'drawdownSpeed5',
    'drawdownSpeed20',
    'legacyAliases',
  ])
  for (const [key, item] of Object.entries(value)) {
    assert.equal(forbidden.has(key), false, `${label} must not emit deprecated key ${path ? `${path}.` : ''}${key}`)
    assertNoDeprecatedFormulaKeys(item, label, path ? `${path}.${key}` : key)
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
