// 推荐股票池 v3：声明式可勾选可调权评分模型（主入口）
//
// 核心特性：
//   - 维度通过 DIMENSION_LIBRARY 声明（见 ./recommendedStockPool/dimensions.js）
//   - UI / URL 调权：调用方传入 overrides（部分启用/禁用 + 改权重），
//     buildScoreConfig 合并出最终配置
//   - 数据缺失（requires 字段缺失）自动跳过该维度，剩余维度按比例归一
//   - 趋势下行豁免默认关闭；样本内 AR 不够，必须有独立留出验证标识

import {
  deriveRecoveryHorizon,
  deviationScore,
  getDeltaBands,
  meanReversionHalfLife,
  volConfidence,
} from '../formulas/core.js'

import {
  DEFAULT_OPTIONS,
  DEFAULT_TIER_THRESHOLDS,
  DIMENSION_LIBRARY,
  FORBIDDEN_SCORE_DIMENSION_IDS,
  FORBIDDEN_SCORE_INPUT_KEYS,
  hasValidatedMeanReversion,
} from './recommendedStockPool/dimensions.js'

import {
  classify,
  clamp01,
  formatHit,
  deviationPercentileFromZ,
  deviationReferenceFromZ,
  round1,
  round2,
} from './recommendedStockPool/scoring-utils.js'

import { buildNarrative } from './recommendedStockPool/narrative.js'

// 对外保留的常量与工具，与重构前保持兼容
export { DEFAULT_TIER_THRESHOLDS, DIMENSION_LIBRARY, deviationPercentileFromZ, deviationReferenceFromZ }

/**
 * 合并默认维度库 + 用户 overrides 形成最终评分配置。
 * overrides 形如：[{ id, enabled?, weight? }]
 */
export function buildScoreConfig(overrides = []) {
  const map = new Map()
  for (const d of DIMENSION_LIBRARY) map.set(d.id, { ...d })
  for (const o of overrides ?? []) {
    if (!o || !o.id || !map.has(o.id)) continue
    const cur = map.get(o.id)
    if (typeof o.enabled === 'boolean') cur.enabled = o.enabled
    if (Number.isFinite(o.weight) && o.weight >= 0) cur.weight = o.weight
  }
  return [...map.values()]
}

/**
 * 计算单只股票的 buyScore（原始加权和，不归一化）。
 *   - 启用 + 数据充分 + 评分有效的维度：贡献 ratio × weight
 *   - disabled / missing 维度：直接跳过，不进入分母（也不补满）
 *   - 取消某个维度的权重 → 总分上限随之下降；buyScore 与"当前启用维度的满分"成同一坐标系
 *   options.dimensions 是评分维度数组（默认 buildScoreConfig() ）
 *   options.allowCatchKnife 控制独立留出校准后的人工豁免（默认关闭；保留旧字段名以兼容调用）
 */
