import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useMarketState } from '../useMarketState.js'
import { buildMarketStatePath } from '../../domain/market-data/cost.js'

function makeRows(count) {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i * 0.3 + Math.sin(i / 3) * 2
    return {
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      open: close - 0.4,
      high: close + 1.2,
      low: close - 1.1,
      close,
      volume: 1000 + i * 17,
    }
  })
}

describe('useMarketState', () => {
  it('计划锚点只使用 cursor 之前的数据推导窗口，避免未来样本量影响参数', () => {
    const allRows = makeRows(120)
    const cursor = ref(39)
    const state = useMarketState(ref(allRows), cursor, { tradingDaysPerYear: 365 })

    const activeRows = allRows.slice(0, cursor.value + 1)
    const activeOnly = buildMarketStatePath(activeRows, 365).at(-1)
    const fullPathAtCursor = buildMarketStatePath(allRows, 365)[cursor.value]

    expect(state.market.value.costAnchor).toBeCloseTo(activeOnly.costAnchor, 10)
    expect(state.marketStateActive.value).toHaveLength(activeRows.length)
    expect(state.market.value.costAnchor).not.toBeCloseTo(fullPathAtCursor.costAnchor, 10)
  })
})
