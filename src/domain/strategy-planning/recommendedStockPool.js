// 推荐股票池 v3：声明式可勾选可调权评分模型（主入口）
//
// 核心特性：
//   - 维度通过 DIMENSION_LIBRARY 声明（见 ./recommendedStockPool/dimensions.js）
//   - UI / URL 调权：调用方传入 overrides（部分启用/禁用 + 改权重），
//     buildScoreConfig 合并出最终配置
//   - 数据缺失（requires 字段缺失）自动跳过该维度，剩余维度按比例归一
//   - "接飞刀豁免"：z ≤ -1.5 且回归概率 ≥ 85% 时，锚向下不再硬扣，给予中位分

import {
  meanReversionHalfLife,
  volConfidence,
  deviationScore,
  getDeltaBands,
} from '../formulas/core.js'

import {
  DEFAULT_OPTIONS,
  DEFAULT_TIER_THRESHOLDS,
  DIMENSION_LIBRARY,
} from './recommendedStockPool/dimensions.js'

import {
  classify,
  clamp01,
  formatHit,
  regressionProbabilityFromZ,
  round1,
  round2,
} from './recommendedStockPool/scoring-utils.js'

import { buildNarrative } from './recommendedStockPool/narrative.js'

// 对外保留的常量与工具，与重构前保持兼容
export {
  DEFAULT_TIER_THRESHOLDS,
  DIMENSION_LIBRARY,
  regressionProbabilityFromZ,
}

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
 *   options.allowCatchKnife 控制接飞刀豁免（默认开）
 */
export function computeBuyScore(metrics, options = {}) {
  const safe = metrics ?? {}
  const dims = options.dimensions ?? buildScoreConfig()
  const ctx = { options: { ...DEFAULT_OPTIONS, ...options } }

  const result = { score: 0, dimensions: {}, hits: [], catchKnife: false, maxScore: 0, activeWeight: 0 }
  let totalScore = 0
  let activeWeight = 0

  for (const d of dims) {
    if (!d.enabled || d.weight <= 0) {
      result.dimensions[d.id] = { ratio: 0, score: 0, weight: d.weight, label: d.label, disabled: true }
      continue
    }
    const ready = d.requires.every((k) => safe[k] !== null && safe[k] !== undefined && (typeof safe[k] !== 'number' || Number.isFinite(safe[k])))
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

  // 启用维度的"接飞刀豁免"标志
  if (ctx.options.allowCatchKnife
    && Number.isFinite(safe.zScore) && safe.zScore <= -1.5
    && Number.isFinite(safe.regressionProbability) && safe.regressionProbability >= 0.85) {
    result.catchKnife = true
  }

  result.score = round1(totalScore)
  result.maxScore = round1(activeWeight)
  result.activeWeight = activeWeight

  // 命中条件（维度评分 ≥ 80% 满分）
  for (const d of dims) {
    const r = result.dimensions[d.id]
    if (!r || r.disabled || r.missing) continue
    if (r.ratio >= 0.8) {
      result.hits.push(formatHit(d.id, safe))
    }
  }
  if (result.catchKnife) result.hits.push('接飞刀豁免（强回归）')

  return result
}

/**
 * 生成推荐股票池（按三档分级）。
 *
 * options:
 *   - dimensions  评分维度数组
 *   - allowCatchKnife  接飞刀豁免开关
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
    dimensions: dimensions.map((d) => ({ id: d.id, label: d.label, weight: d.weight, enabled: d.enabled, optional: d.optional })),
    items,
    focusItems,
    waitItems,
    logic:
      '本次推荐采用做市商多维对齐模型：每个维度可独立勾选并调整权重；buyScore 是「启用维度的原始加权和」' +
      '（取消任何一个维度，总分上限自动下降）。当 buyScore ≥ 当前满分上限的 65% 进入「重点关注」，' +
      '40%~65% 为「等待」（常见瓶颈是成本锚还在↓，但若 z ≤ -1.5σ 且回归概率 ≥ 85%，会触发"接飞刀豁免"）。',
    riskNote: '左侧买入不代表立即反转，仍需注意继续下跌和趋势延续风险。维度分数高仅代表统计层面的偏离/低位，不构成投资建议。',
  }
}

// ── 派生计算（半衰期 / 持仓周期 / 买卖点） ────────────────────────────

export function deriveRecommendedStockDecisionMetrics(metrics) {
  const out = {}
  // 半衰期 + 速度
  if (Array.isArray(metrics.costDistanceSeries) && metrics.costDistanceSeries.length >= 30) {
    const hl = meanReversionHalfLife({
      costDistanceSeries: metrics.costDistanceSeries,
      tradingDaysPerYear: metrics.tradingDaysPerYear || 252,
    })
    if (hl) {
      out.halfLifeDays = Number.isFinite(hl.halfLifeDays) ? round1(hl.halfLifeDays) : null
      out.halfLifeSpeed = hl.speed
      out.halfLifeRho = round2(hl.rho)
      // 持仓周期 = HL × 2，回到锚 = HL × 3
      if (Number.isFinite(out.halfLifeDays) && out.halfLifeDays > 0) {
        out.holdingDays = Math.round(out.halfLifeDays * 2)
        out.recoveryDays = Math.round(out.halfLifeDays * 3)
      }
    }
  }
  // 波动率置信度（quality 字符串 → 数字 0~1）
  if (Number.isFinite(metrics.annualVol) && Number.isFinite(metrics.tradingDays)) {
    const vc = volConfidence({ annualVol: metrics.annualVol, sampleSize: metrics.tradingDays })
    if (vc) {
      const qualityScore = vc.quality === '高精度' ? 1 : vc.quality === '中精度' ? 0.7 : vc.quality === '低精度' ? 0.4 : 0.1
      // 与 |z| 极端度合成：|z|≥3 上调 +0.2
      const zBoost = Number.isFinite(metrics.zScore) ? Math.min(0.3, Math.max(0, (Math.abs(metrics.zScore) - 1) * 0.1)) : 0
      out.volConfidenceQuality = vc.quality
      out.volConfidenceScore = clamp01(qualityScore + zBoost)
    }
  }
  // 买卖点：买点 = Delta 上沿、卖点 = 成本带下沿
  if (Number.isFinite(metrics.costAnchor) && Number.isFinite(metrics.annualVol) && metrics.annualVol > 0) {
    const deltaBands = getDeltaBands({
      entryPrice: metrics.costAnchor,
      holdingDays: out.holdingDays || 30,
      iv: metrics.annualVol,
      targetReturn: 0.3,
      tradingDaysPerYear: metrics.tradingDaysPerYear || 252,
    })
    if (deltaBands?.long?.high) out.entryTargetPrice = round2(deltaBands.long.high)
  }
  if (Number.isFinite(metrics.costLow)) out.takeProfitPrice = round2(metrics.costLow)
  return out
}

// （留作向后兼容；deviationScore 等暂未直接用，但保留以便后续扩展）
void deviationScore
