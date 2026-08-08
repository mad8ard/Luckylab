/**
 * RMA（Wilder/EWMA 风格平滑均线）：alpha = 1/period
 *
 * 实现说明：
 *   - 首个非 NaN 输入直接作为初始平滑值
 *     （不走 Pine ta.rma 标准的 SMA(period) 初始化；与 Pine 在前 ~30 根有偏差，
 *     之后收敛到 < 0.5%；优点是早期 K 线能看到值，详见 kdj.js 顶部注释）
 *   - 之后 rma[i] = alpha * x[i] + (1 - alpha) * rma[i-1]
 *   - 输入 NaN 时输出 NaN，但**不重置**内部 prev；下一根有效输入继续在旧 prev 上递推
 *     （当前调用点（KDJ rsv / RSI gain/loss）只在序列头部 NaN，不会触发中段 gap；
 *     如未来 caller 需要"中段 gap 重置"语义，需另写实现）
 *
 * @param {Array<number>} values  输入序列（含 NaN 占位）
 * @param {number} period         平滑周期
 * @returns {Array<number>}       与输入等长，未稳态位置为 NaN
 */
export function rmaSeries(values, period) {
  const out = new Array(values.length).fill(NaN)
  const alpha = 1 / period
  let prev = NaN

  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]
    if (!Number.isFinite(v)) continue

    prev = Number.isFinite(prev) ? alpha * v + (1 - alpha) * prev : v
    out[i] = prev
  }

  return out
}
