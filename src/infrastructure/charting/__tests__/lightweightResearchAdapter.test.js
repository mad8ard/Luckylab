import { describe, expect, it } from 'vitest'
import { toLightweightLineSegments, toLightweightPathLineSegments } from '../lightweightResearchAdapter.js'

describe('Lightweight Charts research adapter', () => {
  it('按缺失日把有限值拆成互不相连的连续段', () => {
    const rows = [{ date: '2026-08-01' }, { date: '2026-08-02' }, { date: '2026-08-03' }]

    expect(toLightweightLineSegments(rows, [90, null, 92])).toEqual([
      [{ time: '2026-08-01', value: 90 }],
      [{ time: '2026-08-03', value: 92 }],
    ])
  })

  it('拒绝非有限值并跳过无日期行', () => {
    const rows = [{ date: '2026-08-01' }, {}, { date: '2026-08-03' }]

    expect(toLightweightLineSegments(rows, [Number.POSITIVE_INFINITY, 91, '92'])).toEqual([])
  })

  it('按 path 自身日期关联主图日期，并在缺失日切断', () => {
    const rows = [{ date: '2026-08-01' }, { date: '2026-08-02' }, { date: '2026-08-03' }]
    const path = [
      { date: '2026-08-03', deltaUpper: 93 },
      { date: '2026-08-01', deltaUpper: 91 },
    ]

    expect(toLightweightPathLineSegments(rows, path, 'deltaUpper')).toEqual([
      [{ time: '2026-08-01', value: 91 }],
      [{ time: '2026-08-03', value: 93 }],
    ])
  })

  it('把相邻有限值保留在同一段', () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({ date: `2026-08-0${index + 1}` }))

    expect(toLightweightLineSegments(rows, [90, 91, null, 93, 94])).toEqual([
      [
        { time: '2026-08-01', value: 90 },
        { time: '2026-08-02', value: 91 },
      ],
      [
        { time: '2026-08-04', value: 93 },
        { time: '2026-08-05', value: 94 },
      ],
    ])
  })
})
