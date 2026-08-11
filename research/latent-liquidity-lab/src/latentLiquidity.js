import { buildAdaptiveMarketStatePath } from './adaptiveMarketState.js'
import { requireTradingDaysPerYear } from './tradingTime.js'

export const DEFAULT_LATENT_LIQUIDITY_CONFIG = Object.freeze({})

export const LATENT_LIQUIDITY_SCOPE = Object.freeze({
  claimClass: 'sample-estimate',
  signalTime: 'T 日收盘后',
  earliestExecution: 'T+1 开盘后',
  executionStatus: 'research-only',
  excludes: ['做市商/主力账户身份', '真实库存', '真实成本', '逐笔成交方向', '盘口深度', '实际成交与交易费用'],
})

/**
 * Causal path with sample-size-derived windows.  Appending future rows cannot
 * change a historical state because every window depends only on that prefix.
 */
export function buildLatentLiquidityPath(rows, input = {}) {
  const config = normalizeConfig(input)
  if (!Array.isArray(rows) || rows.length === 0) return []
  const marketPath = buildAdaptiveMarketStatePath(rows, config.tradingDaysPerYear)
  const measurements = buildMeasurements(rows, marketPath)
  return rows.map((row, index) =>
    classifyLatentLiquidityAt({
      rows,
      index,
      marketPath,
      config,
      row,
      measurements: measurements[index],
    }),
  )
}

export function classifyLatentLiquidityAt({
  rows,
  index,
  marketPath = null,
  config: rawConfig = {},
  row = null,
  measurements = null,
} = {}) {
  const config = normalizeConfig(rawConfig)
  const current = row ?? rows?.[index]
  if (!Array.isArray(rows) || !current || !Number.isInteger(index) || index < 1) {
    return insufficientState(index)
  }

  const causalPath = marketPath ?? buildAdaptiveMarketStatePath(rows.slice(0, index + 1), config.tradingDaysPerYear)
  const market = causalPath[index] ?? causalPath.at(-1)
  const priorMarket = causalPath[index - 1]
  const previous = rows[index - 1]
  if (market?.status !== 'ok' || !previous || !validRow(current) || !validRow(previous)) {
    return insufficientState(index, market)
  }

  const currentMeasurements = measurements ?? measurementAt(rows, causalPath, index)
  const {
    medianVolume,
    medianRange,
    todayRange,
    closeLocation,
    closeLocationCenter,
    volumeSurprise,
    rangeSurprise,
    flowEvidence,
  } = currentMeasurements
  const belowBand = current.close < market.costLow
  const aboveBand = current.close > market.costHigh
  const positiveCloseResponse = closeLocation >= closeLocationCenter
  const responseEvidence = belowBand
    ? positiveCloseResponse
      ? 'discount-positive-response'
      : 'discount-negative-response'
    : aboveBand
      ? positiveCloseResponse
        ? 'premium-positive-response'
        : 'premium-negative-response'
      : 'inside-band'
  const volumeExpansion = Number.isFinite(volumeSurprise) && volumeSurprise >= 1
  const priorCostSlope = priorMarket?.status === 'ok' ? priorMarket.costSlope : 0
  const absorptionBelow = belowBand && volumeExpansion && positiveCloseResponse && priorCostSlope >= 0
  const absorptionAbove = aboveBand && volumeExpansion && !positiveCloseResponse && priorCostSlope <= 0
  const repriceDown = belowBand && volumeExpansion && !positiveCloseResponse && market.costSlope < 0 && !absorptionBelow
  const repriceUp = aboveBand && volumeExpansion && positiveCloseResponse && market.costSlope > 0 && !absorptionAbove
  const state = absorptionBelow
    ? 'absorption-below-band'
    : absorptionAbove
      ? 'absorption-above-band'
      : repriceDown
        ? 'reprice-down'
        : repriceUp
          ? 'reprice-up'
          : 'neutral'

  const volumeEvidence = Number.isFinite(volumeSurprise) && volumeSurprise > 0 ? Math.log(volumeSurprise) : null
  const stateStrength = Number.isFinite(volumeEvidence)
    ? Math.abs(closeLocation - closeLocationCenter) * 2 * Math.max(0, volumeEvidence)
    : null
  return {
    status: 'ok',
    state,
    signalDate: current.date,
    signalIndex: index,
    claimClass: LATENT_LIQUIDITY_SCOPE.claimClass,
    executionStatus: LATENT_LIQUIDITY_SCOPE.executionStatus,
    action: state === 'neutral' ? actionForResponseEvidence(responseEvidence) : actionForState(state),
    costAnchor: market.costAnchor,
    costLow: market.costLow,
    costHigh: market.costHigh,
    costDistance: market.costDistance,
    costSlope: market.costSlope,
    priorCostSlope,
    annualVol: market.annualVol,
    zScore: null,
    belowBand,
    aboveBand,
    responseEvidence,
    closeLocation,
    closeLocationCenter,
    volumeSurprise,
    rangeSurprise,
    flowEvidence,
    stateStrength,
    adaptiveWindows: market.windows,
    inputs: {
      medianVolume,
      medianRange,
      todayRange,
      currentVolume: current.volume,
    },
    missingInputs: LATENT_LIQUIDITY_SCOPE.excludes,
  }
}

