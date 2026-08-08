// liquidityRackModel：把 fingerprint 连续密度 + 真实池快照 + 模拟挂单
// 折算为可渲染的价格层级（shelves）+ 元数据（meta）+ 机会扫描（opportunity）。
// 主入口仅负责拉装与组合，重逻辑在 ./liquidityRackModel/ 子模块。

import { liquidityFingerprint } from '../formulas/core.js'
import { buildLiquidityOpportunity } from './liquidityOpportunity.js'
import {
  clampIndex,
  gapModeLabel,
  normalizeBinCount,
  normalizeGapMode,
  normalizeViewMode,
  priceToY,
  scale,
  shareLabel,
  viewModeLabel,
} from './liquidityRackModel/utils.js'
import { buildRealPoolProfile } from './liquidityRackModel/realPool.js'
import { buildShelves } from './liquidityRackModel/shelves.js'
import { buildMeta } from './liquidityRackModel/meta.js'

const DEFAULT_VISIBLE_WINDOW = 120
const DEFAULT_BINS = 32

export function buildLiquidityRackModel({
  rows,
  costPath,
  formulaPath,
  graph,
  activeIndex,
  visibleWindow = DEFAULT_VISIBLE_WINDOW,
  binCount = DEFAULT_BINS,
  viewMode = 'compare',
  gapMode = 'shortfall',
}) {
  const safeRows = Array.isArray(rows) ? rows : []
  const safeCosts = Array.isArray(costPath) ? costPath : []
  const safeFormulas = Array.isArray(formulaPath) ? formulaPath : []
  if (!safeRows.length) return emptyRack()

  const index = clampIndex(activeIndex, safeRows.length)
  const activeRow = safeRows[index] ?? safeRows.at(-1)
  const activeCost = safeCosts[index] ?? safeCosts.at(-1) ?? null
  const activeFormula = safeFormulas[index] ?? safeFormulas.at(-1) ?? null
  const orders = graph?.plan?.primaryOrders ?? []
  const range = buildPriceRange({
    rows: safeRows,
    activeIndex: index,
    visibleWindow,
    activeRow,
    activeCost,
    activeFormula,
    orders,
  })
  const basis = activeCost?.anchor || activeRow?.close || graph?.inputs?.entryPrice
  if (!Number.isFinite(basis) || basis <= 0 || range.upper <= range.lower) return emptyRack(range)

  const count = normalizeBinCount(binCount)
  const mode = normalizeViewMode(viewMode)
  const normalizedGapMode = normalizeGapMode(gapMode)
  const fingerprint = liquidityFingerprint({
    entryPrice: basis,
    priceGrid: Math.max(240, count * 8),
    distribution: 'log-laplace',
    lowerFactor: Math.max(0.05, range.lower / basis),
    upperFactor: Math.min(20, range.upper / basis),
    activePrice: activeRow?.close,
    costAnchor: activeCost?.anchor,
    targetRange: {
      lower: activeFormula?.deltaLower ?? activeCost?.lower,
      upper: activeFormula?.deltaUpper ?? activeCost?.upper,
    },
    orderLevels: orders,
    volatility: graph?.inputs?.iv ?? graph?.market?.annualVol,
    lambda: 2,
    kappa: 1,
  })
  const realProfile = buildRealPoolProfile({ range, lpOnchain: graph?.lpOnchain, binCount: count })
  const effectiveViewMode = realProfile.hasSignal ? mode : 'simulate'
  const shelves = buildShelves({
    range,
    fingerprint,
    realProfile,
    orders,
    activePrice: activeRow?.close,
    binCount: count,
    viewMode: effectiveViewMode,
    gapMode: normalizedGapMode,
  })
  const markers = [
    buildMarker('现价', activeRow?.close, 'price', range),
    buildMarker('成本', activeCost?.anchor, 'cost', range),
    buildMarker('Δ上', activeFormula?.deltaUpper, 'upper', range),
    buildMarker('Δ下', activeFormula?.deltaLower, 'lower', range),
  ].filter(Boolean)
  const orderTicks = orders
    .filter((order) => Number.isFinite(order.price) && order.price > 0)
    .map((order) => ({
      side: order.side,
      role: order.role,
      price: order.price,
      notional: order.notional,
      y: priceToY(order.price, range),
      width: scale(order.notional, Math.max(...orders.map((o) => o.notional || 0), 1), 18, 100),
    }))
  const opportunity = buildLiquidityOpportunity({
    shelves,
    activePrice: activeRow?.close,
    hasRealSignal: realProfile.hasSignal,
  })

  return {
    meta: buildMeta({
      orders,
      fingerprint,
      lpOnchain: graph?.lpOnchain,
      viewMode: mode,
      gapMode: normalizedGapMode,
      hasRealSignal: realProfile.hasSignal,
    }),
    viewMode: mode,
    effectiveViewMode,
    gapMode: normalizedGapMode,
    gapModeLabel: gapModeLabel(normalizedGapMode),
    viewLabel: viewModeLabel(mode, realProfile.hasSignal),
    shareLabel: shareLabel(mode, realProfile.hasSignal, normalizedGapMode),
    range,
    basis,
    binCount: count,
    priceStep: (range.upper - range.lower) / count,
    ticks: buildPriceTicks(range),
    shelves,
    markers,
    orderTicks,
    opportunity,
    stats: buildStats({ shelves, orders, activePrice: activeRow?.close }),
    fingerprintStats: fingerprint?.stats ?? null,
    components: fingerprint?.components ?? [],
    realProfile,
    hasRealSignal: realProfile.hasSignal,
    status: fingerprint?.status ?? 'research-only',
    inputMode: fingerprint?.inputMode ?? 'model-only',
  }
}

