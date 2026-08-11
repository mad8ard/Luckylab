import { blockBootstrapComparison } from './blockBootstrap.js'
import { DEFAULT_CYCLE_HORIZON_CONFIG, buildDynamicCycleOutcome, deriveCycleHorizonAt } from './cycleHorizon.js'
import { nextNonOverlappingSignalIndex } from './eventScheduling.js'
import { buildLatentLiquidityPath } from './latentLiquidity.js'
import { requireTradingDaysPerYear } from './tradingTime.js'
import {
  difference,
  distribution,
  groupBy,
  mean,
  median,
  numericValues,
  quantile,
  wilsonInterval,
} from './validationStatistics.js'

export { wilsonInterval } from './validationStatistics.js'

export const DEFAULT_VALIDATION_PROTOCOL = Object.freeze({
  cycle: DEFAULT_CYCLE_HORIZON_CONFIG,
})

export function evaluateLatentLiquidityUniverse(instruments, input = {}) {
  const protocol = normalizeProtocol(input)
  const usable = Array.isArray(instruments) ? instruments.filter(validInstrument) : []
  const dynamic = evaluateDynamicCycle(usable, protocol)
  return {
    status: usable.length ? 'ok' : 'missing-input',
    claimClass: 'sample-estimate',
    executionStatus: 'research-only',
    protocol: {
      ...protocol,
      signalTime: 'T 日收盘后',
      entryRule: '最早 T+1 开盘，仅用于历史评估',
      holdingRule: '每个事件使用 H_t=ceil(HL_t*log2(1/(1-q)))，无固定期长',
      fixedHorizonApplied: false,
      targetContext: 'T 日冻结成本锚、costLower 目标与 AR 系数；q/H 到 T+1 开盘才可计算',
      horizonReporting: '仅报告公式 H_t 的连续分布与样本自适应分位组',
      classifierParameters: '价量窗口由每个时点的 prefix sample size 自动推导，不使用固定日历周期',
      calibration: '仅消费在当前信号日前已经完整走完自身 H_i 的事件',
      perSymbolEmbargo: '同标的下一事件必须晚于前一事件的 T+1+H_i 路径',
    },
    coverage: {
      instrumentsRequested: Array.isArray(instruments) ? instruments.length : 0,
      instrumentsUsed: usable.length,
      sourceLimitation: '当前静态股票池；存在覆盖、幸存者与复权点时性偏差，不能外推为全市场总体。',
    },
    dynamic,
    // Compatibility alias for readers that previously expected a primary
    // result. It is dynamic-cycle output, not a fixed-horizon result.
    primary: dynamic,
  }
}

export function attachPrequentialCalibration(events) {
  const ordered = [...events].sort(
    (a, b) =>
      a.signalDate.localeCompare(b.signalDate) || a.symbol.localeCompare(b.symbol) || a.model.localeCompare(b.model),
  )
  const dateGroups = groupBy(ordered, (event) => event.signalDate)
  const history = new Map()
  const pending = []
  const calibrated = []

  for (const [date, group] of dateGroups) {
    let cursor = 0
    while (cursor < pending.length) {
      const candidate = pending[cursor]
      if (candidate.resolutionDate >= date) {
        cursor += 1
        continue
      }
      pending.splice(cursor, 1)
      if (typeof candidate.success !== 'boolean') continue
      const bucket = history.get(candidate.model) ?? { samples: 0, successes: 0 }
      bucket.samples += 1
      bucket.successes += candidate.success ? 1 : 0
      history.set(candidate.model, bucket)
    }
    for (const event of group) {
      const bucket = history.get(event.model) ?? { samples: 0, successes: 0 }
      const posteriorMean = (bucket.successes + 1) / (bucket.samples + 2)
      calibrated.push({
        ...event,
        calibration: {
          priorSamples: bucket.samples,
          priorSuccesses: bucket.successes,
          posteriorMean,
          wilsonLower: wilsonInterval(bucket.successes, bucket.samples).lower,
          status: bucket.samples > 0 ? 'prequential-sample-estimate' : 'insufficient-history',
        },
      })
    }
    pending.push(...group)
  }
  return calibrated
}

