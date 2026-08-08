// 推荐股票池叙事文案生成器：把评分结果与 metrics 翻译成中文小段落。
// 不参与评分逻辑，纯展示层。

import { formatPct } from './scoring-utils.js'

export function buildNarrative({ label, score, maxScore, dimensions, catchKnife, metrics }) {
  void dimensions
  const lines = []

  // 主结论
  const ratio = maxScore > 0 ? score / maxScore : 0
  const scoreStr = `${score}/${maxScore} 分（${(ratio * 100).toFixed(0)}%）`
  if (ratio >= 0.85) lines.push(`${label} 综合 ${scoreStr}。做市商模型告诉你：你在历史最低价囤满了货。`)
  else if (ratio >= 0.65) lines.push(`${label} 综合 ${scoreStr}。多个维度对齐，左侧关注价值高。`)
  else if (ratio >= 0.40) lines.push(`${label} 综合 ${scoreStr}。有亮点但缺关键确认，等一等。`)
  else lines.push(`${label} 综合 ${scoreStr}。维度未对齐，暂不入选。`)

  // lpValue P
  const p = metrics.lpValuePercentile
  if (Number.isFinite(p)) {
    const pPct = (p * 100).toFixed(1)
    if (p <= 0.05) lines.push(`lpValue 近一年 P${pPct}%，${(100 - p * 100).toFixed(1)}% 的时间都比现在贵——做市商角度处在历史最便宜区间。`)
    else if (p <= 0.30) lines.push(`lpValue P${pPct}%，处于近一年低位区域。`)
    else if (p <= 0.70) lines.push(`lpValue P${pPct}%，位置中性。`)
    else lines.push(`lpValue P${pPct}%，近一年大部分时间都比现在便宜——你现在进货的价格不划算。`)
  }

  // LP 3 年比值
  if (Number.isFinite(metrics.lpValueRatio3y)) {
    const r = metrics.lpValueRatio3y
    if (r >= 2) lines.push(`3 年 max/min=${r.toFixed(2)}×，确实翻过倍——属于真周期低点。`)
    else lines.push(`3 年 max/min=${r.toFixed(2)}×，还没翻过倍——可能只是价值陷阱，不是真周期底。`)
  }

  // z + 回归
  if (Number.isFinite(metrics.zScore) && Number.isFinite(metrics.regressionProbability)) {
    const z = metrics.zScore
    const prob = (metrics.regressionProbability * 100).toFixed(1)
    if (z <= -2.5) lines.push(`z=${z.toFixed(2)}σ，回归概率 ${prob}%——纯随机偏离这么深的概率极低，价格大概率往回拉。`)
    else if (z <= -1.5) lines.push(`z=${z.toFixed(2)}σ，回归概率 ${prob}%，统计学信号不错。`)
    else if (z <= -0.5) lines.push(`z=${z.toFixed(2)}σ，价格略低于成本锚。`)
    else if (z <= 0.5) lines.push(`z=${z.toFixed(2)}σ，价格贴在成本锚上下。`)
    else lines.push(`z=${z.toFixed(2)}σ，价格已偏离到锚之上——溢价区。`)
  }

  // LP zone
  if (metrics.lpZone === 'token0') lines.push(`LP 仓位 100% ${label}（zone=token0），手里的货是打折买的。`)
  else if (metrics.lpZone === 'token1') lines.push(`LP 仓位已卖成现金（zone=token1）——货已出完。`)
  else if (metrics.lpZone === 'range') lines.push(`LP 在 range 区间内做市，双向报价赚手续费。`)

  // 锚趋势 + 接飞刀
  if (Number.isFinite(metrics.costSlope5)) {
    const dir = metrics.anchorDirection
    if (dir === 'up') lines.push(`成本锚 5 日斜率 ${formatPct(metrics.costSlope5)}（↑），公允成本上移，趋势已掉头。`)
    else if (dir === 'flat') lines.push(`成本锚 5 日斜率 ${formatPct(metrics.costSlope5)}（→），底部已焊住。`)
    else if (dir === 'down') {
      if (catchKnife) lines.push(`成本锚 5 日斜率 ${formatPct(metrics.costSlope5)}（↓），但 z 已极端 + 回归概率 ≥ 85%，触发"接飞刀豁免"，回归力道足够拉回。`)
      else lines.push(`唯一没亮绿灯的：成本锚 5 日斜率 ${formatPct(metrics.costSlope5)}（↓），"底"可能还没焊死，等锚走平再加码。`)
    }
  }

  // 半衰期 + 持仓周期
  if (Number.isFinite(metrics.halfLifeDays)) {
    lines.push(`半衰期 ${metrics.halfLifeDays} 天（${metrics.halfLifeSpeed}），持仓周期 ≈ ${metrics.holdingDays} 天，回到锚 ≈ ${metrics.recoveryDays} 天。`)
  }

  // 买卖点
  if (Number.isFinite(metrics.entryTargetPrice) || Number.isFinite(metrics.takeProfitPrice)) {
    const buy = Number.isFinite(metrics.entryTargetPrice) ? `买点 ≈ Delta 上沿 ${metrics.entryTargetPrice}` : ''
    const sell = Number.isFinite(metrics.takeProfitPrice) ? `卖点 ≈ 成本带下沿 ${metrics.takeProfitPrice}` : ''
    lines.push([buy, sell].filter(Boolean).join('，'))
  }

  // 社保白名单
  if (metrics.socialSecurityWhitelisted) {
    lines.push(`社保 Q1 重仓名单中，机构筹码托底。`)
  }

  return lines.join(' ')
}
