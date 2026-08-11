export function groupBy(values, selector) {
  const grouped = new Map()
  for (const value of values) {
    const key = selector(value)
    const bucket = grouped.get(key) ?? []
    bucket.push(value)
    grouped.set(key, bucket)
  }
  return grouped
}

export function numericValues(values, key) {
  return values.map((value) => value[key]).filter(Number.isFinite)
}

export function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

export function median(values) {
  if (!values.length) return null
  const ordered = [...values].sort((a, b) => a - b)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2
}

export function quantile(values, probability) {
  if (!values.length) return null
  const ordered = [...values].sort((a, b) => a - b)
  const position = (ordered.length - 1) * probability
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)
}

export function distribution(values) {
  return {
    samples: values.length,
    minimum: values.length ? Math.min(...values) : null,
    p10: quantile(values, 0.1),
    median: quantile(values, 0.5),
    p90: quantile(values, 0.9),
    maximum: values.length ? Math.max(...values) : null,
  }
}

export function difference(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) ? left - right : null
}

export function wilsonInterval(successes, samples, z = 1.96) {
  if (!Number.isFinite(samples) || samples <= 0) return { lower: null, upper: null }
  const p = successes / samples
  const denominator = 1 + (z * z) / samples
  const center = (p + (z * z) / (2 * samples)) / denominator
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * samples)) / samples)) / denominator
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) }
}
