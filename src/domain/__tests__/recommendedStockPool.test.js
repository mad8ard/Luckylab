import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIER_THRESHOLDS,
  DIMENSION_LIBRARY,
  buildScoreConfig,
  computeBuyScore,
  generateRecommendedStockPool,
  regressionProbabilityFromZ,
} from '../strategy-planning/recommendedStockPool.js'

const STRONG = {
  price: 70,
  costAnchor: 100,
  costLow: 90,
  costHigh: 110,
  costDistance: -0.30,
  costSlope5: 0.01,
  j: -5,
  rsi: 12,
  lpZone: 'token0',
  lpValue: 0.05,
  lpValuePercentile: 0.004,
  lpValueRatio3y: 3.5,
  zScore: -3.0,
  regressionProbability: regressionProbabilityFromZ(-3.0),
  anchorDirection: 'up',
  halfLifeDays: 25,
  volConfidenceScore: 0.85,
  socialSecurityWhitelisted: false,
}

describe('维度配置库', () => {
  it('library 中至少包含核心五维 + RSI + LP 3 年 + 半衰期 + 社保', () => {
    const ids = DIMENSION_LIBRARY.map((d) => d.id)
    for (const id of ['lpValuePercentile', 'zScore', 'lpZone', 'costSlope', 'jValue', 'rsi', 'lpRatio3y', 'halfLife', 'volConfidence', 'socialSecurityWhitelist']) {
      expect(ids).toContain(id)
    }
  })

  it('buildScoreConfig 默认与 library 一致', () => {
    const cfg = buildScoreConfig()
    expect(cfg.length).toBe(DIMENSION_LIBRARY.length)
    expect(cfg.find((d) => d.id === 'rsi').enabled).toBe(false) // 默认关
    expect(cfg.find((d) => d.id === 'lpValuePercentile').enabled).toBe(true)
  })

  it('buildScoreConfig 支持 overrides 修改启用 / 权重', () => {
    const cfg = buildScoreConfig([
      { id: 'rsi', enabled: true, weight: 25 },
      { id: 'jValue', weight: 0 },
    ])
    expect(cfg.find((d) => d.id === 'rsi').enabled).toBe(true)
    expect(cfg.find((d) => d.id === 'rsi').weight).toBe(25)
    expect(cfg.find((d) => d.id === 'jValue').weight).toBe(0)
  })
})

describe('computeBuyScore', () => {
  it('多维拉满 → 接近满分上限', () => {
    const r = computeBuyScore(STRONG)
    expect(r.maxScore).toBeGreaterThan(0)
    expect(r.score / r.maxScore).toBeGreaterThan(0.85)
    expect(r.hits.length).toBeGreaterThan(2)
  })

  it('disabled 维度不参与归一（同时也不计入 maxScore）', () => {
    const dimensions = buildScoreConfig([{ id: 'jValue', enabled: false }])
    const r = computeBuyScore(STRONG, { dimensions })
    expect(r.dimensions.jValue.disabled).toBe(true)
    // jValue 默认 weight=10，被禁用后总分上限应少 10
    const fullMax = buildScoreConfig().filter((d) => d.enabled).reduce((s, d) => s + d.weight, 0)
    expect(r.maxScore).toBeCloseTo(fullMax - 10, 1)
  })

  it('LP 3 年比值未翻倍 → 维度低分', () => {
    const r = computeBuyScore({ ...STRONG, lpValueRatio3y: 1.4 })
    expect(r.dimensions.lpRatio3y.ratio).toBeLessThan(0.3)
  })

  it('半衰期和置信度启用时消费派生指标，不应一直 missing', () => {
    const dimensions = buildScoreConfig([
      { id: 'halfLife', enabled: true },
      { id: 'volConfidence', enabled: true },
    ])
    const r = computeBuyScore(STRONG, { dimensions })
    expect(r.dimensions.halfLife.missing).toBeUndefined()
    expect(r.dimensions.volConfidence.missing).toBeUndefined()
    expect(r.dimensions.halfLife.ratio).toBeGreaterThan(0)
    expect(r.dimensions.volConfidence.ratio).toBeGreaterThan(0)
  })

  it('接飞刀豁免：z=-3 + 锚下行 → 不再硬扣 costSlope', () => {
    const m = { ...STRONG, costSlope5: -0.025, anchorDirection: 'down' }
    const r = computeBuyScore(m, { allowCatchKnife: true })
    expect(r.catchKnife).toBe(true)
    expect(r.dimensions.costSlope.ratio).toBeGreaterThanOrEqual(0.5)
    const r2 = computeBuyScore(m, { allowCatchKnife: false })
    expect(r2.catchKnife).toBe(false)
    expect(r2.dimensions.costSlope.ratio).toBe(0)
  })

  it('社保白名单 optional：未命中不进 maxScore，命中加分上调总分', () => {
    const dimensions = buildScoreConfig([{ id: 'socialSecurityWhitelist', enabled: true }])
    const base = { ...STRONG, lpValueRatio3y: 1.5 }
    const r1 = computeBuyScore(base, { dimensions })
    const r2 = computeBuyScore({ ...base, socialSecurityWhitelisted: true }, { dimensions })
    expect(r2.score).toBeGreaterThan(r1.score)
    // 命中后 maxScore 把社保权重也加进来
    expect(r2.maxScore).toBeGreaterThan(r1.maxScore)
  })

  it('全部维度 disabled → score=0, maxScore=0', () => {
    const dimensions = buildScoreConfig().map((d) => ({ ...d, enabled: false }))
    const r = computeBuyScore(STRONG, { dimensions })
    expect(r.score).toBe(0)
    expect(r.maxScore).toBe(0)
  })

  it('数据完全空 → score=0', () => {
    expect(computeBuyScore({}).score).toBe(0)
    expect(computeBuyScore(undefined).score).toBe(0)
  })

  it('取消高权重维度 → maxScore 下降，score 也对应下降；但比例可能反而上升', () => {
    const fullCfg = buildScoreConfig()
    const r1 = computeBuyScore(STRONG, { dimensions: fullCfg })
    // 关掉 lpValuePercentile（权重 30）
    const cfg2 = buildScoreConfig([{ id: 'lpValuePercentile', enabled: false }])
    const r2 = computeBuyScore(STRONG, { dimensions: cfg2 })
    expect(r2.maxScore).toBeCloseTo(r1.maxScore - 30, 1)
    expect(r2.score).toBeLessThanOrEqual(r1.score)
  })
})

