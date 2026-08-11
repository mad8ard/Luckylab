// 推荐股票池维度库：
// 每个维度声明为 { id, label, weight, enabled, requires, score(metrics, ctx) }。
// 评分主流程 computeBuyScore 不写死维度数，直接遍历配置。
// UI / URL 调权可通过 buildScoreConfig 的 overrides 合并出最终配置。

import { inverseLinear, forwardLinear, zoneScore, clamp01 } from './scoring-utils.js'

// tiers 用「当前启用维度满分」的百分比表达：focus = 满分 × 65%
export const DEFAULT_TIER_THRESHOLDS = Object.freeze({
  focus: 0.65,
  wait: 0.4,
})

export const DEFAULT_OPTIONS = Object.freeze({
  // 默认禁用；样本内 AR 不够，必须有独立留出验证和校准标识。
  allowCatchKnife: false,
})

export const FORBIDDEN_SCORE_DIMENSION_IDS = Object.freeze(['jValue', 'rsi'])
export const FORBIDDEN_SCORE_INPUT_KEYS = Object.freeze(['j', 'rsi'])

export function hasValidatedMeanReversion(metrics) {
  return (
    metrics?.meanReversionMonotonicGate === true &&
    metrics?.meanReversionCalibrationStatus === 'holdout-validated' &&
    typeof metrics?.meanReversionCalibrationId === 'string' &&
    metrics.meanReversionCalibrationId.trim().length > 0 &&
    Number.isFinite(metrics?.arCoefficient) &&
    metrics.arCoefficient > 0 &&
    metrics.arCoefficient < 1
  )
}

// 构造每个维度的统一形态。score(metrics, ctx) 返回 [0, 1] 的"达成度"
// （null 表示该维度数据缺失，应跳过；0 表示启用但条件不满足拿满分）。
function dim({ id, label, weight, enabled = true, requires = [], score, optional = false }) {
  return { id, label, weight, enabled, requires, score, optional }
}

// 标准库：所有可勾选维度。RSI/KDJ 不进入该库，因此 UI / URL override
// 也无法把它们重新启用为选股、评分或候选状态输入。
export const DIMENSION_LIBRARY = [
  // 1. lpValue 历史百分位（30）
  dim({
    id: 'lpValuePercentile',
    label: '合成几何代理 1 年百分位',
    weight: 30,
    requires: ['lpValuePercentile'],
    score: (m) => inverseLinear(m.lpValuePercentile, 0.05, 0.5),
  }),
  // 2. z 偏离（25）
  dim({
    id: 'zScore',
    label: 'z 偏离（成本带）',
    weight: 25,
    requires: ['zScore'],
    score: (m) => inverseLinear(m.zScore, -3.0, 0),
  }),
  // 3. LP zone（20）
  dim({
    id: 'lpZone',
    label: '合成 CK 区间位置',
    weight: 20,
    requires: ['lpZone'],
    score: (m) => zoneScore(m.lpZone),
  }),
  // 4. 成本锚自适应近期斜率（15） — 只有独立留出校准证明才可人工豁免
  dim({
    id: 'costSlope',
    label: '成本锚自适应近期斜率',
    weight: 15,
    requires: ['costSlopeRecent'],
    score: (m, ctx) => {
      const linear = forwardLinear(m.costSlopeRecent, -0.025, 0.005)
      // 样本内单调 AR 不够；必须有独立留出校准标识，z 极端度本身不等于回归概率。
      if (
        ctx?.options?.allowCatchKnife &&
        Number.isFinite(m.zScore) &&
        m.zScore <= -1.5 &&
        hasValidatedMeanReversion(m)
      ) {
        return Math.max(linear, 0.5)
      }
      return linear
    },
  }),
  // 5. LP 3 年比值（max/min ≥ 2 才算周期低点）
  dim({
    id: 'lpRatio3y',
    label: '合成几何代理 3 年 max/min',
    weight: 15,
    requires: ['lpValueRatio3y'],
    score: (m) => forwardLinear(m.lpValueRatio3y, 1.2, 2.5),
  }),
  // 6. 结构周期相对证据深度：连续比例，不使用 30/60/90 日历阈值。
  dim({
    id: 'halfLife',
    label: '结构周期 / 证据深度',
    weight: 10,
    enabled: false,
    requires: ['formulaHorizonSessions', 'tradingDays', 'meanReversionMonotonicGate'],
    score: (m) => {
      if (m.meanReversionMonotonicGate !== true) return 0
      const horizon = m.formulaHorizonSessions
      const evidenceScale = Math.sqrt(m.tradingDays)
      if (!Number.isFinite(horizon) || horizon <= 0 || !Number.isFinite(evidenceScale) || evidenceScale <= 0) return 0
      return 1 / (1 + horizon / evidenceScale)
    },
  }),
  // 7. 波动样本质量启发式（抽样区间 quality + |z| 极端度；非置信度）
  dim({
    id: 'volConfidence',
    label: '波动样本质量启发式',
    weight: 5,
    enabled: false,
    requires: ['volSampleQualityScore'],
    score: (m) => clamp01(m.volSampleQualityScore),
  }),
  // 8. 社保 Q1 白名单（可选加分项 +5）
  dim({
    id: 'socialSecurityWhitelist',
    label: '社保 Q1 白名单',
    weight: 5,
    enabled: false,
    optional: true, // optional=true：未命中不参与归一计算（视为 missing）
    requires: ['socialSecurityWhitelisted'],
    score: (m) => (m.socialSecurityWhitelisted ? 1 : null),
  }),
]
