import { existsSync, readFileSync } from 'node:fs'
import { uniswapV3Inventory } from '../../../../src/domain/formulas/core.js'

export const CLAIM_CLASS_CONTRACT = Object.freeze({
  allowedValues: Object.freeze([
    'exact-identity',
    'sample-estimate',
    'calibrated-estimate',
    'scenario-proxy',
    'missing-input',
  ]),
})

export function loadNameMap(path) {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.warn(`cannot read stock name map ${path}: ${error.message}`)
    return {}
  }
}

export function resolveInstrumentName(entry, nameMap) {
  const symbol = String(entry.symbol ?? '')
  const mapped = nameMap[symbol] ?? nameMap[symbol.replace('.HK', '_HK')]
  if (mapped?.name) return { name: mapped.name, source: mapped.source ?? 'local-name-map' }
  const label = String(entry.label ?? '')
  const unresolved = !label || label === symbol || label === symbol.replace('.HK', '_HK')
  return { name: unresolved ? symbol : label, source: unresolved ? 'unresolved-local-index' : 'stock-index' }
}

export const SYNTHETIC_CK_GEOMETRY_DISCLOSURE = Object.freeze({
  model: 'synthetic-ck-uniswap-v3-geometry',
  inputMode: 'synthetic',
  liquidity: 1,
  rangeRule: 'ATR-derived symmetric range around the rolling cost anchor',
  normalizationRule: 'unit-liquidity value divided by the same synthetic range valued at its rolling cost anchor',
  interpretation: 'dimensionless geometry diagnostic relative to the rolling-anchor reference',
  limitation: 'not a real LP position, token holding, fee income, or investment return',
})

export function buildSyntheticCkGeometryState(market, row) {
  if (!market || !row || !Number.isFinite(market.costAnchor) || market.costAnchor <= 0) return null
  if (!Number.isFinite(row.close) || row.close <= 0) return null

  const rangeWidth = Math.min(Math.max(market.atrPercent ?? 0.05, 0.03), 0.5)
  const lowerPrice = market.costAnchor * Math.max(1 - rangeWidth, 0.001)
  const upperPrice = market.costAnchor * (1 + rangeWidth)
  const geometry = uniswapV3Inventory({
    markPrice: row.close,
    lowerPrice,
    upperPrice,
    liquidity: SYNTHETIC_CK_GEOMETRY_DISCLOSURE.liquidity,
  })
  const anchorReference = uniswapV3Inventory({
    markPrice: market.costAnchor,
    lowerPrice,
    upperPrice,
    liquidity: SYNTHETIC_CK_GEOMETRY_DISCLOSURE.liquidity,
  })
  if (!Number.isFinite(geometry?.value) || !Number.isFinite(anchorReference?.value) || anchorReference.value <= 0) return null

  return {
    model: SYNTHETIC_CK_GEOMETRY_DISCLOSURE.model,
    inputMode: SYNTHETIC_CK_GEOMETRY_DISCLOSURE.inputMode,
    normalizedValue: geometry.value / anchorReference.value,
    unitLiquidityValue: geometry.value,
    anchorReferenceValue: anchorReference.value,
    region: geometry.zone,
    lowerPrice,
    upperPrice,
    rangeWidth,
    rangeWidthPct: rangeWidth * 100,
  }
}

export function isPositiveMonotonicMeanReversion(meanReversion) {
  const arCoefficient = meanReversion?.arCoefficient
  const halfLifeSessions = meanReversion?.halfLifeSessions
  return meanReversion?.isMeanReverting === true &&
    meanReversion?.decayMode === 'monotonic-decay' &&
    Number.isFinite(arCoefficient) &&
    arCoefficient > 0 &&
    arCoefficient < 1 &&
    Number.isFinite(halfLifeSessions) &&
    halfLifeSessions > 0
}

