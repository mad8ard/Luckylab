/**
 * CK Part 1 motivates recurrence-point analysis but does not publish this
 * estimator.  This point-in-time pilot uses k=ceil(sqrt(N)); k grows while
 * k/N shrinks.  It estimates re-visits to the current state, never recovery to
 * the zero/anchor state.
 */
export function deriveRecurrenceCycleAt({ statePath, index } = {}) {
  if (!Array.isArray(statePath) || !Number.isInteger(index) || index < 1 || index >= statePath.length) {
    return unavailable('invalid-recurrence-prefix')
  }

  const currentDistance = statePath[index]?.costDistance
  if (!Number.isFinite(currentDistance)) return unavailable('missing-current-state-distance')

  const candidates = []
  for (let cursor = 0; cursor < index; cursor += 1) {
    const value = statePath[cursor]?.costDistance
    if (!Number.isFinite(value)) continue
    candidates.push({ index: cursor, value, distance: Math.abs(value - currentDistance) })
  }
  if (candidates.length < 4) {
    return unavailable('insufficient-recurrence-candidates', { candidateCount: candidates.length })
  }

  const neighbourCount = Math.ceil(Math.sqrt(candidates.length))
  const nearest = [...candidates].sort((left, right) => left.distance - right.distance || left.index - right.index)
  let recurrenceRadius = nearest[neighbourCount - 1]?.distance ?? null
  if (!(recurrenceRadius > 0)) {
    recurrenceRadius = nearest.find((item) => item.distance > 0)?.distance ?? null
  }
  if (!(recurrenceRadius > 0)) {
    return unavailable('zero-recurrence-radius', {
      candidateCount: candidates.length,
      neighbourCount,
    })
  }

  const hitIndices = candidates.filter((item) => item.distance <= recurrenceRadius).map((item) => item.index)
  hitIndices.push(index)
  const episodes = mergeContiguousHits(hitIndices)
  const recurrenceIntervalsSessions = episodes
    .slice(1)
    .map((episode, offset) => episode.startIndex - episodes[offset].endIndex)
    .filter((value) => value > 0)
  const recurrencePeriodSessions = median(recurrenceIntervalsSessions)
  const radiusReference = historicalRadiusReference(candidates, neighbourCount)
  const empiricalRadiusRank = empiricalRank(recurrenceRadius, radiusReference)
  const currentEpisode = episodes.at(-1)
  const kaplanMeier = kaplanMeierCompletedIntervals(recurrenceIntervalsSessions)

  return {
    status: recurrenceIntervalsSessions.length ? 'ok' : 'unavailable',
    reason: recurrenceIntervalsSessions.length ? null : 'insufficient-leave-then-return-episodes',
    claimClass: recurrenceIntervalsSessions.length ? 'sample-estimate' : 'missing-input',
    modelStatus: 'pilot-unpromoted',
    provenance: 'CK-Part-1-inspired-recurrence-extension-not-a-CK-identity',
    currentDistance,
    candidateCount: candidates.length,
    neighbourCount,
    neighbourRule: 'ceil(sqrt(point-in-time-candidate-count))',
    recurrenceRadius,
    radiusCenter: 'current-cost-distance-state',
    isAnchorNeighborhood: false,
    empiricalRadiusRank,
    empiricalRadiusRankMethod: 'rank current kNN radius against causal historical two-sided k-span radius proxy',
    // Deprecated aliases: no exchangeability/calibration proof exists, so this
    // quantity must not be called a conformal p-value or calibrated OOD score.
    outOfDistributionRank: empiricalRadiusRank,
    outOfDistributionMethod: 'deprecated-alias-of-empirical-radius-rank',
    hitCount: hitIndices.length,
    episodes,
    episodeCount: episodes.length,
    recurrenceIntervalsSessions,
    recurrencePeriodSessions,
    recurrencePeriodQ1Sessions: quantile(recurrenceIntervalsSessions, 0.25),
    recurrencePeriodQ3Sessions: quantile(recurrenceIntervalsSessions, 0.75),
    recurrencePeriodMadSessions: mad(recurrenceIntervalsSessions),
    currentEpisodeStartIndex: currentEpisode?.startIndex ?? null,
    currentEpisodeAgeSessions: currentEpisode ? index - currentEpisode.startIndex : null,
    completedEventCount: kaplanMeier.eventCount,
    censoredCount: 0,
    kaplanMeier,
    survivalCensoringStatus: 'completed-intervals-only-no-valid-right-censoring',
    uncertaintySemantics:
      'Q1/Q3/MAD describe exit-to-reentry wait dispersion. Kaplan-Meier points use Greenwood standard errors and log-log 95% confidence intervals over completed waits only.',
    interpretation:
      'This is a leave-then-return estimate for re-visiting the current state. It cannot define recoveryFraction or an anchor target.',
  }
}

