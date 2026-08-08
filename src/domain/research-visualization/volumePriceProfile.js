const DEFAULT_WINDOW = 180
const DEFAULT_BINS = 36
const VALUE_AREA_SHARE = 0.7

export function buildVolumePriceProfile({ rows, activeIndex = null, visibleWindow = DEFAULT_WINDOW, binCount = DEFAULT_BINS } = {}) {
  const safeRows = Array.isArray(rows) ? rows : []
  if (!safeRows.length) return emptyProfile()
  const end = clampIndex(activeIndex ?? safeRows.length - 1, safeRows.length) + 1
  const windowRows = safeRows.slice(Math.max(0, end - normalizeWindow(visibleWindow)), end)
    .filter(validRow)
  if (!windowRows.length) return emptyProfile()

  const range = priceRange(windowRows)
  if (!range) return emptyProfile()
  const count = normalizeBinCount(binCount)
  const step = (range.upper - range.lower) / count
  const bins = Array.from({ length: count }, (_, i) => {
    const lower = range.lower + step * i
    const upper = i === count - 1 ? range.upper : lower + step
    return { index: i, lower, upper, mid: (lower + upper) / 2, volume: 0, upVolume: 0, downVolume: 0 }
  })

  for (const row of windowRows) distributeRow(row, bins, range)

  const totalVolume = sum(bins, 'volume')
  const maxVolume = Math.max(...bins.map((bin) => bin.volume), 0)
  if (!(totalVolume > 0) || !(maxVolume > 0)) return emptyProfile(range)

  const pocIndex = bins.reduce((best, bin, index) => bin.volume > bins[best].volume ? index : best, 0)
  const valueArea = buildValueArea(bins, totalVolume, pocIndex)
  const currentPrice = windowRows.at(-1)?.close ?? null
  const currentIndex = Number.isFinite(currentPrice) ? binIndex(currentPrice, range, count) : -1

  const enriched = bins.map((bin, index) => ({
    ...bin,
    share: bin.volume / totalVolume,
    intensity: bin.volume / maxVolume,
    upShare: bin.volume > 0 ? bin.upVolume / bin.volume : 0,
    downShare: bin.volume > 0 ? bin.downVolume / bin.volume : 0,
    isPoc: index === pocIndex,
    isCurrent: index === currentIndex,
    inValueArea: index >= valueArea.lowerIndex && index <= valueArea.upperIndex,
  }))

  return {
    status: 'proxy-only',
    inputMode: 'ohlcv-volume-proxy',
    method: 'volume-by-price',
    rows: windowRows.length,
    firstDate: windowRows[0]?.date ?? '',
    lastDate: windowRows.at(-1)?.date ?? '',
    range,
    currentPrice,
    totalVolume,
    poc: enriched[pocIndex],
    valueArea: {
      lower: enriched[valueArea.lowerIndex]?.lower ?? null,
      upper: enriched[valueArea.upperIndex]?.upper ?? null,
      share: valueArea.share,
    },
    bins: enriched,
  }
}

function distributeRow(row, bins, range) {
  const low = Math.max(range.lower, Math.min(row.low, row.high))
  const high = Math.min(range.upper, Math.max(row.low, row.high))
  const volume = Number(row.volume)
  if (!(volume > 0)) return
  const up = row.close >= row.open
  if (high <= low) {
    addVolume(bins[binIndex(row.close, range, bins.length)], volume, up)
    return
  }
  let covered = 0
  const overlaps = []
  for (const bin of bins) {
    const overlap = Math.max(0, Math.min(high, bin.upper) - Math.max(low, bin.lower))
    if (overlap > 0) {
      overlaps.push([bin, overlap])
      covered += overlap
    }
  }
  if (!(covered > 0)) {
    addVolume(bins[binIndex(row.close, range, bins.length)], volume, up)
    return
  }
  for (const [bin, overlap] of overlaps) addVolume(bin, volume * (overlap / covered), up)
}

function addVolume(bin, volume, up) {
  if (!bin || !(volume > 0)) return
  bin.volume += volume
  if (up) bin.upVolume += volume
  else bin.downVolume += volume
}

function buildValueArea(bins, totalVolume, pocIndex) {
  let lowerIndex = pocIndex
  let upperIndex = pocIndex
  let acc = bins[pocIndex]?.volume ?? 0
  const target = totalVolume * VALUE_AREA_SHARE
  while (acc < target && (lowerIndex > 0 || upperIndex < bins.length - 1)) {
    const lowerVol = lowerIndex > 0 ? bins[lowerIndex - 1].volume : -1
    const upperVol = upperIndex < bins.length - 1 ? bins[upperIndex + 1].volume : -1
    if (upperVol >= lowerVol) {
      upperIndex += 1
      acc += Math.max(upperVol, 0)
    } else {
      lowerIndex -= 1
      acc += Math.max(lowerVol, 0)
    }
  }
  return { lowerIndex, upperIndex, share: totalVolume > 0 ? acc / totalVolume : 0 }
}

function priceRange(rows) {
  const lows = rows.map((row) => row.low).filter((value) => Number.isFinite(value) && value > 0)
  const highs = rows.map((row) => row.high).filter((value) => Number.isFinite(value) && value > 0)
  if (!lows.length || !highs.length) return null
  const lower = Math.min(...lows)
  const upper = Math.max(...highs)
  if (upper <= lower) {
    const basis = upper || lower || 1
    return { lower: basis * 0.99, upper: basis * 1.01 }
  }
  const pad = Math.max((upper - lower) * 0.02, upper * 0.001)
  return { lower: Math.max(0.0001, lower - pad), upper: upper + pad }
}

function validRow(row) {
  return Number.isFinite(row?.open) && Number.isFinite(row?.high) && Number.isFinite(row?.low) && Number.isFinite(row?.close) && Number(row?.volume) > 0
}

function binIndex(price, range, count) {
  if (!Number.isFinite(price) || price < range.lower || price > range.upper) return -1
  return Math.max(0, Math.min(count - 1, Math.floor(((price - range.lower) / (range.upper - range.lower)) * count)))
}

function normalizeBinCount(value) {
  return Math.max(12, Math.min(80, Math.round(Number(value) || DEFAULT_BINS)))
}

function normalizeWindow(value) {
  return Math.max(1, Math.min(500, Math.round(Number(value) || DEFAULT_WINDOW)))
}

function clampIndex(index, length) {
  const n = Number(index)
  if (!Number.isFinite(n)) return Math.max(0, length - 1)
  return Math.max(0, Math.min(length - 1, Math.round(n)))
}

function sum(items, key) {
  return items.reduce((total, item) => total + (Number(item[key]) || 0), 0)
}

function emptyProfile(range = null) {
  return {
    status: 'empty',
    inputMode: 'ohlcv-volume-proxy',
    method: 'volume-by-price',
    rows: 0,
    firstDate: '',
    lastDate: '',
    range,
    currentPrice: null,
    totalVolume: 0,
    poc: null,
    valueArea: null,
    bins: [],
  }
}
