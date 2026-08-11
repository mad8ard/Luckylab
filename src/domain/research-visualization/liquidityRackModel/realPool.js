// 真实 tick 数据与池报价校准代理。聚合报价不能伪装成 tick 深度。

import { normalizeBinCount } from './utils.js'

export function buildRealPoolProfile({ range, lpOnchain, binCount }) {
  const pool = lpOnchain?.pool ?? null
  const routes = normalizeQuoteRoutes(lpOnchain)
  const activeRoutes = routes.filter((route) => route.quotePrice >= range.lower && route.quotePrice <= range.upper)
  const count = normalizeBinCount(binCount)
  const tickEvidenceIsReal =
    lpOnchain?.tickEvidence === 'tick-real' || lpOnchain?.capabilities?.canCompareTickDistribution === true
  const ticks = tickEvidenceIsReal ? normalizeTicks(lpOnchain?.ticks, range) : []
  const weights = tickWeights({ ticks, range, count })
  const calibrationWeights = quoteKernelWeights({ activeRoutes, range, count })
  return {
    hasSignal: weights.some((value) => value > 0),
    hasCalibrationSignal: calibrationWeights.some((value) => value > 0),
    evidence: weights.some((value) => value > 0) ? 'tick-real' : activeRoutes.length ? 'price-kernel-proxy' : 'missing',
    pool,
    pools: lpOnchain?.pools ?? [],
    routes,
    ticks,
    quotePrice: activeRoutes[0]?.quotePrice ?? routes[0]?.quotePrice ?? null,
    quoteSymbol: activeRoutes[0]?.quoteSymbol ?? lpOnchain?.quoteSymbol ?? null,
    liquidity: pool?.liquidity ?? null,
    blockNumber: lpOnchain?.blockNumber ?? null,
    coverage: lpOnchain?.poolCoverage ?? null,
    weights,
    calibrationWeights,
  }
}

function quoteKernelWeights({ activeRoutes, range, count }) {
  if (!activeRoutes.length) return Array.from({ length: count }, () => 0)
  const step = (range.upper - range.lower) / count
  const routeWeightTotal = activeRoutes.reduce((sum, route) => sum + route.weight, 0) || activeRoutes.length
  const raw = Array.from({ length: count }, (_, i) => {
    const lower = range.lower + step * i
    const upper = lower + step
    const mid = (lower + upper) / 2
    return activeRoutes.reduce((sum, route) => {
      const distance = Math.log(mid / route.quotePrice)
      const routeShare = routeWeightTotal > 0 ? route.weight / routeWeightTotal : 1 / activeRoutes.length
      return sum + Math.exp(-0.5 * Math.pow(distance / route.sigmaLog, 2)) * routeShare
    }, 0)
  })
  const total = raw.reduce((sum, value) => sum + value, 0)
  return total > 0 ? raw.map((value) => value / total) : raw
}

function normalizeTicks(ticks, range) {
  if (!Array.isArray(ticks)) return []
  return ticks
    .map((tick) => ({
      lowerPrice: Number(tick?.lowerPrice),
      upperPrice: Number(tick?.upperPrice),
      liquidity: Math.abs(Number(tick?.liquidityGross ?? tick?.liquidityNet ?? tick?.liquidity)),
    }))
    .filter(
      (tick) =>
        Number.isFinite(tick.lowerPrice) &&
        Number.isFinite(tick.upperPrice) &&
        tick.lowerPrice > 0 &&
        tick.upperPrice > tick.lowerPrice &&
        Number.isFinite(tick.liquidity) &&
        tick.liquidity > 0 &&
        tick.upperPrice >= range.lower &&
        tick.lowerPrice <= range.upper,
    )
}

function tickWeights({ ticks, range, count }) {
  if (!ticks.length) return Array.from({ length: count }, () => 0)
  const step = (range.upper - range.lower) / count
  const raw = Array.from({ length: count }, (_, index) => {
    const lower = range.lower + step * index
    const upper = lower + step
    return ticks.reduce((sum, tick) => {
      const overlap = Math.max(0, Math.min(upper, tick.upperPrice) - Math.max(lower, tick.lowerPrice))
      return sum + overlap * tick.liquidity
    }, 0)
  })
  const total = raw.reduce((sum, value) => sum + value, 0)
  return total > 0 ? raw.map((value) => value / total) : raw
}

function normalizeQuoteRoutes(lpOnchain) {
  const routes =
    Array.isArray(lpOnchain?.quoteRoutes) && lpOnchain.quoteRoutes.length
      ? lpOnchain.quoteRoutes
      : [
          {
            quoteSymbol: lpOnchain?.quoteSymbol,
            quotePrice: lpOnchain?.quotePrice,
            pools: [lpOnchain?.pool].filter(Boolean),
          },
        ]
  return routes
    .map((route) => {
      const pools = Array.isArray(route.pools) ? route.pools : []
      const tickSpacing = Math.max(...pools.map((item) => Number(item?.tickSpacing) || 1), 1)
      const reserveUsd = pools.reduce((sum, pool) => sum + (Number(pool.reserveUsd) || 0), 0)
      return {
        ...route,
        quotePrice: Number(route.quotePrice),
        weight: Math.max(0.0001, Number(route.weight) || Math.log10(reserveUsd + 1) || 1),
        sigmaLog: Math.max(0.004, Math.min(0.08, Math.pow(1.0001, tickSpacing * 20) - 1)),
      }
    })
    .filter((route) => Number.isFinite(route.quotePrice) && route.quotePrice > 0)
}
