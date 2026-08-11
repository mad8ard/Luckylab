import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIER_THRESHOLDS,
  DIMENSION_LIBRARY,
  buildScoreConfig,
  computeBuyScore,
  deriveRecommendedStockDecisionMetrics,
  generateRecommendedStockPool,
  deviationPercentileFromZ,
} from '../strategy-planning/recommendedStockPool.js'

const STRONG = {
  price: 70,
  costAnchor: 100,
  costLow: 90,
  costHigh: 110,
  costDistance: -0.3,
  costSlopeRecent: 0.01,
  j: -5,
  rsi: 12,
  lpZone: 'token0',
  lpValue: 0.05,
  lpValuePercentile: 0.004,
  lpValueRatio3y: 3.5,
  zScore: -3.0,
  deviationPercentile: deviationPercentileFromZ(-3.0),
  anchorDirection: 'up',
  halfLifeSessions: 25,
  formulaHorizonSessions: 18,
  tradingDays: 242,
  arCoefficient: 0.8,
  meanReversionMonotonicGate: true,
  meanReversionCalibrationStatus: 'sample-only',
  meanReversionCalibrationId: null,
  volSampleQualityScore: 0.85,
  socialSecurityWhitelisted: false,
}

describe('维度配置库', () => {
  it('library 包含研究维度，且 RSI/KDJ 不得成为可配置评分输入', () => {
    const ids = DIMENSION_LIBRARY.map((d) => d.id)
    for (const id of [
      'lpValuePercentile',
      'zScore',
      'lpZone',
      'costSlope',
      'lpRatio3y',
      'halfLife',
      'volConfidence',
      'socialSecurityWhitelist',
    ]) {
      expect(ids).toContain(id)
    }
    expect(ids).not.toContain('rsi')
    expect(ids).not.toContain('jValue')
  })

  it('buildScoreConfig 默认与 library 一致', () => {
    const cfg = buildScoreConfig()
    expect(cfg.length).toBe(DIMENSION_LIBRARY.length)
    expect(cfg.find((d) => d.id === 'lpValuePercentile').enabled).toBe(true)
  })

  it('buildScoreConfig 忽略 RSI/KDJ override，不能绕过 skill 禁令', () => {
    const cfg = buildScoreConfig([
      { id: 'rsi', enabled: true, weight: 25 },
      { id: 'jValue', enabled: true, weight: 25 },
    ])
    expect(cfg.find((d) => d.id === 'rsi')).toBeUndefined()
    expect(cfg.find((d) => d.id === 'jValue')).toBeUndefined()
  })

  it('computeBuyScore 也拒绝调用方直接注入 RSI/KDJ 维度', () => {
    const dimensions = [
      ...buildScoreConfig(),
      { id: 'rsi', label: 'forbidden RSI', enabled: true, weight: 1000, requires: ['rsi'], score: () => 1 },
      { id: 'jValue', label: 'forbidden KDJ', enabled: true, weight: 1000, requires: ['j'], score: () => 1 },
    ]
    const result = computeBuyScore(STRONG, { dimensions })
    expect(result.dimensions.rsi).toMatchObject({ score: 0, disabled: true, forbidden: true })
    expect(result.dimensions.jValue).toMatchObject({ score: 0, disabled: true, forbidden: true })
    expect(result.maxScore).toBeLessThan(1000)
  })

  it('拒绝别名维度，并让合法 ID 重新绑定 canonical scorer 而不是执行恶意闭包', () => {
    const actual = {
      ...STRONG,
      zScore: 0,
      rawRsi: 12,
      indicators: { j: -5 },
    }
    const alias = {
      id: 'momentumAlias',
      label: 'alias RSI',
      enabled: true,
      weight: 1000,
      requires: ['rawRsi'],
      score: () => (actual.rawRsi < 30 ? 1 : 0),
    }
    const zDimension = buildScoreConfig().find((dimension) => dimension.id === 'zScore')
    const hijackedAllowedId = {
      ...zDimension,
      weight: 1000,
      requires: ['price'],
      score: () => (actual.rawRsi < 30 && actual.indicators.j < 20 ? 1 : 0),
    }
    const result = computeBuyScore(actual, { dimensions: [alias, hijackedAllowedId, hijackedAllowedId] })
    expect(result.dimensions.momentumAlias).toMatchObject({
      score: 0,
      forbidden: true,
      forbiddenReason: 'dimension-id-not-in-library',
    })
    expect(result.dimensions.zScore.score).toBeCloseTo(0)
    expect(result.dimensions.zScore.label).toBe(zDimension.label)
    expect(result.maxScore).toBe(1000)
    expect(result.rejectedDimensions).toContainEqual({ id: 'zScore', reason: 'duplicate-dimension-id' })
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
    const dimensions = buildScoreConfig([{ id: 'lpValuePercentile', enabled: false }])
    const r = computeBuyScore(STRONG, { dimensions })
    expect(r.dimensions.lpValuePercentile.disabled).toBe(true)
    const fullMax = buildScoreConfig()
      .filter((d) => d.enabled)
      .reduce((s, d) => s + d.weight, 0)
    expect(r.maxScore).toBeCloseTo(fullMax - 30, 1)
  })

  it('LP 3 年比值未翻倍 → 维度低分', () => {
    const r = computeBuyScore({ ...STRONG, lpValueRatio3y: 1.4 })
    expect(r.dimensions.lpRatio3y.ratio).toBeLessThan(0.3)
  })

  it('半衰期和样本质量启用时消费派生指标，不应一直 missing', () => {
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

  it('样本内单调 AR 不能豁免成本锚下行，必须有独立留出校准标识', () => {
    const m = { ...STRONG, costSlopeRecent: -0.025, anchorDirection: 'down' }
    const r = computeBuyScore(m, { allowCatchKnife: true })
    expect(r.catchKnife).toBe(false)
    expect(r.dimensions.costSlope.ratio).toBe(0)

    const validated = {
      ...m,
      meanReversionCalibrationStatus: 'holdout-validated',
      meanReversionCalibrationId: 'holdout-2026q2-v1',
    }
    const promoted = computeBuyScore(validated, { allowCatchKnife: true })
    expect(promoted.catchKnife).toBe(true)
    expect(promoted.dimensions.costSlope.ratio).toBeGreaterThanOrEqual(0.5)

    const disabled = computeBuyScore(validated, { allowCatchKnife: false })
    expect(disabled.catchKnife).toBe(false)
    expect(disabled.dimensions.costSlope.ratio).toBe(0)
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

describe('deriveRecommendedStockDecisionMetrics', () => {
  const costDistanceSeries = Array.from({ length: 20 }, (_, index) => -0.2 * 0.8 ** index)

  it.each([
    {
      label: '结构不适用',
      input: { price: 90.04, costAnchor: 88.44, costLow: 83.53 },
      status: 'not-applicable',
      claimClass: null,
      reason: 'cycle-start-at-or-beyond-anchor',
    },
    {
      label: '结构目标越过锚点',
      input: { price: 80, costAnchor: 100, costLow: 105 },
      status: 'model-gate-failed',
      claimClass: null,
      reason: 'target-not-strictly-between-cycle-start-and-anchor',
    },
    {
      label: '确实缺输入',
      input: { price: null, costAnchor: 100, costLow: 90 },
      status: 'missing-input',
      claimClass: 'missing-input',
      reason: 'invalid-recovery-input',
    },
  ])('$label 时周期状态与结果声明不混用', ({ input, status, claimClass, reason }) => {
    const result = deriveRecommendedStockDecisionMetrics({
      ...input,
      costDistanceSeries,
      tradingDaysPerYear: 242,
    })

    expect(result.formulaHorizonSessions).toBeNull()
    expect(result.holdingProjectionStatus).toBe(status)
    expect(result.holdingProjectionClaimClass).toBe(claimClass)
    expect(result.holdingProjectionReason).toBe(reason)
  })

  it('可用周期仍保留 scenario-proxy 结果声明', () => {
    const result = deriveRecommendedStockDecisionMetrics({
      price: 80,
      costAnchor: 100,
      costLow: 90,
      costDistanceSeries,
      tradingDaysPerYear: 242,
    })

    expect(result.holdingProjectionStatus).toBe('eligible')
    expect(result.holdingProjectionClaimClass).toBe('scenario-proxy')
    expect(result.formulaHorizonSessions).toBeGreaterThan(0)
  })
})

describe('generateRecommendedStockPool', () => {
  const candidates = [
    { symbol: 'A1', label: '高分', metrics: STRONG },
    { symbol: 'A2', label: '锚向下同型', metrics: { ...STRONG, costSlopeRecent: -0.02, anchorDirection: 'down' } },
    {
      symbol: 'A3',
      label: '中等',
      metrics: {
        ...STRONG,
        lpValuePercentile: 0.3,
        costSlopeRecent: -0.005,
        anchorDirection: 'down',
        j: 30,
        lpValueRatio3y: 1.5,
        zScore: -1.0,
        deviationPercentile: deviationPercentileFromZ(-1),
      },
    },
    {
      symbol: 'A4',
      label: '溢价',
      metrics: {
        ...STRONG,
        price: 110,
        costDistance: 0.1,
        lpZone: 'token1',
        lpValuePercentile: 0.85,
        costSlopeRecent: -0.02,
        anchorDirection: 'down',
        j: 80,
        lpValueRatio3y: 1.1,
        zScore: 1.0,
        deviationPercentile: deviationPercentileFromZ(1),
      },
    },
  ]

  it('focus / wait / 不入选三档（按当前满分上限的百分比）', () => {
    const pool = generateRecommendedStockPool(candidates)
    expect(
      pool.focusItems.every((i) => i.maxScore > 0 && i.buyScore / i.maxScore >= DEFAULT_TIER_THRESHOLDS.focus),
    ).toBe(true)
    expect(
      pool.waitItems.every((i) => {
        const r = i.buyScore / i.maxScore
        return r >= DEFAULT_TIER_THRESHOLDS.wait && r < DEFAULT_TIER_THRESHOLDS.focus
      }),
    ).toBe(true)
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

  it('每个 item 含 narrative / 研究坐标 / 条件周期', () => {
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

  it('偏离百分位随 |z| 增大而递增，但不命名为回归概率', () => {
    expect(deviationPercentileFromZ(-3) > deviationPercentileFromZ(-1)).toBe(true)
    expect(deviationPercentileFromZ(-1) > deviationPercentileFromZ(-0.1)).toBe(true)
  })
})
