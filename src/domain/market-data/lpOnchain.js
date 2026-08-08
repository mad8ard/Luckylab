const SYMBOL_ROUTE_SCHEMAS = {
  ETHUSDT: [
    { quoteSymbol: 'USDT', routeType: 'direct', legs: [['WETH', 'USDT']] },
    { quoteSymbol: 'USDC', routeType: 'direct', legs: [['WETH', 'USDC']] },
  ],
}

const TOKEN_DECIMALS = {
  DAI: 18,
  USDC: 6,
  USDT: 6,
  WETH: 18,
}

export function resolveLpOnchainSnapshot(source, snapshots) {
  const symbol = String(source?.symbol ?? '').toUpperCase()
  const pools = Array.isArray(snapshots?.pools) ? snapshots.pools : []
  const quoteRoutes = buildQuoteRoutes(symbol, pools)
  const routePools = uniquePools(quoteRoutes.flatMap((route) => route.pools))
  const positions = Array.isArray(snapshots?.positions)
    ? snapshots.positions.filter((item) => routePools.some((routePool) => positionMatchesPool(item, routePool)))
    : []
  return {
    schemaVersion: snapshots?.schemaVersion ?? null,
    source: snapshots?.source ?? '',
    fetchedAt: snapshots?.fetchedAt ?? '',
    blockNumber: snapshots?.blockNumber ?? null,
    pool: routePools[0] ?? null,
    pools: routePools,
    quoteRoutes,
    positions,
    hasPool: quoteRoutes.length > 0,
    hasPosition: positions.length > 0,
    quotePrice: primaryQuotePrice(quoteRoutes),
    quoteSymbol: primaryQuoteSymbol(symbol, quoteRoutes),
    poolCoverage: buildPoolCoverage({ quoteRoutes, routePools }),
  }
}

function buildQuoteRoutes(symbol, pools) {
  return (SYMBOL_ROUTE_SCHEMAS[symbol] ?? [])
    .flatMap((schema) => buildRouteVariants(schema, pools))
    .filter((route) => route && Number.isFinite(route.quotePrice))
    .sort(compareRoutes)
}

function buildRouteVariants(schema, pools) {
  const legOptions = schema.legs.map(([base, quote]) => {
    return pools
      .filter((pool) => pool?.status === 'ok' && poolHasPair(pool, base, quote))
      .map((pool) => ({ base, quote, poolId: pool.id, pool, price: priceOfBaseInQuote(pool, base, quote) }))
      .filter((leg) => Number.isFinite(leg.price) && leg.price > 0)
  })
  if (legOptions.some((options) => !options.length)) return []
  return cartesian(legOptions)
    .map((legs) => buildQuoteRoute(schema, legs))
    .filter(Boolean)
}

function buildQuoteRoute(schema, legs) {
  if (legs.some((leg) => !leg.pool || !Number.isFinite(leg.price))) return null
  const quotePrice = legs.reduce((value, leg) => value * leg.price, 1)
  const reserveUsd = routePoolStat(legs, 'reserveUsd')
  const volumeUsd24h = routePoolStat(legs, 'volumeUsd24h')
  return {
    id: `${schema.quoteSymbol}-${schema.routeType}-${legs.map((leg) => leg.poolId).join('__')}`,
    quoteSymbol: schema.quoteSymbol,
    routeType: schema.routeType,
    quotePrice,
    weight: routeWeight(legs),
    reserveUsd,
    volumeUsd24h,
    label: legs.map((leg) => leg.pool.label).join(' × '),
    legs: legs.map(({ pool, ...leg }) => ({
      ...leg,
      fee: pool.fee,
      liquidity: pool.liquidity,
      poolLabel: pool.label,
    })),
    pools: uniquePools(legs.map((leg) => leg.pool)),
  }
}

function routePoolStat(legs, key) {
  const values = legs.map((leg) => Number(leg.pool?.[key])).filter((value) => Number.isFinite(value) && value > 0)
  if (!values.length) return null
  return legs.length === 1 ? values[0] : Math.min(...values)
}

