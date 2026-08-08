// 推荐股票池维度库：
// 每个维度声明为 { id, label, weight, enabled, requires, score(metrics, ctx) }。
// 评分主流程 computeBuyScore 不写死维度数，直接遍历配置。
// UI / URL 调权可通过 buildScoreConfig 的 overrides 合并出最终配置。

import { inverseLinear, forwardLinear, zoneScore, clamp01 } from './scoring-utils.js'

// tiers 用「当前启用维度满分」的百分比表达：focus = 满分 × 65%
export const DEFAULT_TIER_THRESHOLDS = Object.freeze({
  focus: 0.65,
  wait: 0.40,
})

export const DEFAULT_OPTIONS = Object.freeze({
  // 接飞刀豁免：z ≤ -1.5 且回归 ≥ 85% 时锚↓不硬扣
  allowCatchKnife: true,
})

// 构造每个维度的统一形态。score(metrics, ctx) 返回 [0, 1] 的"达成度"
// （null 表示该维度数据缺失，应跳过；0 表示启用但条件不满足拿满分）。
function dim({ id, label, weight, enabled = true, requires = [], score, optional = false }) {
  return { id, label, weight, enabled, requires, score, optional }
}

// 标准库：所有可勾选维度
export const DIMENSION_LIBRARY = [
  // 1. lpValue 历史百分位（30）
  dim({
    id: 'lpValuePercentile',
    label: 'lpValue 1 年百分位',
    weight: 30,
    requires: ['lpValuePercentile'],
    score: (m) => inverseLinear(m.lpValuePercentile, 0.05, 0.50),
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
    label: 'LP zone 仓位',
    weight: 20,
    requires: ['lpZone'],
    score: (m) => zoneScore(m.lpZone),
  }),
  // 4. 成本锚 5 日斜率（15） — 接飞刀豁免见 score 内
  dim({
    id: 'costSlope',
    label: '成本锚 5 日斜率',
    weight: 15,
    requires: ['costSlope5'],
    score: (m, ctx) => {
      const linear = forwardLinear(m.costSlope5, -0.025, 0.005)
      // 接飞刀豁免：z ≤ -1.5 且回归 ≥ 85% 时，锚↓也不再硬扣
      if (ctx?.options?.allowCatchKnife
        && Number.isFinite(m.zScore) && m.zScore <= -1.5
        && Number.isFinite(m.regressionProbability) && m.regressionProbability >= 0.85) {
        return Math.max(linear, 0.5)
      }
      return linear
    },
  }),
  // 5. KDJ J（10）
  dim({
    id: 'jValue',
    label: 'KDJ J 值',
    weight: 10,
    enabled: true,
    requires: ['j'],
    score: (m) => inverseLinear(m.j, 0, 20),
  }),
  // 6. RSI（默认关，可勾）
  dim({
    id: 'rsi',
    label: 'RSI（超卖）',
    weight: 10,
    enabled: false,
    requires: ['rsi'],
    score: (m) => inverseLinear(m.rsi, 0, 35),
  }),
  // 7. LP 3 年比值（max/min ≥ 2 才算周期低点）
  dim({
    id: 'lpRatio3y',
    label: 'LP 3 年 max/min',
    weight: 15,
    requires: ['lpValueRatio3y'],
    score: (m) => forwardLinear(m.lpValueRatio3y, 1.2, 2.5),
  }),
  // 8. 半衰期（HL 越短越好；HL>90 几乎无回归）
  dim({
    id: 'halfLife',
    label: '均值回归半衰期',
    weight: 10,
    enabled: false,
    requires: ['halfLifeDays'],
    score: (m) => {
      const hl = m.halfLifeDays
      if (!Number.isFinite(hl) || hl <= 0) return 0
      // ≤30 天满分，≥120 天零分
      return inverseLinear(hl, 30, 120)
    },
  }),
  // 9. 半衰期可信度（volConfidence quality + |z| 极端度）
  dim({
    id: 'volConfidence',
    label: '半衰期可信度',
    weight: 5,
    enabled: false,
    requires: ['volConfidenceScore'],
    score: (m) => clamp01(m.volConfidenceScore),
  }),
  // 10. 社保 Q1 白名单（可选加分项 +5）
  dim({
    id: 'socialSecurityWhitelist',
    label: '社保 Q1 白名单',
    weight: 5,
    enabled: false,
    optional: true,    // optional=true：未命中不参与归一计算（视为 missing）
    requires: ['socialSecurityWhitelisted'],
    score: (m) => m.socialSecurityWhitelisted ? 1 : null,
  }),
]