export function computeBuyScore(metrics, options = {}) {
  const forbiddenInputKeys = new Set(FORBIDDEN_SCORE_INPUT_KEYS)
  const safe = Object.fromEntries(Object.entries(metrics ?? {}).filter(([key]) => !forbiddenInputKeys.has(key)))
  const requestedDimensions = options.dimensions ?? buildScoreConfig()
  const ctx = { options: { ...DEFAULT_OPTIONS, ...options } }
  const forbiddenDimensionIds = new Set(FORBIDDEN_SCORE_DIMENSION_IDS)
  const allowedDimensionIds = new Set(DIMENSION_LIBRARY.map((dimension) => dimension.id))
  const canonicalDimensionsById = new Map(DIMENSION_LIBRARY.map((dimension) => [dimension.id, dimension]))
  const seenDimensionIds = new Set()
  const canonicalizedDimensions = []

  const result = {
    score: 0,
    dimensions: {},
    hits: [],
    catchKnife: false,
    maxScore: 0,
    activeWeight: 0,
    rejectedDimensions: [],
  }
  let totalScore = 0
  let activeWeight = 0

  for (const requested of requestedDimensions) {
    const id = requested?.id
    if (typeof id !== 'string' || !id) {
      result.rejectedDimensions.push({ id: null, reason: 'invalid-dimension-id' })
      continue
    }
    const canonical = canonicalDimensionsById.get(id)
    const requiresForbiddenInput = (canonical?.requires ?? []).some((key) => forbiddenInputKeys.has(key))
    if (!allowedDimensionIds.has(id) || forbiddenDimensionIds.has(id) || requiresForbiddenInput) {
      const forbiddenReason = forbiddenDimensionIds.has(id)
        ? 'forbidden-dimension-id'
        : !allowedDimensionIds.has(id)
          ? 'dimension-id-not-in-library'
          : 'forbidden-indicator-input'
      result.dimensions[id] = {
        ratio: 0,
        score: 0,
        weight: Number.isFinite(requested?.weight) ? requested.weight : 0,
        label: canonical?.label ?? String(requested?.label ?? id),
        disabled: true,
        forbidden: true,
        forbiddenReason,
      }
      result.rejectedDimensions.push({ id, reason: forbiddenReason })
      continue
    }
    if (seenDimensionIds.has(id)) {
      result.rejectedDimensions.push({ id, reason: 'duplicate-dimension-id' })
      continue
    }
    seenDimensionIds.add(id)
    // The caller may tune only enabled/weight. Business semantics always come
    // from the canonical library; never execute caller-supplied score/requires.
    const d = {
      ...canonical,
      enabled: typeof requested?.enabled === 'boolean' ? requested.enabled : canonical.enabled,
      weight: Number.isFinite(requested?.weight) && requested.weight >= 0 ? requested.weight : canonical.weight,
    }
    canonicalizedDimensions.push(d)
    if (!d.enabled || d.weight <= 0) {
      result.dimensions[d.id] = { ratio: 0, score: 0, weight: d.weight, label: d.label, disabled: true }
      continue
    }
    const ready = d.requires.every(
      (k) => safe[k] !== null && safe[k] !== undefined && (typeof safe[k] !== 'number' || Number.isFinite(safe[k])),
    )
    if (!ready) {
      result.dimensions[d.id] = { ratio: 0, score: 0, weight: d.weight, label: d.label, missing: true }
      continue
    }
    const r = d.score(safe, ctx)
    if (r === null) {
      // optional 维度未命中 → 当作 missing，不进总分上限
      // 非 optional 维度评分函数返回 null（理论上不应发生）→ 视为 missing
      result.dimensions[d.id] = { ratio: 0, score: 0, weight: d.weight, label: d.label, missing: true }
      continue
    }
    const ratio = clamp01(r)
    const score = ratio * d.weight
    result.dimensions[d.id] = { ratio, score: round2(score), weight: d.weight, label: d.label }
    totalScore += score
    activeWeight += d.weight
  }

  // 样本内 AR 不能豁免下行趋势；要求独立留出验证状态和校准标识。
  if (
    ctx.options.allowCatchKnife &&
    Number.isFinite(safe.zScore) &&
    safe.zScore <= -1.5 &&
    hasValidatedMeanReversion(safe)
  ) {
    result.catchKnife = true
  }

  result.score = round1(totalScore)
  result.maxScore = round1(activeWeight)
  result.activeWeight = activeWeight

  // 命中条件（维度评分 ≥ 80% 满分）
  for (const d of canonicalizedDimensions) {
    const r = result.dimensions[d.id]
    if (!r || r.disabled || r.missing) continue
    if (r.ratio >= 0.8) {
      result.hits.push(formatHit(d.id, safe))
    }
  }
  if (result.catchKnife) result.hits.push('独立留出校准豁免（人工开启）')

  return result
}

