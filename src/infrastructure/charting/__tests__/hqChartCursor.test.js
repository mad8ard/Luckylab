import { describe, expect, it, vi } from 'vitest'
import { emitCursor } from '../hqChartAdapter.js'

describe('HQ cursor bridge', () => {
  it('只接受当前日线的日期或索引，失配时主动清空共享图例', () => {
    const onCursor = vi.fn()
    const indexByDate = new Map([
      [20260807, 0],
      [20260808, 1],
    ])

    emitCursor({ Draw: { Date: 20260807 } }, 0, indexByDate, onCursor)
    emitCursor({ DataIndex: 1 }, 0, indexByDate, onCursor)
    emitCursor({ Draw: { Date: 20260101 }, DataIndex: 20 }, 0, indexByDate, onCursor)
    emitCursor({ DataIndex: 1 }, 4, indexByDate, onCursor)

    expect(onCursor).toHaveBeenNthCalledWith(1, 0)
    expect(onCursor).toHaveBeenNthCalledWith(2, 1)
    expect(onCursor).toHaveBeenNthCalledWith(3, null)
    expect(onCursor).toHaveBeenNthCalledWith(4, null)
  })
})