function evaluateDynamicCycle(instruments, protocol) {
  const events = []
  const cycleForecasts = []
  const dateUniverse = new Set()
  const skippedCounts = new Map()
  let matureSignals = 0
  for (const instrument of instruments) {
    const config = {
      tradingDaysPerYear: protocol.cycle.tradingDaysPerYear,
    }
    const path = buildLatentLiquidityPath(instrument.rows, config)
    let nextAllowedIndex = 1
    for (let index = 1; index < instrument.rows.length - 1; index += 1) {
      const state = path[index]
      if (state?.status !== 'ok' || !state.belowBand) continue
      if (index < nextAllowedIndex) {
        increment(skippedCounts, 'overlapping-formula-cycle')
        continue
      }
      const cycle = deriveCycleHorizonAt({
        rows: instrument.rows,
        statePath: path,
        index,
        input: protocol.cycle,
      })
      if (!cycle.eligible) {
        for (const reason of cycle.reasons) increment(skippedCounts, reason)
        continue
      }
      cycleForecasts.push(cycle)
      const outcome = buildDynamicCycleOutcome(instrument.rows, state, cycle)
      if (!outcome || outcome.status !== 'mature') {
        increment(skippedCounts, outcome?.reason ?? 'invalid-cycle-outcome')
        if (outcome?.status === 'right-censored') {
          nextAllowedIndex = instrument.rows.length
        }
        continue
      }

      matureSignals += 1
      nextAllowedIndex = nextNonOverlappingSignalIndex(outcome.terminalIndex)
      dateUniverse.add(state.signalDate)
      if (['absorption-below-band', 'reprice-down'].includes(state.state)) {
        addEvent(events, instrument, state, cycle, outcome, `latent:${state.state}`)
      }
      addEvent(events, instrument, state, cycle, outcome, 'baseline:cost-band-below')
      addEvent(events, instrument, state, cycle, outcome, `evidence:${state.responseEvidence}`)
      if (state.volumeSurprise >= 1) {
        addEvent(events, instrument, state, cycle, outcome, 'baseline:volume-shock-below')
      }
    }
  }

  const calibratedEvents = attachPrequentialCalibration(events)
  const eventGroups = groupBy(calibratedEvents, (event) => event.model)
  const groups = summarizeGroupedEvents(eventGroups)
  const yearly = summarizeSlices(calibratedEvents, (event) => event.year)
  const comparisons = comparePrespecifiedGroups(groups, eventGroups, [...dateUniverse].sort())
  return {
    horizonMode: 'formula-derived-per-event',
    fixedHorizonApplied: false,
    events: calibratedEvents,
    groups,
    yearly,
    byFormulaHorizonQuantile: summarizeAdaptiveHorizonQuantiles(calibratedEvents),
    horizonDistribution: summarizeCycles(cycleForecasts),
    comparisons,
    promotion: assessPromotion(groups, yearly, comparisons),
    coverage: {
      instruments: instruments.length,
      formulaEligibleSignals: cycleForecasts.length,
      matureSignals,
      eventRows: calibratedEvents.length,
      skippedCounts: Object.fromEntries([...skippedCounts].sort()),
    },
  }
}

function addEvent(events, instrument, state, cycle, outcome, model) {
  const isReprice = model === 'latent:reprice-down'
  events.push({
    model,
    state: state.state,
    symbol: instrument.symbol,
    label: instrument.label ?? instrument.symbol,
    market: instrument.market ?? '',
    signalDate: state.signalDate,
    year: state.signalDate.slice(0, 4),
    cyclePhase: cycle.phase,
    halfLifeSessions: cycle.halfLifeSessions,
    arCoefficient: cycle.arCoefficient,
    formulaVersion: cycle.formulaVersion,
    recoveryFraction: cycle.recoveryFraction,
    recurrenceRadius: cycle.recurrence?.recurrenceRadius ?? null,
    recurrencePeriodSessions: cycle.recurrence?.recurrencePeriodSessions ?? null,
    recurrenceHorizonRatio: cycle.recurrenceComparison?.horizonRatio ?? null,
    recurrenceEmpiricalRadiusRank: cycle.recurrence?.empiricalRadiusRank ?? null,
    recurrenceOutOfDistributionRank: cycle.recurrence?.empiricalRadiusRank ?? null,
    ckSkewAlpha: cycle.ckGeometry?.skewAlpha ?? null,
    ckRangeWidth: cycle.ckGeometry?.geometry?.ckRangeWidth ?? null,
    ckEndpointFourthRoot: cycle.ckGeometry?.geometry?.endpointFourthRoot ?? null,
    ...outcome,
    directionalReturn: isReprice ? -outcome.terminalReturn : outcome.terminalReturn,
    success: isReprice ? null : outcome.success,
  })
}

