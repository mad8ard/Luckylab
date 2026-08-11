import { describe, expect, it } from 'vitest'
import snapshots from '../../data/lp-onchain-snapshots.json'
import { buildLpDataState, resolveLpOnchainSnapshot } from '../market-data/lpOnchain.js'

describe('LP on-chain snapshots', () => {
  it('maps ETH samples to real Uniswap v3 pool snapshots', () => {
    const symbol = 'ETHUSDT'
      const resolved = resolveLpOnchainSnapshot({ symbol }, snapshots)
      expect(resolved.hasPool).toBe(true)
      expect(resolved.pools.length).toBeGreaterThanOrEqual(4)
      expect(resolved.quoteRoutes.length).toBeGreaterThanOrEqual(4)
      expect(new Set(resolved.quoteRoutes.map((route) => route.quoteSymbol))).toEqual(new Set(['USDT', 'USDC']))
      expect(resolved.poolCoverage.poolCount).toBe(resolved.pools.length)
      expect(resolved.poolCoverage.reserveUsd).toBeGreaterThan(0)
      expect(resolved.poolCoverage.volumeUsd24h).toBeGreaterThan(0)
      expect(resolved.poolCoverage.pairCount).toBeGreaterThan(0)
      expect(resolved.poolCoverage.protocolCount).toBeGreaterThan(0)
      expect(resolved.poolCoverage.topPoolReserveShare).toBeGreaterThan(0)
      expect(resolved.poolCoverage.topPools.length).toBeGreaterThan(0)
      expect(resolved.quoteRoutes.some((route) => route.reserveUsd > 0)).toBe(true)
      expect(resolved.quotePrice).toBeGreaterThan(1000)
      expect(resolved.quoteSymbol).toBe('USDT')

      const state = buildLpDataState(resolved)
      expect(state.inputMode).toBe('pool-real')
      expect(state.missingInputs).toEqual(['position-nft', 'tick-liquidity'])
      expect(state.poolEvidence).toBe('aggregate-snapshot')
      expect(state.capabilities.canValuePosition).toBe(false)
      expect(state.capabilities.canCompareTickDistribution).toBe(false)
      expect(state.quoteRoutes.length).toBe(resolved.quoteRoutes.length)
      expect(state.poolCoverage.routeCount).toBe(resolved.quoteRoutes.length)
  })

  it('keeps unmatched symbols explicit instead of pretending LP data exists', () => {
    const resolved = resolveLpOnchainSnapshot({ symbol: '600519' }, snapshots)
    expect(resolved.hasPool).toBe(false)
    expect(buildLpDataState(resolved).missingInputs).toEqual(['real-lp-pool'])
  })

  it('only treats complete, timestamped matching positions as real LP inventory', () => {
    const ethPool = snapshots.pools.find((pool) => {
      const symbols = [pool.token0Symbol, pool.token1Symbol].sort().join('/')
      return symbols === 'USDT/WETH' && pool.fee
    })
    const resolved = resolveLpOnchainSnapshot(
      { symbol: 'ETHUSDT' },
      {
        ...snapshots,
        positions: [
          {
            status: 'ok',
            token0: ethPool.token0,
            token1: ethPool.token1,
            fee: ethPool.fee,
            liquidity: '100',
          },
          {
            status: 'ok',
            token0: ethPool.token1,
            token1: ethPool.token0,
            fee: ethPool.fee,
            liquidity: '100',
          },
        ],
      },
    )

    expect(resolved.positions).toHaveLength(1)
    expect(resolved.positionEvidence).toBe('matched-incomplete')
    expect(buildLpDataState(resolved).inputMode).toBe('pool-real')

    const complete = resolveLpOnchainSnapshot(
      { symbol: 'ETHUSDT' },
      {
        ...snapshots,
        blockNumber: 123456,
        fetchedAt: '2026-08-07T00:00:00Z',
        positions: [
          {
            status: 'ok',
            tokenId: '42',
            token0: ethPool.token0,
            token1: ethPool.token1,
            fee: ethPool.fee,
            tickLower: -120,
            tickUpper: 120,
            liquidity: '100',
          },
        ],
      },
    )
    const state = buildLpDataState(complete)
    expect(complete.positionEvidence).toBe('position-real')
    expect(state.inputMode).toBe('real')
    expect(state.positions).toHaveLength(1)
    expect(state.capabilities.canValuePosition).toBe(true)
  })

  it('only treats timestamped, block-anchored ticks as real depth', () => {
    const undated = resolveLpOnchainSnapshot(
      { symbol: 'ETHUSDT' },
      {
        ...snapshots,
        fetchedAt: '',
        blockNumber: null,
        ticks: [{ lowerPrice: 1000, upperPrice: 4000, liquidityGross: '100' }],
      },
    )
    expect(undated.tickEvidence).toBe('matched-incomplete')
    expect(undated.ticks).toEqual([])
    expect(buildLpDataState(undated).missingInputs).toContain('timestamped-tick-liquidity')

    const dated = resolveLpOnchainSnapshot(
      { symbol: 'ETHUSDT' },
      {
        ...snapshots,
        fetchedAt: '2026-08-07T00:00:00Z',
        blockNumber: 123456,
        ticks: [{ lowerPrice: 1000, upperPrice: 4000, liquidityGross: '100' }],
      },
    )
    expect(dated.tickEvidence).toBe('tick-real')
    expect(dated.ticks).toHaveLength(1)
    expect(buildLpDataState(dated).capabilities.canCompareTickDistribution).toBe(true)
  })
})
