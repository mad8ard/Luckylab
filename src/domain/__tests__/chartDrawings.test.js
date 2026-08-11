import { describe, expect, it } from 'vitest'
import {
  CHART_DRAWING_TYPES,
  CHART_DRAWING_VERSION,
  createHorizontalDrawing,
  createTwoPointDrawing,
  distanceToRenderedDrawing,
  distanceToSegment,
  findNearestDrawing,
  normalizeChartTime,
  replaceDrawing,
  sanitizeDrawing,
  sanitizeDrawingLibrary,
  sanitizeDrawings,
  updateDrawingAnchor,
} from '../workbench/chartDrawings.js'

const start = { time: '2026-08-01', price: 10 }
const end = { time: '2026-08-08', price: 12 }

describe('chartDrawings drawing contract', () => {
  it('公开稳定的版本和可持久化 drawing 类型', () => {
    expect(CHART_DRAWING_VERSION).toBe(1)
    expect(CHART_DRAWING_TYPES).toEqual(['horizontal', 'trend', 'range'])
    expect(Object.isFrozen(CHART_DRAWING_TYPES)).toBe(true)
  })

  it('创建水平线时规范化 id 和数值字符串，并丢弃额外字段', () => {
    expect(createHorizontalDrawing({ id: '  h-1  ', price: '27.42', ignored: true })).toEqual({
      id: 'h-1',
      type: 'horizontal',
      price: 27.42,
    })
  })

  it.each([0, -1, '', null, Number.NaN, Number.POSITIVE_INFINITY])('拒绝非法水平价格 %p', (price) => {
    expect(createHorizontalDrawing({ id: 'h-1', price })).toBeNull()
  })

  it('创建趋势线和区域时规范化两端锚点', () => {
    expect(
      createTwoPointDrawing({
        id: ' trend-1 ',
        type: 'trend',
        start: { time: { year: 2026, month: 8, day: 1 }, price: '10.5' },
        end: { time: 1786147200, price: 12 },
      }),
    ).toEqual({
      id: 'trend-1',
      type: 'trend',
      start: { time: '2026-08-01', price: 10.5 },
      end: { time: 1786147200, price: 12 },
    })

    expect(createTwoPointDrawing({ id: 'range-1', type: 'range', start, end })).toEqual({
      id: 'range-1',
      type: 'range',
      start,
      end,
    })
  })

  it('拒绝未知类型、空 id 或不完整的两点 drawing', () => {
    expect(sanitizeDrawing({ id: '', type: 'horizontal', price: 10 })).toBeNull()
    expect(sanitizeDrawing({ id: 'x', type: 'ray', start, end })).toBeNull()
    expect(sanitizeDrawing({ id: 'x', type: 'trend', start, end: { time: '', price: 12 } })).toBeNull()
    expect(sanitizeDrawing({ id: 'x', type: 'range', start, end: { time: '2026-08-08', price: 0 } })).toBeNull()
    expect(sanitizeDrawing(null)).toBeNull()
  })

  it('限制 id、时间和 scope 的持久化长度', () => {
    const drawing = sanitizeDrawing({
      id: ` ${'i'.repeat(100)} `,
      type: 'trend',
      start: { time: ` ${'t'.repeat(60)} `, price: 10 },
      end,
    })
    expect(drawing.id).toHaveLength(80)
    expect(drawing.start.time).toHaveLength(40)

    const library = sanitizeDrawingLibrary({
      byScope: { [` ${'s'.repeat(150)} `]: [{ id: 'h', type: 'horizontal', price: 10 }] },
    })
    expect(Object.keys(library.byScope)[0]).toHaveLength(120)
  })
})

describe('chartDrawings collection and persistence sanitization', () => {
  it('过滤非法 drawing、按首个 id 去重并遵守数量上限', () => {
    const values = [
      { id: 'same', type: 'horizontal', price: 10 },
      { id: 'bad', type: 'horizontal', price: 0 },
      { id: 'same', type: 'horizontal', price: 99 },
      { id: 'trend', type: 'trend', start, end },
      { id: 'range', type: 'range', start, end },
    ]

    expect(sanitizeDrawings(values, 2)).toEqual([
      { id: 'same', type: 'horizontal', price: 10 },
      { id: 'trend', type: 'trend', start, end },
    ])
    expect(sanitizeDrawings('not-an-array')).toEqual([])
  })

  it('清洗当前版本和旧 shape 的 scope library', () => {
    const current = sanitizeDrawingLibrary({
      version: CHART_DRAWING_VERSION,
      byScope: {
        ' A股:600000 ': [
          { id: 'h', type: 'horizontal', price: 10 },
          { id: 'bad', type: 'horizontal', price: -1 },
        ],
      },
    })
    expect(current).toEqual({
      version: CHART_DRAWING_VERSION,
      byScope: { 'A股:600000': [{ id: 'h', type: 'horizontal', price: 10 }] },
    })

    expect(
      sanitizeDrawingLibrary({
        version: 0,
        byScope: { legacy: [{ id: 'range', type: 'range', start, end }] },
      }),
    ).toEqual({
      version: CHART_DRAWING_VERSION,
      byScope: { legacy: [{ id: 'range', type: 'range', start, end }] },
    })
  })

  it('忽略无效/重复 scope，并限制 scope 数量', () => {
    const library = sanitizeDrawingLibrary(
      {
        byScope: {
          ' scope ': [{ id: 'first', type: 'horizontal', price: 10 }],
          scope: [{ id: 'second', type: 'horizontal', price: 20 }],
          '': [{ id: 'empty', type: 'horizontal', price: 30 }],
          second: [{ id: 'third', type: 'horizontal', price: 40 }],
        },
      },
      1,
    )
    expect(library).toEqual({
      version: CHART_DRAWING_VERSION,
      byScope: { scope: [{ id: 'first', type: 'horizontal', price: 10 }] },
    })
    expect(sanitizeDrawingLibrary(null)).toEqual({ version: CHART_DRAWING_VERSION, byScope: {} })
    expect(sanitizeDrawingLibrary({ byScope: [] })).toEqual({ version: CHART_DRAWING_VERSION, byScope: {} })
  })
})