function summarizeGroupedEvents(grouped) {
  return Object.fromEntries([...grouped].map(([model, group]) => [model, summarizeEvents(group)]))
}

function summarizeSlices(events, selector) {
  const byModel = groupBy(events, (event) => event.model)
  return Object.fromEntries(
    [...byModel].map(([model, group]) => {
      const slices = groupBy(group, selector)
      return [model, Object.fromEntries([...slices].map(([key, values]) => [key, summarizeEvents(values)]))]
    }),
  )
}

export function summarizeEvents(events) {
  const successful = events.filter((event) => typeof event.success === 'boolean')
  const calibrated = successful.filter((event) => event.calibration?.priorSamples > 0)
  const successes = successful.filter((event) => event.success).length
  const horizons = numericValues(events, 'modelHorizonSessions')
  const recoveryErrors = numericValues(events, 'recoveryFractionError')
  return {
    signals: events.length,
    signalDates: new Set(events.map((event) => event.signalDate)).size,
    symbols: new Set(events.map((event) => event.symbol)).size,
    meanTerminalReturn: mean(numericValues(events, 'terminalReturn')),
    medianTerminalReturn: median(numericValues(events, 'terminalReturn')),
    meanDirectionalReturn: mean(numericValues(events, 'directionalReturn')),
    medianDirectionalReturn: median(numericValues(events, 'directionalReturn')),
    meanMaxFavorableReturn: mean(numericValues(events, 'maxFavorableReturn')),
    meanMaxAdverseReturn: mean(numericValues(events, 'maxAdverseReturn')),
    meanRealisedRecoveryFraction: mean(numericValues(events, 'realisedRecoveryFraction')),
    meanRecoveryFractionError: mean(recoveryErrors),
    medianRecoveryFractionError: median(recoveryErrors),
    meanModelHorizonSessions: mean(horizons),
    medianModelHorizonSessions: median(horizons),
    minModelHorizonSessions: horizons.length ? Math.min(...horizons) : null,
    maxModelHorizonSessions: horizons.length ? Math.max(...horizons) : null,
    meanFirstHitHoldingSessions: mean(numericValues(events, 'firstHitHoldingSessions')),
    successSamples: successful.length,
    successes,
    successRate: successful.length ? successes / successful.length : null,
    successInterval: wilsonInterval(successes, successful.length),
    prequential: summarizeCalibration(calibrated),
  }
}

function summarizeCalibration(events) {
  if (!events.length) return { samples: 0, brierScore: null, averagePosterior: null }
  const brier =
    events.reduce((sum, event) => sum + Math.pow(event.calibration.posteriorMean - Number(event.success), 2), 0) /
    events.length
  return {
    samples: events.length,
    brierScore: brier,
    averagePosterior: mean(events.map((event) => event.calibration.posteriorMean)),
  }
}

function summarizeCycles(cycles) {
  const horizons = cycles.map((cycle) => cycle.modelHorizonSessions).filter(Number.isFinite)
  const recoveryFractions = cycles.map((cycle) => cycle.recoveryFraction).filter(Number.isFinite)
  const recurrencePeriods = cycles.map((cycle) => cycle.recurrence?.recurrencePeriodSessions).filter(Number.isFinite)
  const skewAlphas = cycles.map((cycle) => cycle.ckGeometry?.skewAlpha).filter(Number.isFinite)
  const ckAlphaMinimumEss = cycles
    .map((cycle) =>
      Math.min(
        cycle.ckGeometry?.positiveEffectiveSamples ?? Number.NaN,
        cycle.ckGeometry?.negativeEffectiveSamples ?? Number.NaN,
      ),
    )
    .filter(Number.isFinite)
  const ckAlphaLogStandardErrors = cycles
    .map((cycle) => cycle.ckGeometry?.logAlphaStandardError)
    .filter(Number.isFinite)
  const ckRangeWidths = cycles.map((cycle) => cycle.ckGeometry?.geometry?.ckRangeWidth).filter(Number.isFinite)
  return {
    samples: horizons.length,
    minimum: horizons.length ? Math.min(...horizons) : null,
    p10: quantile(horizons, 0.1),
    median: median(horizons),
    p90: quantile(horizons, 0.9),
    maximum: horizons.length ? Math.max(...horizons) : null,
    recoveryFraction: distribution(recoveryFractions),
    recurrencePeriodSessions: distribution(recurrencePeriods),
    ckSkewAlpha: distribution(skewAlphas),
    ckAlphaMinimumEffectiveSamples: distribution(ckAlphaMinimumEss),
    ckAlphaLogStandardError: distribution(ckAlphaLogStandardErrors),
    ckRangeWidth: distribution(ckRangeWidths),
    interpretation: '纯公式输出的连续分布；不存在固定周期、下限、上限或人工抬高。',
  }
}