function poolHasPair(pool, base, quote) {
  return (pool.token0Symbol === base && pool.token1Symbol === quote) ||
    (pool.token0Symbol === quote && pool.token1Symbol === base)
}

function cartesian(groups) {
  return groups.reduce((sets, group) => sets.flatMap((set) => group.map((item) => [...set, item])), [[]])
}

function priceOfBaseInQuote(pool, base, quote) {
  const price1Per0 = humanPrice1Per0(pool)
  if (!Number.isFinite(price1Per0) || price1Per0 <= 0) return null
  if (pool.token0Symbol === base && pool.token1Symbol === quote) return price1Per0
  if (pool.token1Symbol === base && pool.token0Symbol === quote) return 1 / price1Per0
  return null
}

function primaryQuotePrice(routes) {
  const stableRoutes = routes.filter((route) => route.quoteSymbol === 'USDT')
  return weightedAverage(stableRoutes.length ? stableRoutes : routes)
}

function primaryQuoteSymbol(symbol, routes) {
  if (symbol.endsWith('USDT') && routes.some((route) => route.quoteSymbol === 'USDT')) return 'USDT'
  return routes[0]?.quoteSymbol ?? null
}

function weightedAverage(routes) {
  const valid = routes.filter((route) => Number.isFinite(route.quotePrice) && route.quotePrice > 0)
  if (!valid.length) return null
  const totalWeight = valid.reduce((sum, route) => sum + Math.max(0, route.weight ?? 0), 0)
  if (totalWeight <= 0) return valid.reduce((sum, route) => sum + route.quotePrice, 0) / valid.length
  return valid.reduce((sum, route) => sum + route.quotePrice * Math.max(0, route.weight ?? 0), 0) / totalWeight
}

function routeWeight(legs) {
  const legWeights = legs.map((leg) => poolWeight(leg.pool)).filter((value) => value > 0)
  if (!legWeights.length) return 1
  return legs.length === 1 ? legWeights[0] : Math.min(...legWeights) / legs.length
}

function poolWeight(pool) {
  const reserveWeight = Number(pool?.reserveUsd)
  if (Number.isFinite(reserveWeight) && reserveWeight > 0) return Math.log10(reserveWeight + 1)
  try {
    const value = BigInt(pool?.liquidity ?? 0)
    if (value <= 0n) return 0
    const capped = value > 10n ** 30n ? 10n ** 30n : value
    return Math.log10(Number(capped) + 1)
  } catch {
    return 0
  }
}

function compareRoutes(left, right) {
  const quoteOrder = quoteRank(left.quoteSymbol) - quoteRank(right.quoteSymbol)
  if (quoteOrder !== 0) return quoteOrder
  const typeOrder = routeTypeRank(left.routeType) - routeTypeRank(right.routeType)
  if (typeOrder !== 0) return typeOrder
  return (right.weight ?? 0) - (left.weight ?? 0)
}

function quoteRank(symbol) {
  return ({ USDT: 0, USDC: 1, DAI: 2 })[symbol] ?? 9
}

function routeTypeRank(type) {
  return ({ direct: 0, 'via-weth': 1 })[type] ?? 9
}

function uniquePools(pools) {
  const out = []
  const seen = new Set()
  for (const pool of pools) {
    if (!pool || seen.has(pool.id)) continue
    seen.add(pool.id)
    out.push(pool)
  }
  return out.sort((left, right) => poolWeight(right) - poolWeight(left))
}

