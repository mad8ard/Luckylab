// 真实池数据：把 lpOnchain 链上快照折算成 binCount 长度的权重数组。

import { normalizeBinCount } from './utils.js'

export function buildRealPoolProfile({ range, lpOnchain, binCount }) {
  const pool = lpOnchain?.pool ?? null
  const routes = normalizeQuoteRoutes(lpOnchain)
  const activeRoutes = routes.filter((route) => route.quotePrice >= range.lower && route.quotePrice <= range.upper)
  if (!activeRoutes.length) {
    return {
      hasSignal: false,
      pool,
      pools: lpOnchain?.pools ?? [],
      routes,
      quotePrice: routes[0]?.quotePrice ?? null,
      weights: Array.from({ length: normalizeBinCount(binCount) }, () => 0),
    }
  }
  const count = normalizeBinCount(binCount)
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
  return {
    hasSignal: total > 0,
    pool,
    pools: lpOnchain?.pools ?? [],
    routes,
    quotePrice: activeRoutes[0]?.quotePrice ?? null,
    quoteSymbol: activeRoutes[0]?.quoteSymbol ?? lpOnchain?.quoteSymbol ?? null,
    liquidity: pool?.liquidity ?? null,
    blockNumber: lpOnchain?.blockNumber ?? null,
    coverage: lpOnchain?.poolCoverage ?? null,
    weights: total > 0 ? raw.map((value) => value / total) : raw,
  }
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
