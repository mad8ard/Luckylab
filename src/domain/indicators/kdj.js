/**
 * KDJ 指标 (Stochastic Oscillator + J 线)
 *
 * 公式：
 *   div = highest(high, n) - lowest(low, n)
 *   rsv = div === 0 ? 50 : 100 * (close - lowest) / div
 *   K = RMA(rsv, sig)
 *   D = RMA(K, sig)
 *   J = 3*K - 2*D
 *
 * 默认参数：n=9, sig=3
 *
 * RMA 实现：见 ./_rma.js（EWMA 风格初始化，与 Pine 前 ~30 根有偏差，之后收敛 < 0.5%）。
 * 选择 EWMA 起步以匹配 plan 测试用例 5 的契约（"n 越小、K/D 越早出现"）。
 */
import { rmaSeries } from './_rma.js'

export function computeKDJ(rows, { n = 9, sig = 3 } = {}) {
  const len = rows.length
  if (!len) return []

  const rsv = new Array(len).fill(NaN)
  for (let i = n - 1; i < len; i += 1) {
    let hi = -Infinity
    let lo = Infinity
    for (let j = i - n + 1; j <= i; j += 1) {
      if (rows[j].high > hi) hi = rows[j].high
      if (rows[j].low < lo) lo = rows[j].low
    }
    const div = hi - lo
    rsv[i] = div === 0 ? 50 : 100 * (rows[i].close - lo) / div
  }

  const kArr = rmaSeries(rsv, sig)
  const dArr = rmaSeries(kArr, sig)

  return rows.map((row, i) => {
    const k = kArr[i]
    const d = dArr[i]
    if (!Number.isFinite(k) || !Number.isFinite(d)) {
      return { date: row.date, k: null, d: null, j: null }
    }
    return { date: row.date, k, d, j: 3 * k - 2 * d }
  })
}
