const EPSILON = 1e-9

export function buildLiquidityOpportunity({
  shelves,
  activePrice,
  hasRealSignal = false,
  topZones = 3,
} = {}) {
  const rows = Array.isArray(shelves) ? shelves.filter(hasComparableShare) : []
  if (!rows.length) return emptyOpportunity('样本不足', '等待价格层级')
  if (!hasRealSignal) return emptyOpportunity('等待真实层', '先接入聚合池')

  const bins = rows.map((shelf) => {
    const signedGap = shelf.modelShare - shelf.realShare
    return {
      lower: shelf.lower,
      upper: shelf.upper,
      mid: shelf.mid,
      side: Number.isFinite(activePrice) && shelf.mid < activePrice ? 'below' : 'above',
      modelShare: shelf.modelShare,
      realShare: shelf.realShare,
      shortfall: Math.max(signedGap, 0),
      crowded: Math.max(-signedGap, 0),
      divergence: Math.abs(signedGap),
    }
  })

  const totals = aggregateTotals(bins)
  const shortfallTotal = totals.belowShortfall + totals.aboveShortfall
  const crowdedTotal = totals.belowCrowded + totals.aboveCrowded
  const divergenceTotal = shortfallTotal + crowdedTotal
  const directionalBias = (
    totals.aboveShortfall + totals.belowCrowded
    - totals.belowShortfall - totals.aboveCrowded
  )
  const direction = classifyDirection({ directionalBias, divergenceTotal, shortfallTotal, crowdedTotal })
  const primaryMetric = Math.max(
    totals.aboveShortfall,
    totals.belowShortfall,
    totals.aboveCrowded,
    totals.belowCrowded,
  )

  return {
    status: 'active',
    label: direction.label,
    action: direction.action,
    tone: direction.tone,
    confidence: clamp(divergenceTotal * 2.6 + primaryMetric * 1.4, 0, 1),
    mismatch: clamp(divergenceTotal, 0, 1),
    directionalBias,
    totals,
    zones: {
      shortfall: pickZones(bins, 'shortfall', topZones),
      crowded: pickZones(bins, 'crowded', topZones),
      divergence: pickZones(bins, 'divergence', topZones),
    },
    evidence: buildEvidence(totals, divergenceTotal),
  }
}

function classifyDirection({ directionalBias, divergenceTotal, shortfallTotal, crowdedTotal }) {
  if (divergenceTotal < 0.08) {
    return { label: '均衡', action: '等待新缺口', tone: 'neutral' }
  }
  if (directionalBias > 0.035) {
    return { label: '上侧补位', action: '观察突破确认', tone: 'bullish' }
  }
  if (directionalBias < -0.035) {
    return { label: '下侧补位', action: '观察回撤承接', tone: 'bearish' }
  }
  if (crowdedTotal > shortfallTotal * 1.2) {
    return { label: '拥挤震荡', action: '降低追价权重', tone: 'crowded' }
  }
  return { label: '错配待确认', action: '等成交验证', tone: 'neutral' }
}

function aggregateTotals(bins) {
  return bins.reduce((total, bin) => {
    if (bin.side === 'below') {
      total.belowShortfall += bin.shortfall
      total.belowCrowded += bin.crowded
    } else {
      total.aboveShortfall += bin.shortfall
      total.aboveCrowded += bin.crowded
    }
    return total
  }, {
    belowShortfall: 0,
    aboveShortfall: 0,
    belowCrowded: 0,
    aboveCrowded: 0,
  })
}

function pickZones(bins, key, limit) {
  return bins
    .filter((bin) => bin[key] > EPSILON)
    .sort((a, b) => b[key] - a[key])
    .slice(0, Math.max(1, limit))
    .map((bin) => ({
      lower: bin.lower,
      upper: bin.upper,
      side: bin.side,
      score: bin[key],
      modelShare: bin.modelShare,
      realShare: bin.realShare,
    }))
}

function buildEvidence(totals, divergenceTotal) {
  return [
    { label: '上缺口', value: totals.aboveShortfall },
    { label: '下缺口', value: totals.belowShortfall },
    { label: '上拥挤', value: totals.aboveCrowded },
    { label: '下拥挤', value: totals.belowCrowded },
    { label: '错配', value: divergenceTotal },
  ]
}

function hasComparableShare(shelf) {
  return Number.isFinite(shelf?.modelShare) && Number.isFinite(shelf?.realShare)
}

function emptyOpportunity(label, action) {
  return {
    status: 'pending',
    label,
    action,
    tone: 'pending',
    confidence: 0,
    mismatch: 0,
    directionalBias: 0,
    totals: {
      belowShortfall: 0,
      aboveShortfall: 0,
      belowCrowded: 0,
      aboveCrowded: 0,
    },
    zones: { shortfall: [], crowded: [], divergence: [] },
    evidence: [],
  }
}

function clamp(value, lower, upper) {
  if (!Number.isFinite(value)) return lower
  return Math.min(upper, Math.max(lower, value))
}
