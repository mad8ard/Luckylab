/**
 * RSI（相对强弱指数）+ 自定义缩放版
 *
 * 公式：
 *   delta[i] = close[i] - close[i-1]
 *   gain = max(delta, 0)
 *   loss = max(-delta, 0)
 *   avgGain = RMA(gain, n)；avgLoss = RMA(loss, n)
 *   raw = avgLoss === 0
 *     ? (avgGain === 0 ? 50 : 100)        // 全平：50；只涨不跌：100
 *     : 100 - 100 / (1 + avgGain / avgLoss)
 *
 * 默认参数：n=14
 *
 * Custom 缩放（与 Pine 对齐，rsi_custom = (rsi_raw - 35) * 2）：
 *   - raw 范围 0~100 → custom 范围 -70~130
 *   - Pine 中超买线 80 / 中轴 50 / 超卖 0 都是 custom 维度
 *
 * Warmup gate（前 n 根强制 null）：
 *   - RMA 用 EWMA 风格起步——首个非 NaN 输入直接作为初值，i=1 就有输出
 *   - 但前 n 根样本太少，RSI 噪声大、不可信
 *   - 与 KDJ 一样让用户清晰看到 warmup 状态的工程取舍（KDJ 起点 i=n-1 由公式产物决定；RSI 起点 i=n 由本 gate 决定，两者噪声大都不可信，故都强制 null）
 *   - 故 i < n 时 raw/custom 强制 null，避免误导
 *
 * RMA 实现：见 ./_rma.js（与 KDJ 共享同一份 helper）。
 */
import { rmaSeries } from './_rma.js'

export function computeRSI(rows, { n = 14 } = {}) {
  const len = rows.length
  if (!len) return []

  const gains = new Array(len).fill(NaN)
  const losses = new Array(len).fill(NaN)
  for (let i = 1; i < len; i += 1) {
    const delta = rows[i].close - rows[i - 1].close
    gains[i] = delta > 0 ? delta : 0
    losses[i] = delta < 0 ? -delta : 0
  }

  const avgGain = rmaSeries(gains, n)
  const avgLoss = rmaSeries(losses, n)

  return rows.map((row, i) => {
    // warmup gate：前 n 根（i=0..n-1）噪声大，强制 null
    if (i < n) return { date: row.date, raw: null, custom: null }
    const g = avgGain[i]
    const l = avgLoss[i]
    if (!Number.isFinite(g) || !Number.isFinite(l)) {
      return { date: row.date, raw: null, custom: null }
    }
    let raw
    if (l === 0) raw = g === 0 ? 50 : 100
    else raw = 100 - 100 / (1 + g / l)
    return { date: row.date, raw, custom: (raw - 35) * 2 }
  })
}