export function deriveAdaptiveWindowSpec({ tradingDaysPerYear, visibleRows }) {
  const prefixRows = Math.max(0, Math.floor(Number(visibleRows) || 0))
  const parsedTdpy = Number(tradingDaysPerYear)
  if (!Number.isFinite(parsedTdpy) || parsedTdpy <= 0) {
    return {
      mode: 'missing-input',
      source: 'missing-input:tradingDaysPerYear',
      tradingDaysPerYear: null,
      visibleRows: prefixRows,
      minimumRequiredRows: null,
      analysisWindowRows: null,
      ckGeometryRankWindowRows: null,
      empiricalDeviationWindowRows: null,
      meanReversionWindowRows: null,
      vixFixWindowRows: null,
      scenarioHorizonSessions: null,
      status: 'missing-input',
      missingInputs: ['tradingDaysPerYear'],
      causal: true,
      futureRowsUsed: false,
    }
  }
  const tdpy = Math.max(1, Math.floor(parsedTdpy))
  const minimumRequiredRows = Math.max(3, Math.ceil(Math.sqrt(tdpy)))
  const analysisWindowRows = prefixRows > 0
    ? Math.min(prefixRows, Math.max(minimumRequiredRows, Math.ceil(Math.sqrt(tdpy * prefixRows))))
    : 0
  const scenarioHorizonSessions = prefixRows > 0
    ? Math.max(1, Math.min(prefixRows, Math.ceil(Math.sqrt(prefixRows))))
    : null

  return {
    mode: 'adaptive-tdpy-visible-prefix',
    source: 'formula:sqrt(tradingDaysPerYear),sqrt(tradingDaysPerYear*visibleRows),sqrt(visibleRows)',
    tradingDaysPerYear: tdpy,
    visibleRows: prefixRows,
    minimumRequiredRows,
    analysisWindowRows,
    ckGeometryRankWindowRows: analysisWindowRows,
    empiricalDeviationWindowRows: analysisWindowRows,
    meanReversionWindowRows: analysisWindowRows,
    vixFixWindowRows: analysisWindowRows,
    scenarioHorizonSessions,
    status: 'formula-derived',
    missingInputs: [],
    causal: true,
    futureRowsUsed: false,
  }
}

const SESSION_FIELD_NAMES = Object.freeze({
  halfLifeDays: 'halfLifeSessions',
  modelHorizonDays: 'modelHorizonSessions',
  expectedDays: 'expectedSessions',
  executableDays: 'executableSessions',
  firstRepairDays: 'firstRepairSessions',
  baseAnchorDays: 'baseAnchorSessions',
  stretchDays: 'stretchSessions',
  partialRecoveryDays: 'partialRecoverySessions',
  executableHoldingDays: 'executableHoldingSessions',
  minExecutableDays: 'minExecutableSessions',
  maxHoldingDays: 'maxHoldingSessions',
  daysToZExit: 'sessionsToZExit',
  lookbackDays: 'lookbackSessions',
  peakDays: 'peakSessions',
  troughDays: 'troughSessions',
  returnPerDayPct: 'returnPerSessionPct',
})

/**
 * Domain formula objects still expose a few compatibility aliases. Skill JSON is a
 * new machine contract, so keep only canonical session names and omit legacy aliases.
 */
export function canonicalizeFormulaSessionFields(value) {
  if (Array.isArray(value)) return value.map(canonicalizeFormulaSessionFields)
  if (!value || typeof value !== 'object') return value

  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'legacyAliases') continue
    if (key === 'drawdownSpeed5' || key === 'drawdownSpeed20') continue
    if (key === 'monthlyEfficiencyPct') continue
    const canonicalKey = SESSION_FIELD_NAMES[key] ?? key
    if (Object.hasOwn(out, canonicalKey) && SESSION_FIELD_NAMES[key]) continue
    out[canonicalKey] = canonicalizeFormulaSessionFields(item)
  }
  return out
}

export function empiricalDeviationStats(values, current) {
  const valid = Array.isArray(values) ? values.filter(Number.isFinite) : []
  if (!valid.length || !Number.isFinite(current)) return null

  const lowerCount = valid.filter((value) => value <= current).length
  const upperCount = valid.filter((value) => value >= current).length
  const lowerTail = lowerCount / valid.length
  const upperTail = upperCount / valid.length
  return {
    current,
    sampleSize: valid.length,
    percentilePct: lowerTail * 100,
    lowerTailPct: lowerTail * 100,
    upperTailPct: upperTail * 100,
    twoSidedTailPct: Math.min(1, 2 * Math.min(lowerTail, upperTail)) * 100,
    interpretation: 'empirical historical rank and tail share; not a probability of mean reversion',
  }
}

export function scoreFreshnessEvidence({ staleDays, totalRows, tradingDaysPerYear, minimumRequiredRows }) {
  if (![staleDays, totalRows, tradingDaysPerYear, minimumRequiredRows].every(Number.isFinite)) return null
  if (staleDays < 0 || totalRows < 0 || tradingDaysPerYear <= 0 || minimumRequiredRows <= 0) return null
  const freshnessScore = staleDays > 10 ? 0 : 5
  const evidenceRatio = totalRows / minimumRequiredRows
  const annualCoverage = totalRows / tradingDaysPerYear
  const evidenceDepthScore = Math.min(3, Math.max(0, Math.floor(Math.log2(Math.max(evidenceRatio, 1)))))
  const annualCoverageScore = Math.min(2, Math.max(0, Math.floor(Math.sqrt(annualCoverage))))
  return {
    score: freshnessScore + evidenceDepthScore + annualCoverageScore,
    freshnessScore,
    evidenceDepthScore,
    annualCoverageScore,
    staleThresholdDays: 10,
    evidenceRatio,
    annualCoverage,
    claimClass: 'scenario-proxy',
  }
}
