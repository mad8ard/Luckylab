// shelves 离散化：把 fingerprint 连续密度 + 链上池权重 + 模拟挂单
// 折算到 binCount 个价格层级，每层带模型/真实/缺口/挂单宽度等显示属性。

import { binIndex, normalizeBinCount, priceToY, scale } from './utils.js'

export function buildShelves({ range, fingerprint, realProfile, orders, activePrice, binCount, viewMode, gapMode }) {
  const count = normalizeBinCount(binCount)
  const step = (range.upper - range.lower) / count
  const bins = Array.from({ length: count }, (_, i) => {
    const lower = range.lower + step * i
    const upper = lower + step
    const mid = (lower + upper) / 2
    return {
      lower,
      upper,
      mid,
      density: 0,
      baseDensity: 0,
      activeDensity: 0,
      costDensity: 0,
      orderDensity: 0,
      rangeDensity: 0,
      buyNotional: 0,
      sellNotional: 0,
    }
  })

  for (const point of fingerprint?.prices ?? []) {
    const idx = binIndex(point.price, range, count)
    if (idx >= 0) {
      bins[idx].density += point.density
      bins[idx].baseDensity += point.baseDensity ?? 0
      bins[idx].activeDensity += point.activeDensity ?? 0
      bins[idx].costDensity += point.costDensity ?? 0
      bins[idx].orderDensity += point.orderDensity ?? 0
      bins[idx].rangeDensity += point.rangeDensity ?? 0
    }
  }
  for (const order of orders) {
    const idx = binIndex(order.price, range, count)
    if (idx < 0) continue
    if (order.side === 'sell') bins[idx].sellNotional += order.notional || 0
    else bins[idx].buyNotional += order.notional || 0
  }

  const maxOrder = Math.max(...bins.map((bin) => Math.max(bin.buyNotional, bin.sellNotional)), 1)
  const totalDensity = bins.reduce((sum, bin) => sum + bin.density, 0)
  const realWeights = realProfile?.weights ?? []
  const maxModelShare = Math.max(...bins.map((bin) => (totalDensity > 0 ? bin.density / totalDensity : 0)), 0.001)
  const maxRealShare = Math.max(...realWeights, 0.001)
  const displayShares = bins.map((bin, i) =>
    displayShare({
      modelShare: totalDensity > 0 ? bin.density / totalDensity : 0,
      realShare: realWeights[i] ?? 0,
      viewMode,
      gapMode,
      hasReal: Boolean(realProfile?.hasSignal),
    }),
  )
  const maxDisplayShare = Math.max(...displayShares, 0.001)
  return bins.reverse().map((bin) => {
    const originalIndex = Math.min(count - 1, Math.max(0, Math.round((bin.lower - range.lower) / step)))
    const modelShare = totalDensity > 0 ? bin.density / totalDensity : 0
    const realShare = realWeights[originalIndex] ?? 0
    const signedGap = modelShare - realShare
    const gapShare = computeGapShare({ modelShare, realShare, gapMode })
    const visibleShare = displayShare({
      modelShare,
      realShare,
      viewMode,
      gapMode,
      hasReal: Boolean(realProfile?.hasSignal),
    })
    const top = priceToY(bin.upper, range)
    const bottom = priceToY(bin.lower, range)
    const densityWidth = scale(visibleShare, maxDisplayShare, 6, 100)
    const buyWidth = scale(bin.buyNotional, maxOrder, 0, 100)
    const sellWidth = scale(bin.sellNotional, maxOrder, 0, 100)
    const side = Number.isFinite(activePrice) && bin.mid < activePrice ? 'bid' : 'ask'
    const intensity = Math.max(visibleShare / maxDisplayShare, bin.buyNotional / maxOrder, bin.sellNotional / maxOrder)
    const componentShare = {
      base: bin.density > 0 ? bin.baseDensity / bin.density : 0,
      active: bin.density > 0 ? bin.activeDensity / bin.density : 0,
      cost: bin.density > 0 ? bin.costDensity / bin.density : 0,
      orders: bin.density > 0 ? bin.orderDensity / bin.density : 0,
      range: bin.density > 0 ? bin.rangeDensity / bin.density : 0,
    }
    return {
      ...bin,
      side,
      top,
      bottom,
      height: Math.max(1.4, bottom - top),
      densityWidth,
      buyWidth,
      sellWidth,
      intensity,
      densityShare: visibleShare,
      modelShare,
      realShare,
      realGap: signedGap,
      gapShare,
      gapMagnitude: Math.abs(signedGap),
      gapDirection: signedGap >= 0 ? 'shortfall' : 'crowded',
      modelWidth: scale(modelShare, maxModelShare, 0, 100),
      realWidth: scale(realShare, maxRealShare, 0, 100),
      componentShare,
      dominantComponent: dominantShelfComponent({ viewMode, gapMode, signedGap, realShare, componentShare }),
      netNotional: bin.buyNotional - bin.sellNotional,
    }
  })
}

export function displayShare({ modelShare, realShare, viewMode, gapMode, hasReal }) {
  if (viewMode === 'real') return hasReal ? realShare : modelShare
  if (viewMode === 'compare') return modelShare
  if (viewMode === 'gap') return hasReal ? Math.abs(computeGapShare({ modelShare, realShare, gapMode })) : modelShare
  return modelShare
}

export function computeGapShare({ modelShare, realShare, gapMode }) {
  const signed = modelShare - realShare
  if (gapMode === 'signed') return signed
  if (gapMode === 'absolute') return Math.abs(signed)
  return Math.max(signed, 0)
}

function dominantShelfComponent({ viewMode, gapMode, signedGap, realShare, componentShare }) {
  if (viewMode === 'real' && realShare > 0) return 'real'
  if (viewMode === 'gap') {
    if (gapMode === 'signed' && signedGap < 0) return 'real'
    if (Math.abs(signedGap) > 0) return 'gap'
  }
  return dominantComponent(componentShare)
}

function dominantComponent(componentShare) {
  return Object.entries(componentShare).reduce((best, [key, value]) => (value > best.value ? { key, value } : best), {
    key: 'base',
    value: -Infinity,
  }).key
}