function buildPoolCoverage({ quoteRoutes, routePools }) {
  const reserveUsd = routePools.reduce((sum, pool) => sum + (Number(pool.reserveUsd) || 0), 0)
  const volumeUsd24h = routePools.reduce((sum, pool) => sum + (Number(pool.volumeUsd24h) || 0), 0)
  const topPool = routePools[0] ?? null
  const topPoolReserveShare = reserveUsd > 0 ? (Number(topPool?.reserveUsd) || 0) / reserveUsd : 0
  return {
    routeCount: quoteRoutes.length,
    poolCount: routePools.length,
    pairCount: pairBreakdown(routePools).length,
    protocolCount: protocolBreakdown(routePools).length,
    quoteSymbols: [...new Set(quoteRoutes.map((route) => route.quoteSymbol).filter(Boolean))],
    routeTypes: [...new Set(quoteRoutes.map((route) => route.routeType).filter(Boolean))],
    protocols: [...new Set(routePools.map((pool) => pool.protocol).filter(Boolean))],
    reserveUsd,
    volumeUsd24h,
    topPoolReserveShare,
    topPools: routePools.slice(0, 5).map(poolSummary),
    pairBreakdown: pairBreakdown(routePools),
    protocolBreakdown: protocolBreakdown(routePools),
  }
}

function pairBreakdown(pools) {
  return breakdown(pools, (pool) => [pool.token0Symbol, pool.token1Symbol].filter(Boolean).sort().join('/'))
}

function protocolBreakdown(pools) {
  return breakdown(pools, (pool) => pool.protocol)
}

function breakdown(pools, keyFn) {
  const groups = new Map()
  for (const pool of pools) {
    const key = keyFn(pool)
    if (!key) continue
    const current = groups.get(key) ?? { key, poolCount: 0, reserveUsd: 0, volumeUsd24h: 0 }
    current.poolCount += 1
    current.reserveUsd += Number(pool.reserveUsd) || 0
    current.volumeUsd24h += Number(pool.volumeUsd24h) || 0
    groups.set(key, current)
  }
  return [...groups.values()].sort((left, right) => right.reserveUsd - left.reserveUsd)
}

function poolSummary(pool) {
  return {
    label: pool.label,
    protocol: pool.protocol,
    pair: [pool.token0Symbol, pool.token1Symbol].filter(Boolean).join('/'),
    reserveUsd: Number(pool.reserveUsd) || null,
    volumeUsd24h: Number(pool.volumeUsd24h) || null,
  }
}

function humanPrice1Per0(pool) {
  const direct = Number(pool?.price1Per0)
  if (Number.isFinite(direct) && direct > 0) return direct
  const sqrtPriceX96 = Number(BigInt(pool?.sqrtPriceX96 ?? 0n))
  const token0Decimals = TOKEN_DECIMALS[pool?.token0Symbol] ?? 18
  const token1Decimals = TOKEN_DECIMALS[pool?.token1Symbol] ?? 18
  if (!Number.isFinite(sqrtPriceX96) || sqrtPriceX96 <= 0) return null
  const raw = Math.pow(sqrtPriceX96 / 2 ** 96, 2)
  return raw * 10 ** (token0Decimals - token1Decimals)
}

function positionMatchesPool(position, pool) {
  if (!pool || position?.status !== 'ok') return false
  return sameAddress(position.token0, pool.token0) &&
    sameAddress(position.token1, pool.token1) &&
    Number(position.fee) === Number(pool.fee)
}

function sameAddress(left, right) {
  return String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase()
}

export function buildLpDataState(snapshot) {
  if (!snapshot?.hasPool) {
    return {
      inputMode: 'fallback',
      missingInputs: ['real-lp-pool'],
      isSynthetic: true,
    }
  }
  return {
    inputMode: snapshot.hasPosition ? 'real' : 'pool-real',
    missingInputs: snapshot.hasPosition ? [] : ['position-nft'],
    isSynthetic: !snapshot.hasPosition,
    pool: snapshot.pool,
    pools: snapshot.pools ?? [],
    quoteRoutes: snapshot.quoteRoutes ?? [],
    poolCoverage: snapshot.poolCoverage,
    blockNumber: snapshot.blockNumber,
    fetchedAt: snapshot.fetchedAt,
    quotePrice: snapshot.quotePrice,
    quoteSymbol: snapshot.quoteSymbol,
  }
}
