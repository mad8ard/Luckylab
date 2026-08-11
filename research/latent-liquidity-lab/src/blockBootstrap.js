/**
 * Resample contiguous signal-date blocks, preserving all same-day
 * cross-sectional events together.  This is a dependence-aware uncertainty
 * diagnostic, not a causal significance test.
 */
export function blockBootstrapComparison(
  candidateEvents,
  baselineEvents,
  returnField,
  includeSuccess,
  seedKey,
  dateUniverse = [],
  requestedBlockSessions,
) {
  const candidate = dateStatistics(candidateEvents, returnField)
  const baseline = dateStatistics(baselineEvents, returnField)
  const dates = dateUniverse.length
    ? [...dateUniverse].sort()
    : [...new Set([...candidate.keys(), ...baseline.keys()])].sort()
  const blockSessions = Math.floor(Number(requestedBlockSessions))
  if (!Number.isFinite(blockSessions) || blockSessions <= 0) {
    throw new TypeError('blockBootstrapComparison: requestedBlockSessions must be an explicit positive integer')
  }
  const replicates = 500
  if (!dates.length) return emptyBootstrap(returnField, blockSessions, replicates)
  const blocksPerReplicate = Math.ceil(dates.length / blockSessions)
  const random = seededRandom(seedKey)
  const returnDifferences = []
  const successDifferences = []
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const left = emptyDateStats()
    const right = emptyDateStats()
    for (let block = 0; block < blocksPerReplicate; block += 1) {
      const start = Math.floor(random() * dates.length)
      for (let offset = 0; offset < blockSessions; offset += 1) {
        const date = dates[(start + offset) % dates.length]
        addDateStats(left, candidate.get(date))
        addDateStats(right, baseline.get(date))
      }
    }
    if (left.count > 0 && right.count > 0) returnDifferences.push(left.sum / left.count - right.sum / right.count)
    if (includeSuccess && left.successCount > 0 && right.successCount > 0) {
      successDifferences.push(left.successes / left.successCount - right.successes / right.successCount)
    }
  }
  return {
    blockSessions,
    replicates,
    returnField,
    returnDifference95: percentileInterval(returnDifferences),
    successRateDifference95: includeSuccess ? percentileInterval(successDifferences) : null,
  }
}

function dateStatistics(events, returnField) {
  const byDate = new Map()
  for (const event of events) {
    const stats = byDate.get(event.signalDate) ?? emptyDateStats()
    if (Number.isFinite(event[returnField])) {
      stats.sum += event[returnField]
      stats.count += 1
    }
    if (typeof event.success === 'boolean') {
      stats.successes += Number(event.success)
      stats.successCount += 1
    }
    byDate.set(event.signalDate, stats)
  }
  return byDate
}

function emptyDateStats() {
  return { sum: 0, count: 0, successes: 0, successCount: 0 }
}

function addDateStats(target, source) {
  if (!source) return
  target.sum += source.sum
  target.count += source.count
  target.successes += source.successes
  target.successCount += source.successCount
}

function emptyBootstrap(returnField, blockSessions, replicates) {
  return {
    blockSessions,
    replicates,
    returnField,
    returnDifference95: { lower: null, upper: null, samples: 0 },
    successRateDifference95: null,
  }
}

function percentileInterval(values) {
  if (!values.length) return { lower: null, upper: null, samples: 0 }
  const ordered = [...values].sort((a, b) => a - b)
  return {
    lower: quantile(ordered, 0.025),
    upper: quantile(ordered, 0.975),
    samples: ordered.length,
  }
}

function quantile(ordered, probability) {
  const position = (ordered.length - 1) * probability
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)
}

function seededRandom(seedText) {
  let seed = 2166136261
  for (const char of seedText) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619)
  return () => {
    seed += 0x6d2b79f5
    let value = seed
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
