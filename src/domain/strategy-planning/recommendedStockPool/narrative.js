// 推荐股票池叙事文案生成器：把评分结果与 metrics 翻译成中文小段落。
// 不参与评分逻辑，纯展示层。

import { formatPct } from './scoring-utils.js'

export function buildNarrative({ label, score, maxScore, dimensions, catchKnife, metrics }) {
  void dimensions
  const lines = []

  // 主结论
  const ratio = maxScore > 0 ? score / maxScore : 0
  const scoreStr = `${score}/${maxScore} 分（${(ratio * 100).toFixed(0)}%）`
  if (ratio >= 0.85) lines.push(`${label} 综合 ${scoreStr}，进入高分观察组。`)
  else if (ratio >= 0.65) lines.push(`${label} 综合 ${scoreStr}，多个研究维度对齐。`)
  else if (ratio >= 0.4) lines.push(`${label} 综合 ${scoreStr}，仍缺关键确认。`)
  else lines.push(`${label} 综合 ${scoreStr}，当前不进入观察池。`)

  // lpValue P
  const p = metrics.lpValuePercentile
  if (Number.isFinite(p)) {
    const pPct = (p * 100).toFixed(1)
    lines.push(`动态区间合成几何代理位于近一年 P${pPct}%；该序列每日重建区间，不代表固定 LP 头寸或做市商库存。`)
  }

  // LP 3 年比值
  if (Number.isFinite(metrics.lpValueRatio3y)) {
    const r = metrics.lpValueRatio3y
    lines.push(`合成几何代理 3 年 max/min=${r.toFixed(2)}×；它受价格尺度影响，不能单独判定周期底或价值陷阱。`)
  }

  // z + 正态参考极端度
  if (Number.isFinite(metrics.zScore)) {
    const z = metrics.zScore
    const percentile = Number.isFinite(metrics.deviationPercentile)
      ? `，正态参考偏离百分位 ${(metrics.deviationPercentile * 100).toFixed(1)}%`
      : ''
    lines.push(`z=${z.toFixed(2)}σ${percentile}；这是偏离极端度，不是未来回归概率。`)
  }

  // LP zone
  if (metrics.lpZone === 'token0') lines.push(`当前价格位于合成 CK 区间下侧（token0 proxy）。`)
  else if (metrics.lpZone === 'token1') lines.push(`当前价格位于合成 CK 区间上侧（token1 proxy）。`)
  else if (metrics.lpZone === 'range')
    lines.push(`当前价格位于合成 CK 区间内；未建模成交路径，不能据此推断手续费收入。`)

  // 锚趋势 + 接飞刀
  if (Number.isFinite(metrics.costSlopeRecent)) {
    const dir = metrics.anchorDirection
    if (dir === 'up') lines.push(`成本锚自适应近期斜率 ${formatPct(metrics.costSlopeRecent)}（↑），样本成本锚上移。`)
    else if (dir === 'flat')
      lines.push(`成本锚自适应近期斜率 ${formatPct(metrics.costSlopeRecent)}（→），样本成本锚近似走平。`)
    else if (dir === 'down') {
      if (catchKnife)
        lines.push(
          `成本锚自适应近期斜率 ${formatPct(metrics.costSlopeRecent)}（↓）；已人工开启且具备独立留出校准标识，仍需独立风险复核。`,
        )
      else lines.push(`成本锚自适应近期斜率 ${formatPct(metrics.costSlopeRecent)}（↓），趋势延续风险未解除。`)
    }
  }

  // 半衰期 + 持仓周期
  if (Number.isFinite(metrics.halfLifeSessions)) {
    const monotonic = metrics.meanReversionMonotonicGate === true
    lines.push(
      `历史 AR 半衰期 ${metrics.halfLifeSessions} 个交易会话（${metrics.arDecayLabel}）；${monotonic ? '样本内单调衰减门禁成立，尚未校准' : '未通过单调回归门禁'}。`,
    )
  }

  // 研究参考坐标
  if (Number.isFinite(metrics.deltaReferencePrice) || Number.isFinite(metrics.costBandReferencePrice)) {
    const entry = Number.isFinite(metrics.deltaReferencePrice) ? `Delta 参考边界 ${metrics.deltaReferencePrice}` : ''
    const anchor = Number.isFinite(metrics.costBandReferencePrice) ? `成本带参考 ${metrics.costBandReferencePrice}` : ''
    lines.push(`${[entry, anchor].filter(Boolean).join('，')}；仅为研究坐标，不是买卖指令。`)
  }

  // 社保白名单
  if (metrics.socialSecurityWhitelisted) {
    lines.push(`当前社保 Q1 名单命中；若用于历史回放必须使用当期快照，不能回填未来名单。`)
  }

  return lines.join(' ')
}