/**
 * 生成研究观察池（按三档分级；保留旧函数名与 JSON 字段以兼容静态消费者）。
 *
 * options:
 *   - dimensions  评分维度数组
 *   - allowCatchKnife  独立留出校准人工豁免开关（兼容旧字段名）
 *   - tiers       { focus, wait } 阈值
 *   - topN        每档最多展示数量
 *   - generatedAt  ISO 时间
 */
export function generateRecommendedStockPool(candidates, options = {}) {
  const dimensions = options.dimensions ?? buildScoreConfig()
  const tiers = options.tiers ?? DEFAULT_TIER_THRESHOLDS
  const topN = Number.isFinite(options.topN) && options.topN > 0 ? Math.floor(options.topN) : 10
  const allowCatchKnife = options.allowCatchKnife ?? DEFAULT_OPTIONS.allowCatchKnife
  const list = Array.isArray(candidates) ? candidates : []
  const generatedAt = options.generatedAt ?? new Date().toISOString()

  const scored = []
  for (const candidate of list) {
    if (!candidate || !candidate.symbol) continue
    const m = { ...(candidate.metrics ?? {}) }
    const metrics = { ...m, ...deriveRecommendedStockDecisionMetrics(m) }
    const result = computeBuyScore(metrics, { dimensions, allowCatchKnife })
    if (!Number.isFinite(result.score)) continue
    scored.push({
      symbol: candidate.symbol,
      label: candidate.label ?? candidate.symbol,
      market: candidate.market ?? '',
      metrics,
      buyScore: result.score,
      maxScore: result.maxScore,
      dimensions: result.dimensions,
      hits: result.hits,
      catchKnife: result.catchKnife,
      tier: classify(result.score, result.maxScore, tiers),
      narrative: buildNarrative({
        label: candidate.label ?? candidate.symbol,
        score: result.score,
        maxScore: result.maxScore,
        dimensions: result.dimensions,
        catchKnife: result.catchKnife,
        metrics,
      }),
    })
  }

  scored.sort((a, b) => b.buyScore - a.buyScore)

  const focusItems = scored.filter((s) => s.tier === 'focus').slice(0, topN)
  const waitItems = scored.filter((s) => s.tier === 'wait').slice(0, topN)
  const items = [...focusItems, ...waitItems]

  return {
    generatedAt,
    generatedDate: generatedAt.slice(0, 10),
    totalCandidates: list.length,
    scoredCount: scored.length,
    topN,
    tiers,
    options: { allowCatchKnife },
    dimensions: dimensions.map((d) => ({
      id: d.id,
      label: d.label,
      weight: d.weight,
      enabled: d.enabled,
      optional: d.optional,
    })),
    items,
    focusItems,
    waitItems,
    logic:
      '本次观察池采用多维研究排序：每个维度可独立勾选并调整权重；诊断分数（JSON 兼容字段 buyScore）是「启用维度的原始加权和」' +
      '（取消任何一个维度，总分上限自动下降）。当诊断分数 ≥ 当前满分上限的 65% 进入「研究关注」，' +
      '40%~65% 为「等待」。z 分位只描述偏离极端度，不代表未来回归概率；成本锚仍下降时默认不豁免。',
    riskNote: '本结果是观察排序，不代表立即反转或执行建议；动态 LP 指标是合成价格几何代理，不是做市商真实仓位。',
  }
}

// ── 派生计算（半衰期 / 条件周期 / 研究参考坐标） ─────────────────────