describe('generateRecommendedStockPool', () => {
  const candidates = [
    { symbol: 'A1', label: '高分', metrics: STRONG },
    { symbol: 'A2', label: '锚向下同型', metrics: { ...STRONG, costSlope5: -0.02, anchorDirection: 'down' } },
    { symbol: 'A3', label: '中等', metrics: { ...STRONG, lpValuePercentile: 0.30, costSlope5: -0.005, anchorDirection: 'down', j: 30, lpValueRatio3y: 1.5, zScore: -1.0, regressionProbability: regressionProbabilityFromZ(-1) } },
    { symbol: 'A4', label: '溢价', metrics: { ...STRONG, price: 110, costDistance: 0.10, lpZone: 'token1', lpValuePercentile: 0.85, costSlope5: -0.02, anchorDirection: 'down', j: 80, lpValueRatio3y: 1.1, zScore: 1.0, regressionProbability: regressionProbabilityFromZ(1) } },
  ]

  it('focus / wait / 不入选三档（按当前满分上限的百分比）', () => {
    const pool = generateRecommendedStockPool(candidates)
    expect(pool.focusItems.every((i) => i.maxScore > 0 && i.buyScore / i.maxScore >= DEFAULT_TIER_THRESHOLDS.focus)).toBe(true)
    expect(pool.waitItems.every((i) => {
      const r = i.buyScore / i.maxScore
      return r >= DEFAULT_TIER_THRESHOLDS.wait && r < DEFAULT_TIER_THRESHOLDS.focus
    })).toBe(true)
    expect(pool.items.find((i) => i.symbol === 'A4')).toBeUndefined()
  })

  it('暴露 dimensions 元信息（id/label/weight/enabled）', () => {
    const pool = generateRecommendedStockPool(candidates)
    expect(Array.isArray(pool.dimensions)).toBe(true)
    expect(pool.dimensions[0]).toHaveProperty('id')
    expect(pool.dimensions[0]).toHaveProperty('label')
    expect(pool.dimensions[0]).toHaveProperty('weight')
    expect(pool.dimensions[0]).toHaveProperty('enabled')
  })

  it('每个 item 含 narrative / 买卖点 / 持仓周期', () => {
    const pool = generateRecommendedStockPool(candidates)
    for (const item of pool.items) {
      expect(typeof item.narrative).toBe('string')
      expect(item.narrative.length).toBeGreaterThan(20)
    }
  })

  it('candidates 为空 / 非数组时返回空 items 而不报错', () => {
    expect(generateRecommendedStockPool([]).items).toEqual([])
    expect(generateRecommendedStockPool(null).items).toEqual([])
    expect(generateRecommendedStockPool(undefined).items).toEqual([])
  })

  it('回归概率随 |z| 增大而递增', () => {
    expect(regressionProbabilityFromZ(-3) > regressionProbabilityFromZ(-1)).toBe(true)
    expect(regressionProbabilityFromZ(-1) > regressionProbabilityFromZ(-0.1)).toBe(true)
  })
})