function kaplanMeierCompletedIntervals(rawIntervals) {
  const intervals = rawIntervals.filter((value) => Number.isFinite(value) && value > 0)
  const eventCount = intervals.length
  const shared = {
    observation: 'completed-prior-episode-exit-to-next-episode-entry-wait',
    durationUnit: 'trading-session-index-step',
    eventCount,
    censoredCount: 0,
    currentEpisodeAgeSessionsUsedAsCensor: false,
    censoringNote:
      'currentEpisodeAgeSessions is time spent inside the current hit episode, not a right-censored wait to the next recurrence.',
    confidenceLevel: 0.95,
    confidenceMethod: 'log-log-transformed-Greenwood',
  }
  if (!eventCount) {
    return {
      status: 'unavailable',
      reason: 'no-completed-recurrence-intervals',
      ...shared,
      points: [],
    }
  }

  const eventsByTime = new Map()
  for (const interval of intervals) {
    eventsByTime.set(interval, (eventsByTime.get(interval) ?? 0) + 1)
  }

  let atRiskCount = eventCount
  let survivalProbability = 1
  let greenwoodCumulative = 0
  const points = []
  for (const [time, events] of [...eventsByTime.entries()].sort((left, right) => left[0] - right[0])) {
    survivalProbability *= 1 - events / atRiskCount
    const terminalDrop = events === atRiskCount
    let greenwoodTerm = null
    if (!terminalDrop) {
      greenwoodTerm = events / (atRiskCount * (atRiskCount - events))
      greenwoodCumulative += greenwoodTerm
    }
    const greenwoodStandardError = terminalDrop ? 0 : survivalProbability * Math.sqrt(greenwoodCumulative)
    const confidence = logLogGreenwoodInterval95(survivalProbability, greenwoodCumulative)

    points.push({
      timeSessions: time,
      atRiskCount,
      eventCount: events,
      censoredCount: 0,
      survivalProbability,
      greenwoodTerm,
      greenwoodCumulative: terminalDrop ? null : greenwoodCumulative,
      greenwoodStandardError,
      confidenceLower95: confidence.lower,
      confidenceUpper95: confidence.upper,
    })
    atRiskCount -= events
  }

  return {
    status: 'ok',
    reason: null,
    ...shared,
    points,
  }
}

function logLogGreenwoodInterval95(survivalProbability, greenwoodCumulative) {
  if (!(survivalProbability > 0)) return { lower: 0, upper: 0 }
  if (survivalProbability >= 1 || !(greenwoodCumulative > 0)) return { lower: 1, upper: 1 }

  const z95 = 1.959963984540054
  const logLogStandardError = Math.sqrt(greenwoodCumulative) / Math.abs(Math.log(survivalProbability))
  const lower = survivalProbability ** Math.exp(z95 * logLogStandardError)
  const upper = survivalProbability ** Math.exp(-z95 * logLogStandardError)
  return {
    lower: Math.max(0, Math.min(1, lower)),
    upper: Math.max(0, Math.min(1, upper)),
  }
}

function mergeContiguousHits(rawIndices) {
  const indices = [...new Set(rawIndices)].sort((a, b) => a - b)
  const episodes = []
  for (const index of indices) {
    const previous = episodes.at(-1)
    if (previous && index === previous.endIndex + 1) {
      previous.endIndex = index
      previous.hitCount += 1
    } else {
      episodes.push({ startIndex: index, endIndex: index, hitCount: 1 })
    }
  }
  return episodes
}

function historicalRadiusReference(candidates, neighbourCount) {
  const ordered = [...candidates].sort((left, right) => left.value - right.value)
  const halfSpan = Math.max(1, Math.ceil(neighbourCount / 2))
  return ordered
    .map((item, position) => {
      const left = ordered[position - halfSpan]
      const right = ordered[position + halfSpan]
      if (!left && !right) return null
      if (!left) return right.value - item.value
      if (!right) return item.value - left.value
      return Math.max(item.value - left.value, right.value - item.value)
    })
    .filter((value) => Number.isFinite(value) && value >= 0)
}

function empiricalRank(value, reference) {
  if (!Number.isFinite(value) || !reference.length) return null
  return (1 + reference.filter((item) => item <= value).length) / (reference.length + 1)
}

function unavailable(reason, extra = {}) {
  return { status: 'unavailable', reason, claimClass: 'missing-input', ...extra }
}

function median(values) {
  return quantile(values, 0.5)
}

function mad(values) {
  const center = median(values)
  return Number.isFinite(center) ? median(values.map((value) => Math.abs(value - center))) : null
}

function quantile(values, probability) {
  if (!values.length) return null
  const ordered = [...values].sort((a, b) => a - b)
  const position = (ordered.length - 1) * probability
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)
}