export function deriveRecommendedStockDecisionMetrics(metrics) {
  const out = {}
  const tradingDaysPerYear = Number(metrics.tradingDaysPerYear)
  const hasTdpy = Number.isFinite(tradingDaysPerYear) && tradingDaysPerYear > 0
  const arSampleSize = Array.isArray(metrics.costDistanceSeries) ? metrics.costDistanceSeries.length : 0
  const minimumArSamples = hasTdpy ? Math.max(3, Math.ceil(Math.sqrt(tradingDaysPerYear))) : null
  // 半衰期 + 速度
  if (minimumArSamples && arSampleSize >= minimumArSamples) {
    const hl = meanReversionHalfLife({
      costDistanceSeries: metrics.costDistanceSeries,
      tradingDaysPerYear,
    })
    if (hl) {
      out.halfLifeSessions = Number.isFinite(hl.halfLifeSessions) ? round1(hl.halfLifeSessions) : null
      out.arDecayLabel = hl.speed
      out.arCoefficient = round2(hl.arCoefficient)
      out.arSampleSize = hl.sampleSize
      out.minimumArSamples = minimumArSamples
      out.meanReversionMonotonicGate =
        hl.isMeanReverting && hl.decayMode === 'monotonic-decay' && hl.arCoefficient > 0 && hl.arCoefficient < 1
      out.meanReversionCalibrationStatus = 'sample-only'
      out.meanReversionCalibrationId = null
      // 周期只能由当时结构目标隐含的恢复比例推导；不再把 2×HL/3×HL
      // 当成全局持仓周期。若目标不适用或模型门禁失败，数值保持为空并分别标状态，不伪装成缺输入。
      if (out.meanReversionMonotonicGate && Number.isFinite(out.halfLifeSessions) && out.halfLifeSessions > 0) {
        const recovery = deriveRecoveryHorizon({
          cycleStartPrice: metrics.price,
          anchorPrice: metrics.costAnchor,
          targetPrice: metrics.costLow,
          halfLifeSessions: out.halfLifeSessions,
        })
        out.formulaHorizonSessions = recovery.eligible ? recovery.modelHorizonSessions : null
        out.holdingProjectionRaw = recovery.eligible ? round2(recovery.modelHorizonRaw) : null
        out.recoveryFraction = recovery.eligible ? round2(recovery.recoveryFraction) : null
        out.holdingProjectionStatus = recovery.status
        out.holdingProjectionClaimClass = recovery.resultClaimClass
        out.holdingProjectionReason = recovery.eligible ? null : recovery.reason
      }
    }
  }
  // IID 正态近似下的相对标准误差启发式（relativeUncertainty + |z|），
  // 不是稳健统计精度、置信度或胜率。
  if (Number.isFinite(metrics.annualVol) && Number.isFinite(metrics.tradingDays)) {
    const vc = volConfidence({ annualVol: metrics.annualVol, sampleSize: metrics.tradingDays })
    if (vc) {
      const qualityScore =
        vc.relativeUncertainty <= 0.1
          ? 1
          : vc.relativeUncertainty <= 0.2
            ? 0.7
            : vc.relativeUncertainty <= 0.3
              ? 0.4
              : 0.1
      // 与 |z| 极端度合成：|z|≥3 上调 +0.2
      const zBoost = Number.isFinite(metrics.zScore)
        ? Math.min(0.3, Math.max(0, (Math.abs(metrics.zScore) - 1) * 0.1))
        : 0
      out.volSampleQuality = vc.quality
      out.volSampleQualityScore = clamp01(qualityScore + zBoost)
    }
  }
  // 研究坐标：Delta 上沿 / 成本带下沿；不是买卖点。
  if (
    Number.isFinite(metrics.costAnchor) &&
    Number.isFinite(metrics.annualVol) &&
    metrics.annualVol > 0 &&
    Number.isFinite(out.formulaHorizonSessions)
  ) {
    const deltaBands = getDeltaBands({
      entryPrice: metrics.costAnchor,
      formulaHorizonSessions: out.formulaHorizonSessions,
      iv: metrics.annualVol,
      deltaSlope: 0.3,
      tradingDaysPerYear,
    })
    if (deltaBands?.long?.high) out.deltaReferencePrice = round2(deltaBands.long.high)
  }
  if (Number.isFinite(metrics.costLow)) out.costBandReferencePrice = round2(metrics.costLow)
  return out
}

// （留作向后兼容；deviationScore 等暂未直接用，但保留以便后续扩展）
void deviationScore
