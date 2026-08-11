// liquidityRackModel：把 fingerprint 目标权重 + 真实 tick 深度 + 模拟挂单
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

const DEFAULT_BINS = 32

export function buildLiquidityRackModel({
  rows,
  costPath,
  formulaPath,
  graph,
  activeIndex,
  visibleWindow = null,
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
  const visibleRows = resolveVisibleRows(safeRows, index, visibleWindow)
  const range = buildPriceRange({
    rows: visibleRows.rows,
    activeRow,
    activeCost,
    activeFormula,
    orders,
  })
  const basis = activeCost?.anchor || activeRow?.close || graph?.inputs?.entryPrice
  if (!Number.isFinite(basis) || basis <= 0 || range.upper <= range.lower) {
    return emptyRack(range, visibleRows.windowSpec)
  }

  const count = normalizeBinCount(binCount)
  const mode = normalizeViewMode(viewMode)
  const normalizedGapMode = normalizeGapMode(gapMode)
  const volatility = graph?.inputs?.iv ?? graph?.market?.annualVol
  const tradingDaysPerYear = graph?.inputs?.tradingDaysPerYear ?? graph?.market?.tradingDaysPerYear
  const missingFingerprintInputs = [
    Number.isFinite(volatility) && volatility > 0 ? null : 'volatility',
    Number.isFinite(tradingDaysPerYear) && tradingDaysPerYear > 0 ? null : 'tradingDaysPerYear',
  ].filter(Boolean)
  if (missingFingerprintInputs.length) {
    return blockedRack(range, visibleRows.windowSpec, basis, missingFingerprintInputs)
  }
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
    volatility,
    tradingDaysPerYear,
    lambda: 2,
    kappa: 1,
  })
  if (!fingerprint) {
    return blockedRack(range, visibleRows.windowSpec, basis, ['liquidityFingerprint'])
  }
  const realProfile = buildRealPoolProfile({ range, lpOnchain: graph?.lpOnchain, binCount: count })
  const effectiveViewMode = realProfile.hasSignal ? mode : 'simulate'
  const shelves = buildShelves({
    range,
    windowSpec: visibleRows.windowSpec,
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
      hasCalibrationSignal: realProfile.hasCalibrationSignal,
    }),
    viewMode: mode,
    effectiveViewMode,
    gapMode: normalizedGapMode,
    gapModeLabel: gapModeLabel(normalizedGapMode),
    viewLabel: viewModeLabel(mode, realProfile.hasSignal),
    shareLabel: shareLabel(mode, realProfile.hasSignal, normalizedGapMode),
    range,
    windowSpec: visibleRows.windowSpec,
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
    hasCalibrationSignal: realProfile.hasCalibrationSignal,
    status: fingerprint?.status ?? 'research-only',
    inputMode: fingerprint?.inputMode ?? 'model-only',
    missingInputs: fingerprint?.missingInputs ?? [],
  }
}

function buildPriceRange({ rows, activeRow, activeCost, activeFormula, orders }) {
  const prices = rows.flatMap((row) => [row.high, row.low, row.close])
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

function resolveVisibleRows(rows, activeIndex, visibleWindow) {
  const end = Math.max(0, activeIndex) + 1
  const requested = positiveSessionCount(visibleWindow)
  const start = requested === null ? 0 : Math.max(0, end - requested)
  const visible = rows.slice(start, end)
  return {
    rows: visible,
    windowSpec: {
      mode: requested === null ? 'visible-prefix' : 'viewport-explicit',
      visiblePrefixRows: end,
      requestedWindowSessions: requested,
      appliedRows: visible.length,
      futureRowsUsed: false,
    },
  }
}

function positiveSessionCount(value) {
  if (value === null || value === undefined || value === '') return null
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? Math.max(1, Math.ceil(next)) : null
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

function emptyRack(range = { lower: null, upper: null }, windowSpec = null) {
  return {
    meta: buildMeta({ orders: [], lpOnchain: null, viewMode: 'compare' }),
    viewMode: 'compare',
    effectiveViewMode: 'simulate',
    gapMode: 'shortfall',
    gapModeLabel: gapModeLabel('shortfall'),
    viewLabel: viewModeLabel('compare', false),
    shareLabel: shareLabel('compare', false),
    range,
    windowSpec,
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
    realProfile: {
      hasSignal: false,
      hasCalibrationSignal: false,
      pool: null,
      quotePrice: null,
      weights: [],
      calibrationWeights: [],
    },
    hasRealSignal: false,
    hasCalibrationSignal: false,
    status: 'research-only',
    inputMode: 'model-only',
    missingInputs: [],
  }
}

function blockedRack(range, windowSpec, basis, missingInputs) {
  const rack = emptyRack(range, windowSpec)
  return {
    ...rack,
    basis,
    status: 'blocked',
    executionStatus: 'blocked',
    inputMode: 'missing-input',
    missingInputs,
    meta: {
      ...rack.meta,
      title: '流动性指纹输入缺失',
      sourceLabel: `缺少 ${missingInputs.join(' / ')}，未生成模型目标仓`,
      compositionLabel: '补齐波动率和交易日年化基准后再计算',
    },
  }
}