describe('chartDrawings immutable updates', () => {
  it('更新水平线价格，非法价格则保留规范化后的原值', () => {
    const drawing = { id: ' h ', type: 'horizontal', price: 10, ignored: true }
    expect(updateDrawingAnchor(drawing, 'price', { price: 11.5 })).toEqual({
      id: 'h',
      type: 'horizontal',
      price: 11.5,
    })
    expect(updateDrawingAnchor(drawing, 'price', { price: 0 })).toEqual({ id: 'h', type: 'horizontal', price: 10 })
  })

  it('只允许更新两点 drawing 的 start/end，并保持另一个锚点不变', () => {
    const drawing = { id: 'trend', type: 'trend', start, end }
    const nextStart = { time: '2026-08-02', price: 9.5 }
    expect(updateDrawingAnchor(drawing, 'start', nextStart)).toEqual({ ...drawing, start: nextStart })
    expect(updateDrawingAnchor(drawing, 'middle', nextStart)).toEqual(drawing)
    expect(updateDrawingAnchor(drawing, 'end', { time: '', price: 11 })).toEqual(drawing)
    expect(updateDrawingAnchor({ id: 'bad', type: 'trend' }, 'start', nextStart)).toBeNull()
  })

  it('按 id 替换已有 drawing，不追加陌生 id，并清洗无效输入', () => {
    const drawings = [
      { id: 'h', type: 'horizontal', price: 10 },
      { id: 'trend', type: 'trend', start, end },
      { id: 'bad', type: 'horizontal', price: 0 },
    ]
    expect(replaceDrawing(drawings, { id: 'h', type: 'horizontal', price: 12 })).toEqual([
      { id: 'h', type: 'horizontal', price: 12 },
      { id: 'trend', type: 'trend', start, end },
    ])
    expect(replaceDrawing(drawings, { id: 'new', type: 'horizontal', price: 12 })).toEqual([
      { id: 'h', type: 'horizontal', price: 10 },
      { id: 'trend', type: 'trend', start, end },
    ])
    expect(replaceDrawing(drawings, null)).toEqual([
      { id: 'h', type: 'horizontal', price: 10 },
      { id: 'trend', type: 'trend', start, end },
    ])
  })
})

describe('chartDrawings time and hit testing', () => {
  it('规范化 lightweight-charts 的 numeric/string/BusinessDay 时间', () => {
    expect(normalizeChartTime(1786147200)).toBe(1786147200)
    expect(normalizeChartTime(' 2026-08-08 ')).toBe('2026-08-08')
    expect(normalizeChartTime({ year: 2026, month: 8, day: 8 })).toBe('2026-08-08')
    expect(normalizeChartTime('')).toBeNull()
    expect(normalizeChartTime(Number.NaN)).toBeNull()
    expect(normalizeChartTime({ year: 2026, month: 8 })).toBeNull()
  })

  it('计算点到普通和退化线段的最短距离，并夹在端点范围内', () => {
    expect(distanceToSegment({ x: 5, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(4)
    expect(distanceToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5)
    expect(distanceToSegment({ x: 4, y: 5 }, { x: 1, y: 1 }, { x: 1, y: 1 })).toBe(5)
    expect(distanceToSegment({ x: 1, y: 1 }, null, { x: 2, y: 2 })).toBe(Number.POSITIVE_INFINITY)
  })

  it('趋势/水平 drawing 使用线段距离，区域使用四条边界距离', () => {
    expect(distanceToRenderedDrawing({ type: 'trend', x1: 0, y1: 0, x2: 10, y2: 0 }, { x: 5, y: 3 })).toBe(3)
    expect(distanceToRenderedDrawing({ type: 'range', x1: 10, y1: 10, x2: 0, y2: 0 }, { x: 5, y: 5 })).toBe(5)
    expect(distanceToRenderedDrawing({ type: 'range', x1: 0, y1: 0, x2: 10, y2: 10 }, { x: 12, y: 5 })).toBe(2)
    expect(distanceToRenderedDrawing(null, { x: 1, y: 1 })).toBe(Number.POSITIVE_INFINITY)
  })

  it('寻找容差内最近 drawing；距离相同时优先后绘制的顶层元素', () => {
    const rendered = [
      { id: 'bottom', type: 'trend', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'top', type: 'horizontal', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'nearer', type: 'trend', x1: 0, y1: 2, x2: 10, y2: 2 },
    ]
    expect(findNearestDrawing(rendered, { x: 5, y: 2.5 }, 3)).toEqual({
      id: 'nearer',
      type: 'trend',
      distance: 0.5,
    })
    expect(findNearestDrawing(rendered.slice(0, 2), { x: 5, y: 1 }, 1)).toEqual({
      id: 'top',
      type: 'horizontal',
      distance: 1,
    })
    expect(findNearestDrawing(rendered, { x: 5, y: 20 }, 3)).toBeNull()
    expect(findNearestDrawing(null, { x: 5, y: 1 })).toBeNull()
    expect(findNearestDrawing(rendered, { x: Number.NaN, y: 1 })).toBeNull()
  })
})
