import { describe, expect, it } from 'vitest'
import { buildLiquidityOpportunity } from '../research-visualization/liquidityOpportunity.js'
import { buildLiquidityRackModel } from '../research-visualization/liquidityRackModel.js'

describe('buildLiquidityRackModel', () => {
  it('构建价格仓查询模型，不修改挂单计划', () => {
    const rows = Array.from({ length: 80 }, (_, i) => {
      const close = 100 + Math.sin(i / 8) * 8
      return { date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`, open: close - 1, high: close + 2, low: close - 2, close, volume: 1000 }
    })
    const costPath = rows.map((row) => ({ date: row.date, anchor: 100, lower: 92, upper: 108 }))
    const formulaPath = rows.map((row) => ({ date: row.date, deltaLower: 90, deltaUpper: 112 }))
    const primaryOrders = [
      { side: 'buy', role: '试仓', price: 94, notional: 1000 },
      { side: 'sell', role: '减压', price: 109, notional: 500 },
    ]
    const graph = { inputs: { entryPrice: 100 }, plan: { primaryOrders } }

    const model = buildLiquidityRackModel({ rows, costPath, formulaPath, graph, activeIndex: 79, binCount: 72 })

    expect(model.shelves).toHaveLength(72)
    expect(model.ticks).toHaveLength(5)
    expect(model.priceStep).toBeGreaterThan(0)
    expect(model.meta.compositionLabel).toContain('暂显示模型目标仓')
    expect(model.meta.orderLabel).toBe('挂单刻度来自模拟挂单')
    expect(model.meta.sourceLabel).toContain('现价/成本/区间/挂单成分')
    expect(model.markers.map((m) => m.label)).toEqual(['现价', '成本', 'Δ上', 'Δ下'])
    expect(model.orderTicks).toHaveLength(2)
    expect(model.status).toBe('research-only')
    expect(model.inputMode).toBe('hybrid-model')
    expect(model.viewMode).toBe('compare')
    expect(model.effectiveViewMode).toBe('simulate')
    expect(model.shareLabel).toBe('模型权重')
    expect(model.viewLabel).toBe('对照待接入')
    expect(model.meta.lpModeLabel).toBe('待匹配')
    expect(model.meta.dataLabel).toContain('未匹配链上池级快照')
    expect(model.components.reduce((sum, component) => sum + component.normalizedWeight, 0)).toBeCloseTo(1)
    expect(model.components.map((component) => component.id)).toContain('orders')
    expect(model.fingerprintStats.orderShare).toBeGreaterThan(0)
    expect(model.shelves.some((shelf) => shelf.componentShare.orders > 0)).toBe(true)
    expect(graph.plan.primaryOrders).toBe(primaryOrders)
  })

  it('标注池级链上数据与目标仓模型比例的边界', () => {
    const rows = [
      { date: '2024-01-01', open: 100, high: 105, low: 95, close: 100, volume: 1000 },
      { date: '2024-01-02', open: 100, high: 106, low: 94, close: 102, volume: 1100 },
    ]
    const costPath = rows.map((row) => ({ date: row.date, anchor: 100, lower: 90, upper: 110 }))
    const formulaPath = rows.map((row) => ({ date: row.date, deltaLower: 88, deltaUpper: 115 }))

    const model = buildLiquidityRackModel({
      rows,
      costPath,
      formulaPath,
      activeIndex: 1,
      graph: {
        inputs: { entryPrice: 100 },
        plan: { primaryOrders: [] },
        lpOnchain: {
          inputMode: 'pool-real',
          quotePrice: 102,
          pool: { label: 'WETH / USDT 0.05%', tickSpacing: 10, liquidity: '1000' },
          quoteRoutes: [
            { quoteSymbol: 'USDT', quotePrice: 102, weight: 8, pools: [{ label: 'WETH / USDT 0.05%', tickSpacing: 10, reserveUsd: 100 }] },
            { quoteSymbol: 'USDC', quotePrice: 101.8, weight: 6, pools: [{ label: 'WETH / USDC 0.05%', tickSpacing: 10, reserveUsd: 80 }] },
          ],
          poolCoverage: { poolCount: 2, routeCount: 2, quoteSymbols: ['USDT', 'USDC'], reserveUsd: 180, volumeUsd24h: 40 },
        },
      },
    })

    expect(model.meta.dataLabel).toContain('2 个池 / 2 条 USDT+USDC 路径')
    expect(model.meta.dataLabel).toContain('蓄水')
    expect(model.meta.dataLabel).toContain('校准模型目标仓')
    expect(model.realProfile.routes).toHaveLength(2)
    expect(model.realProfile.hasSignal).toBe(true)
    expect(model.shelves.reduce((sum, shelf) => sum + shelf.realShare, 0)).toBeCloseTo(1)
    expect(model.meta.nextInputs).toContain('补充 tick 分布 / liquidityGross / liquidityNet 或区间深度')
    expect(model.meta.nextInputs).toContain('接入钱包 Position NFT 区间和本金')
  })

  it('支持模拟、真实、对照和缺口权重视图', () => {
    const rows = [
      { date: '2024-01-01', open: 100, high: 105, low: 95, close: 100, volume: 1000 },
      { date: '2024-01-02', open: 100, high: 106, low: 94, close: 102, volume: 1100 },
    ]
    const costPath = rows.map((row) => ({ date: row.date, anchor: 100, lower: 90, upper: 110 }))
    const formulaPath = rows.map((row) => ({ date: row.date, deltaLower: 88, deltaUpper: 115 }))
    const graph = {
      inputs: { entryPrice: 100 },
      plan: { primaryOrders: [] },
      lpOnchain: {
        inputMode: 'pool-real',
        quotePrice: 102,
        pool: { label: 'WETH / USDT 0.05%', tickSpacing: 10, liquidity: '1000' },
        quoteRoutes: [
          { quoteSymbol: 'USDT', quotePrice: 102, weight: 8, pools: [{ label: 'WETH / USDT 0.05%', tickSpacing: 10, reserveUsd: 100 }] },
          { quoteSymbol: 'USDC', quotePrice: 101.8, weight: 6, pools: [{ label: 'WETH / USDC 0.05%', tickSpacing: 10, reserveUsd: 80 }] },
        ],
        poolCoverage: { poolCount: 2, routeCount: 2, quoteSymbols: ['USDT', 'USDC'], reserveUsd: 180 },
      },
    }

    const simulated = buildLiquidityRackModel({ rows, costPath, formulaPath, graph, activeIndex: 1, viewMode: 'simulate' })
    const real = buildLiquidityRackModel({ rows, costPath, formulaPath, graph, activeIndex: 1, viewMode: 'real' })
    const compared = buildLiquidityRackModel({ rows, costPath, formulaPath, graph, activeIndex: 1, viewMode: 'compare' })
    const gap = buildLiquidityRackModel({ rows, costPath, formulaPath, graph, activeIndex: 1, viewMode: 'gap' })

    expect(simulated.shareLabel).toBe('模型权重')
    expect(real.shareLabel).toBe('池状态信号')
    expect(compared.shareLabel).toBe('模型 / 真实')
    expect(gap.shareLabel).toBe('缺口')
    expect(real.shelves.some((shelf) => shelf.densityShare === shelf.realShare && shelf.realShare > 0)).toBe(true)
    expect(compared.shelves.some((shelf) => shelf.densityShare === shelf.modelShare && shelf.realShare > 0)).toBe(true)
    expect(gap.shelves.some((shelf) => shelf.densityShare === Math.max(shelf.modelShare - shelf.realShare, 0))).toBe(true)
  })

  it('缺口视图支持缺口、偏差和反差三种差值风格', () => {
    const rows = [
      { date: '2024-01-01', open: 100, high: 105, low: 95, close: 100, volume: 1000 },
      { date: '2024-01-02', open: 100, high: 106, low: 94, close: 102, volume: 1100 },
    ]
    const costPath = rows.map((row) => ({ date: row.date, anchor: 100, lower: 90, upper: 110 }))
    const formulaPath = rows.map((row) => ({ date: row.date, deltaLower: 88, deltaUpper: 115 }))
    const graph = {
      inputs: { entryPrice: 100 },
      plan: { primaryOrders: [] },
      lpOnchain: {
        inputMode: 'pool-real',
        quotePrice: 102,
        pool: { label: 'WETH / USDT 0.05%', tickSpacing: 10, liquidity: '1000' },
        quoteRoutes: [
          { quoteSymbol: 'USDT', quotePrice: 102, weight: 8, pools: [{ label: 'WETH / USDT 0.05%', tickSpacing: 10, reserveUsd: 100 }] },
          { quoteSymbol: 'USDC', quotePrice: 101.8, weight: 6, pools: [{ label: 'WETH / USDC 0.05%', tickSpacing: 10, reserveUsd: 80 }] },
        ],
        poolCoverage: { poolCount: 2, routeCount: 2, quoteSymbols: ['USDT', 'USDC'], reserveUsd: 180 },
      },
    }

    const shortfall = buildLiquidityRackModel({ rows, costPath, formulaPath, graph, activeIndex: 1, viewMode: 'gap' })
    const signed = buildLiquidityRackModel({ rows, costPath, formulaPath, graph, activeIndex: 1, viewMode: 'gap', gapMode: 'signed' })
    const absolute = buildLiquidityRackModel({ rows, costPath, formulaPath, graph, activeIndex: 1, viewMode: 'gap', gapMode: 'absolute' })
    const negativeSignedShelf = signed.shelves.find((shelf) => shelf.realGap < 0)

    expect(shortfall.gapModeLabel).toBe('缺口')
    expect(signed.gapModeLabel).toBe('偏差')
    expect(absolute.gapModeLabel).toBe('反差')
    expect(shortfall.shelves.every((shelf) => shelf.gapShare === Math.max(shelf.modelShare - shelf.realShare, 0))).toBe(true)
    expect(signed.shelves.every((shelf) => shelf.gapShare === shelf.modelShare - shelf.realShare)).toBe(true)
    expect(absolute.shelves.every((shelf) => shelf.gapShare === Math.abs(shelf.modelShare - shelf.realShare))).toBe(true)
    expect(negativeSignedShelf?.gapShare).toBeLessThan(0)
    expect(negativeSignedShelf?.densityShare).toBeCloseTo(Math.abs(negativeSignedShelf.gapShare))
  })

  it('fallback 链上数据不伪装成真实池状态', () => {
    const rows = [
      { date: '2024-01-01', open: 100, high: 105, low: 95, close: 100, volume: 1000 },
      { date: '2024-01-02', open: 100, high: 106, low: 94, close: 102, volume: 1100 },
    ]
    const costPath = rows.map((row) => ({ date: row.date, anchor: 100, lower: 90, upper: 110 }))
    const formulaPath = rows.map((row) => ({ date: row.date, deltaLower: 88, deltaUpper: 115 }))
    const graph = { inputs: { entryPrice: 100 }, plan: { primaryOrders: [] }, lpOnchain: { inputMode: 'fallback' } }

    const model = buildLiquidityRackModel({ rows, costPath, formulaPath, graph, activeIndex: 1, viewMode: 'real' })

    expect(model.viewMode).toBe('real')
    expect(model.effectiveViewMode).toBe('simulate')
    expect(model.hasRealSignal).toBe(false)
    expect(model.shareLabel).toBe('模型权重')
    expect(model.viewLabel).toBe('真实待接入')
    expect(model.meta.title).toBe('真实层待匹配')
    expect(model.meta.lpModeLabel).toBe('待匹配')
    expect(model.shelves.some((shelf) => shelf.densityShare === shelf.modelShare && shelf.modelShare > 0)).toBe(true)
  })

  it('缺口视图缺少真实池时回退模型且不伪装真实层', () => {
    const rows = [
      { date: '2024-01-01', open: 100, high: 105, low: 95, close: 100, volume: 1000 },
      { date: '2024-01-02', open: 100, high: 106, low: 94, close: 102, volume: 1100 },
    ]
    const costPath = rows.map((row) => ({ date: row.date, anchor: 100, lower: 90, upper: 110 }))
    const formulaPath = rows.map((row) => ({ date: row.date, deltaLower: 88, deltaUpper: 115 }))
    const graph = { inputs: { entryPrice: 100 }, plan: { primaryOrders: [] }, lpOnchain: { inputMode: 'fallback' } }

    const model = buildLiquidityRackModel({ rows, costPath, formulaPath, graph, activeIndex: 1, viewMode: 'gap' })

    expect(model.viewMode).toBe('gap')
    expect(model.effectiveViewMode).toBe('simulate')
    expect(model.hasRealSignal).toBe(false)
    expect(model.shareLabel).toBe('模型权重')
    expect(model.viewLabel).toBe('缺口待接入')
    expect(model.meta.title).toBe('真实层待匹配')
    expect(model.shelves.some((shelf) => shelf.densityShare === shelf.modelShare && shelf.modelShare > 0)).toBe(true)
  })

  it('从模型和真实池差值反推情绪机会信号', () => {
    const shelves = [
      { lower: 110, upper: 120, mid: 115, modelShare: 0.18, realShare: 0.04 },
      { lower: 100, upper: 110, mid: 105, modelShare: 0.12, realShare: 0.08 },
      { lower: 90, upper: 100, mid: 95, modelShare: 0.06, realShare: 0.2 },
      { lower: 80, upper: 90, mid: 85, modelShare: 0.08, realShare: 0.1 },
    ]

    const signal = buildLiquidityOpportunity({ shelves, activePrice: 100, hasRealSignal: true })

    expect(signal.status).toBe('active')
    expect(signal.label).toBe('上侧补位')
    expect(signal.action).toBe('观察突破确认')
    expect(signal.zones.shortfall[0]).toMatchObject({ lower: 110, upper: 120, side: 'above' })
    expect(signal.totals.aboveShortfall).toBeCloseTo(0.18)
    expect(signal.totals.belowCrowded).toBeCloseTo(0.16)
    expect(signal.confidence).toBeGreaterThan(0)
  })

  it('真实层缺失时机会算法保持待校准状态', () => {
    const signal = buildLiquidityOpportunity({
      shelves: [{ lower: 90, upper: 100, mid: 95, modelShare: 0.2, realShare: 0 }],
      activePrice: 100,
      hasRealSignal: false,
    })

    expect(signal.status).toBe('pending')
    expect(signal.label).toBe('等待真实层')
    expect(signal.zones.shortfall).toEqual([])
    expect(signal.confidence).toBe(0)
  })
})
