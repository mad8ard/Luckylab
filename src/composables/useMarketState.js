import { computed, isRef } from 'vue'
import { buildCostPath, buildMarketStatePath } from '../domain/market-data/cost.js'
import { buildFormulaPath } from '../domain/market-data/formulaPath.js'

/**
 * 市场态计算层：滚动 VWAP 成本带、年化波动、ATR、动量、Δ 价格带等
 *
 * 二级缓存：rows → tdpy → marketStates
 * - 同一 rows 不同 tdpy 互不污染（修复 A3）
 * - 全局唯一 marketStates 来源，避免各组件重复计算市场路径
 *
 * @param {Ref<Array>} rows
 * @param {Ref<number>} cursor
 * @param {object} input  reactive，至少含 tradingDaysPerYear
 */
export function useMarketState(rows, cursor, input) {
  // WeakMap<rows, Map<tdpy, states>>
  const marketStatePathCache = new WeakMap()

  function getMarketStatePath(r) {
    const currentInput = isRef(input) ? input.value : input
    const tdpy = Number(currentInput.tradingDaysPerYear) || 365
    let bucket = marketStatePathCache.get(r)
    if (!bucket) {
      bucket = new Map()
      marketStatePathCache.set(r, bucket)
    }
    if (!bucket.has(tdpy)) bucket.set(tdpy, buildMarketStatePath(r, tdpy))
    return bucket.get(tdpy)
  }

  const activeRows = computed(() => rows.value.slice(0, cursor.value + 1))
  const marketStateFull = computed(() => (rows.value.length ? getMarketStatePath(rows.value) : []))
  const marketStateActive = computed(() => (activeRows.value.length ? getMarketStatePath(activeRows.value) : []))
  const market = computed(() => marketStateActive.value.at(-1) ?? null)
  const costPath = computed(() => buildCostPath(activeRows.value))
  const formulaPath = computed(() => buildFormulaPath(activeRows.value, isRef(input) ? input.value : input))

  return { activeRows, marketStateFull, marketStateActive, market, costPath, formulaPath }
}