function summarizeAdaptiveHorizonQuantiles(events) {
  const base = events.filter((event) => event.model === 'baseline:cost-band-below')
  const cuts = adaptiveHorizonSessionCuts(base)
  const byModel = groupBy(events, (event) => event.model)
  return {
    cutsSessions: cuts,
    groups: Object.fromEntries(
      [...byModel].map(([model, group]) => {
        const quantiles = groupBy(group, (event) => adaptiveHorizonGroup(event.modelHorizonSessions, cuts))
        return [model, Object.fromEntries([...quantiles].map(([key, values]) => [key, summarizeEvents(values)]))]
      }),
    ),
    interpretation: '分组边界由本次公式 H_t 分布的四分位数自动产生，仅用于诊断，不进入信号或持仓。',
  }
}

function comparePrespecifiedGroups(groups, eventGroups, dateUniverse) {
  return [
    comparison(
      'evidence:discount-positive-response',
      'evidence:discount-negative-response',
      groups,
      eventGroups,
      dateUniverse,
      'positive-response-vs-negative-response',
    ),
    comparison(
      'evidence:discount-positive-response',
      'baseline:cost-band-below',
      groups,
      eventGroups,
      dateUniverse,
      'positive-response-vs-cost-band',
    ),
    comparison(
      'latent:absorption-below-band',
      'baseline:cost-band-below',
      groups,
      eventGroups,
      dateUniverse,
      'support-vs-cost-band',
    ),
    comparison(
      'latent:absorption-below-band',
      'baseline:volume-shock-below',
      groups,
      eventGroups,
      dateUniverse,
      'support-vs-volume-shock',
    ),
    comparison(
      'latent:reprice-down',
      'baseline:cost-band-below',
      groups,
      eventGroups,
      dateUniverse,
      'reprice-vs-cost-band',
    ),
  ].filter(Boolean)
}

function comparison(model, baseline, groups, eventGroups, dateUniverse, id) {
  const candidate = groups[model]
  const reference = groups[baseline]
  if (!candidate || !reference) return null
  const candidateEvents = eventGroups.get(model) ?? []
  const baselineEvents = eventGroups.get(baseline) ?? []
  const isReprice = model === 'latent:reprice-down'
  const returnField = isReprice ? 'terminalReturn' : 'directionalReturn'
  const blockSessions = dependenceBlockSessions([...candidateEvents, ...baselineEvents])
  const bootstrap = blockBootstrapComparison(
    candidateEvents,
    baselineEvents,
    returnField,
    !isReprice,
    `${model}|${baseline}|dynamic-cycle`,
    dateUniverse,
    blockSessions,
  )
  return {
    id,
    model,
    baseline,
    directionalReturnLift: isReprice
      ? null
      : difference(candidate.meanDirectionalReturn, reference.meanDirectionalReturn),
    successRateLift: isReprice ? null : difference(candidate.successRate, reference.successRate),
    rawTerminalReturnDifference: difference(candidate.meanTerminalReturn, reference.meanTerminalReturn),
    durationAdjusted: stratifiedDifference(candidateEvents, baselineEvents, returnField, !isReprice),
    bootstrap: { ...bootstrap, blockRule: 'p90 of observed formula-derived H_i in the compared samples' },
    interpretation: isReprice
      ? '负的原始收益差才符合下行重定价；不把它改写成 A 股做空指令。'
      : '先看周期分桶调整后的差异，再看日期区块区间；正值且区间不跨零才算增量证据。',
  }
}