/**
 * Legacy test helper for any explicitly supplied horizon.  The primary
 * protocol never calls this function and never supplies a fixed horizon.
 */
export function buildForwardOutcome(rows, state, input = {}) {
  const horizon = positiveInteger(input.horizon, null)
  if (!horizon) return null
  if (!Array.isArray(rows) || !state || state.status !== 'ok') return null
  const index = state.signalIndex
  const entryRow = rows[index + 1]
  const terminal = rows[index + horizon]
  if (!entryRow || !terminal || !validRow(entryRow) || !validRow(terminal) || entryRow.open <= 0) return null
  const path = rows.slice(index + 1, index + horizon + 1)
  const entryPrice = entryRow.open
  const terminalReturn = terminal.close / entryPrice - 1
  const maxFavorableReturn = Math.max(...path.map((item) => item.high / entryPrice - 1))
  const maxAdverseReturn = Math.min(...path.map((item) => item.low / entryPrice - 1))
  const halfAnchorTarget = entryPrice + 0.5 * (state.costAnchor - entryPrice)
  const longTargetAvailable = state.costAnchor > entryPrice
  const longTargetHit = longTargetAvailable && path.some((item) => item.high >= halfAnchorTarget)
  const expectedDirection = expectedDirectionForState(state.state)
  const directionalReturn = expectedDirection * terminalReturn
  const usesFrozenAnchorTarget = [
    'absorption-below-band',
    'cost-band-below',
    'z-discount',
    'volume-shock-below',
  ].includes(state.state)
  const success = usesFrozenAnchorTarget
    ? longTargetAvailable
      ? longTargetHit
      : null
    : expectedDirection > 0
      ? terminalReturn > 0
      : terminalReturn < 0

  return {
    entryDate: entryRow.date,
    entryPrice,
    terminalDate: terminal.date,
    resolutionDate: terminal.date,
    terminalReturn,
    directionalReturn,
    maxFavorableReturn,
    maxAdverseReturn,
    halfAnchorTarget: longTargetAvailable ? halfAnchorTarget : null,
    longTargetAvailable,
    longTargetHit: longTargetAvailable ? longTargetHit : null,
    expectedDirection,
    success,
  }
}

export function expectedDirectionForState(state) {
  return ['absorption-below-band', 'reprice-up', 'cost-band-below', 'z-discount', 'volume-shock-below'].includes(state)
    ? 1
    : -1
}

export function actionForState(state) {
  switch (state) {
    case 'absorption-below-band':
      return '观察反转，等待下一交易日确认；不是买入指令'
    case 'reprice-down':
      return '下行重定价风险，暂停新增多头；不是卖出指令'
    case 'absorption-above-band':
      return '上方承接转弱，检查已有仓位风险；不是做空指令'
    case 'reprice-up':
      return '上行重定价，观察延续或回踩；不是追涨指令'
    default:
      return '无明确流动性压力状态'
  }
}

function actionForResponseEvidence(evidence) {
  switch (evidence) {
    case 'discount-positive-response':
      return '折价日内收盘反应偏正，记录为支持证据；等待下一交易日确认，不是买入指令'
    case 'discount-negative-response':
      return '折价日内收盘反应偏负，记录为冲突证据；暂停把成本带当作支撑'
    case 'premium-negative-response':
      return '溢价日内收盘反应偏负，检查已有仓位风险；不是做空指令'
    case 'premium-positive-response':
      return '溢价日内收盘反应偏正，观察重定价；不是追涨指令'
    default:
      return '无明确流动性压力状态'
  }
}