function buildPriceRange({ rows, activeIndex, visibleWindow, activeRow, activeCost, activeFormula, orders }) {
  const end = Math.max(0, activeIndex) + 1
  const windowRows = rows.slice(Math.max(0, end - visibleWindow), end)
  const prices = windowRows.flatMap((row) => [row.high, row.low, row.close])
  prices.push(activeCost?.lower, activeCost?.upper, activeCost?.anchor)
  prices.push(activeFormula?.deltaLower, activeFormula?.deltaUpper)
  for (const order of orders) prices.push(order.price)

  const finite = prices.filter((value) => Number.isFinite(value) && value > 0)
  const fallback = activeRow?.close ?? 1
  if (!finite.length) return { lower: fallback * 0.9, upper: fallback * 1.1 }
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const pad = Math.max((max - min) * 0.1, fallback * 0.018)
  return { lower: Math.max(0.0001, min - pad), upper: max + pad }
}

function buildMarker(label, price, tone, range) {
  if (!Number.isFinite(price) || price <= 0) return null
  return { label, price, tone, y: priceToY(price, range) }
}

function buildStats({ shelves, orders, activePrice }) {
  const peak = Math.max(...shelves.map((shelf) => shelf.intensity), 0)
  const below = shelves
    .filter((shelf) => Number.isFinite(activePrice) && shelf.mid < activePrice)
    .reduce((sum, shelf) => sum + shelf.density, 0)
  const above = shelves
    .filter((shelf) => Number.isFinite(activePrice) && shelf.mid >= activePrice)
    .reduce((sum, shelf) => sum + shelf.density, 0)
  const total = below + above
  return {
    peakWeight: peak,
    orderCount: orders.length,
    belowShare: total > 0 ? below / total : 0,
    aboveShare: total > 0 ? above / total : 0,
  }
}

function buildPriceTicks(range) {
  const steps = 5
  return Array.from({ length: steps }, (_, i) => {
    const price = range.upper - ((range.upper - range.lower) * i) / (steps - 1)
    return { price, y: priceToY(price, range) }
  })
}

function emptyRack(range = { lower: null, upper: null }) {
  return {
    meta: buildMeta({ orders: [], lpOnchain: null, viewMode: 'compare' }),
    viewMode: 'compare',
    effectiveViewMode: 'simulate',
    gapMode: 'shortfall',
    gapModeLabel: gapModeLabel('shortfall'),
    viewLabel: viewModeLabel('compare', false),
    shareLabel: shareLabel('compare', false),
    range,
    basis: null,
    binCount: 0,
    priceStep: null,
    ticks: [],
    shelves: [],
    markers: [],
    orderTicks: [],
    opportunity: buildLiquidityOpportunity(),
    stats: { peakWeight: 0, orderCount: 0, belowShare: 0, aboveShare: 0 },
    fingerprintStats: null,
    components: [],
    realProfile: { hasSignal: false, pool: null, quotePrice: null, weights: [] },
    hasRealSignal: false,
    status: 'research-only',
    inputMode: 'model-only',
  }
}