function stratifiedDifference(candidateEvents, baselineEvents, returnField, includeSuccess) {
  const cuts = adaptiveHorizonSessionCuts([...candidateEvents, ...baselineEvents])
  const candidate = groupBy(candidateEvents, (event) => adaptiveHorizonGroup(event.modelHorizonSessions, cuts))
  const baseline = groupBy(baselineEvents, (event) => adaptiveHorizonGroup(event.modelHorizonSessions, cuts))
  const common = [...candidate.keys()].filter((key) => baseline.has(key))
  const strata = common
    .map((key) => {
      const left = candidate.get(key)
      const right = baseline.get(key)
      const returnDifference = difference(
        mean(numericValues(left, returnField)),
        mean(numericValues(right, returnField)),
      )
      const leftSuccess = left.filter((event) => typeof event.success === 'boolean')
      const rightSuccess = right.filter((event) => typeof event.success === 'boolean')
      return {
        bucket: key,
        weight: left.length + right.length,
        returnDifference,
        successRateDifference: includeSuccess
          ? difference(
              mean(leftSuccess.map((event) => Number(event.success))),
              mean(rightSuccess.map((event) => Number(event.success))),
            )
          : null,
      }
    })
    .filter((item) => Number.isFinite(item.returnDifference))
  const totalWeight = strata.reduce((sum, item) => sum + item.weight, 0)
  return {
    returnDifference: totalWeight
      ? strata.reduce((sum, item) => sum + item.returnDifference * item.weight, 0) / totalWeight
      : null,
    successRateDifference:
      includeSuccess && totalWeight
        ? strata.reduce((sum, item) => sum + (item.successRateDifference ?? 0) * item.weight, 0) / totalWeight
        : null,
    adaptiveHorizonCutsSessions: cuts,
    strata,
  }
}

function assessPromotion(groups, yearly, comparisons) {
  const candidate = groups['evidence:discount-positive-response']
  const baseline = groups['evidence:discount-negative-response']
  const primary = comparisons.find((item) => item.id === 'positive-response-vs-negative-response')
  if (!candidate || !baseline || !primary) return { status: 'not-promoted', failures: ['缺少预注册对照样本'] }
  const failures = []
  if (candidate.signals < 500) failures.push(`有效信号 ${candidate.signals} < 500`)
  if (!(primary.durationAdjusted.returnDifference > 0)) failures.push('周期分桶调整后的收益差不为正')
  if (!(primary.bootstrap.returnDifference95.lower > 0)) failures.push('日期区块收益差 95% 下界未超过 0')
  if (!(primary.durationAdjusted.successRateDifference > 0)) failures.push('周期分桶调整后的目标命中率差不为正')
  if (!(primary.bootstrap.successRateDifference95?.lower > 0)) failures.push('日期区块命中率差 95% 下界未超过 0')
  if (!(candidate.prequential?.brierScore < baseline.prequential?.brierScore))
    failures.push('前序 Brier 未优于负向反应对照')
  const candidateYears = yearly['evidence:discount-positive-response'] ?? {}
  const baselineYears = yearly['evidence:discount-negative-response'] ?? {}
  const comparableYears = Object.keys(candidateYears).filter((year) =>
    Number.isFinite(baselineYears[year]?.meanDirectionalReturn),
  )
  const outperformingYears = comparableYears.filter(
    (year) => candidateYears[year].meanDirectionalReturn > baselineYears[year].meanDirectionalReturn,
  )
  if (comparableYears.length < 3 || outperformingYears.length / comparableYears.length < 0.6) {
    failures.push(`年度切片不稳定（${outperformingYears.length}/${comparableYears.length} 年超过对照）`)
  }
  return {
    status: failures.length ? 'not-promoted' : 'calibrated-estimate-candidate',
    failures,
    executionStatus: 'blocked-until-forward-paper-validation',
  }
}

function normalizeProtocol(input) {
  const cycle = { ...DEFAULT_CYCLE_HORIZON_CONFIG, ...(input.cycle ?? {}) }
  return {
    cycle: {
      ...cycle,
      tradingDaysPerYear: requireTradingDaysPerYear(cycle.tradingDaysPerYear, 'latent-liquidity validation protocol'),
    },
  }
}

function dependenceBlockSessions(events) {
  return Math.max(1, Math.ceil(quantile(numericValues(events, 'modelHorizonSessions'), 0.9) ?? 1))
}

function adaptiveHorizonSessionCuts(events) {
  const horizons = numericValues(events, 'modelHorizonSessions')
  return [0.25, 0.5, 0.75].map((probability) => quantile(horizons, probability))
}

function adaptiveHorizonGroup(value, cuts) {
  if (!Number.isFinite(value)) return 'unavailable'
  const index = cuts.findIndex((cut) => Number.isFinite(cut) && value <= cut)
  return `Q${index < 0 ? cuts.length + 1 : index + 1}`
}

function validInstrument(instrument) {
  return Array.isArray(instrument?.rows) && instrument.rows.length > 0 && typeof instrument.symbol === 'string'
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1)
}