function buildMeasurements(rows, marketPath) {
  const daily = rows.map((_, index) => measurementAt(rows, marketPath, index))
  const contributions = daily.map((item, index) => {
    const row = rows[index]
    const anchor = marketPath[index]?.costAnchor
    if (
      !Number.isFinite(anchor) ||
      row.close >= anchor ||
      !Number.isFinite(item.volumeSurprise) ||
      item.volumeSurprise <= 0
    ) {
      return 0
    }
    return Math.max(0, Math.log(item.volumeSurprise)) * (item.closeLocation - item.closeLocationCenter) * 2
  })
  return daily.map((item, index) => {
    const localWindowSamples = marketPath[index]?.windows?.localWindowSamples ?? 0
    return {
      ...item,
      flowEvidence: contributions
        .slice(Math.max(0, index - localWindowSamples + 1), index + 1)
        .reduce((sum, value) => sum + value, 0),
    }
  })
}

function measurementAt(rows, marketPath, index) {
  const current = rows[index]
  const previous = rows[index - 1]
  const localWindowSamples = marketPath[index]?.windows?.localWindowSamples ?? 0
  if (!current || !previous || localWindowSamples <= 0) return emptyMeasurements()
  const prior = rows.slice(Math.max(0, index - localWindowSamples), index)
  const priorVolumes = prior.map((item) => item.volume)
  const rangeStart = Math.max(1, index - localWindowSamples)
  const priorRanges = rows
    .slice(rangeStart, index)
    .map((item, offset) => trueRange(item, rows[rangeStart + offset - 1]))
    .filter((value) => Number.isFinite(value) && value > 0)
  const priorCloseLocations = prior.map(closeLocationOf).filter(Number.isFinite)
  const medianVolume = median(priorVolumes)
  const medianRange = median(priorRanges)
  const closeLocationCenter = median(priorCloseLocations) ?? 0.5
  const todayRange = trueRange(current, previous)
  const closeLocation = closeLocationOf(current) ?? closeLocationCenter
  return {
    medianVolume,
    medianRange,
    todayRange,
    closeLocation,
    closeLocationCenter,
    volumeSurprise: medianVolume > 0 ? current.volume / medianVolume : null,
    rangeSurprise: medianRange > 0 ? todayRange / medianRange : null,
    flowEvidence: null,
  }
}

function closeLocationOf(row) {
  if (!validRow(row)) return null
  return row.high > row.low ? (row.close - row.low) / (row.high - row.low) : 0.5
}

function emptyMeasurements() {
  return {
    medianVolume: null,
    medianRange: null,
    todayRange: null,
    closeLocation: 0.5,
    closeLocationCenter: 0.5,
    volumeSurprise: null,
    rangeSurprise: null,
    flowEvidence: null,
  }
}

function insufficientState(index, market = null) {
  return {
    status: 'insufficient-history',
    state: 'insufficient-history',
    signalIndex: index ?? null,
    claimClass: 'missing-input',
    executionStatus: 'blocked',
    requiredCondition: market?.requiredCondition ?? 'adaptive state not ready',
    adaptiveWindows: market?.windows ?? null,
    missingInputs: LATENT_LIQUIDITY_SCOPE.excludes,
  }
}

function normalizeConfig(input) {
  return {
    ...DEFAULT_LATENT_LIQUIDITY_CONFIG,
    ...input,
    tradingDaysPerYear: requireTradingDaysPerYear(input.tradingDaysPerYear, 'latent-liquidity query'),
  }
}

function trueRange(row, previous) {
  if (!validRow(row) || !validRow(previous)) return Number.NaN
  return Math.max(row.high - row.low, Math.abs(row.high - previous.close), Math.abs(row.low - previous.close))
}

function median(values) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!valid.length) return null
  const middle = Math.floor(valid.length / 2)
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2
}

function validRow(row) {
  return [row?.open, row?.high, row?.low, row?.close, row?.volume].every(Number.isFinite)
}

function positiveInteger(value, fallback) {
  const number = Math.floor(Number(value))
  return Number.isFinite(number) && number > 0 ? number : fallback
}
