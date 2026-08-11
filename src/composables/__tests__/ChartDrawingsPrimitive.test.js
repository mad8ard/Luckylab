import { describe, expect, it, vi } from 'vitest'
import { ChartDrawingsPrimitive } from '../ChartDrawingsPrimitive.js'

describe('ChartDrawingsPrimitive', () => {
  it('使用时间/价格领域坐标投影并提供稳定 pane view 与命中 id', () => {
    const requestUpdate = vi.fn()
    const primitive = new ChartDrawingsPrimitive()
    primitive.setState({
      drawings: [
        { id: 'h1', type: 'horizontal', price: 120 },
        {
          id: 't1',
          type: 'trend',
          start: { time: '2026-01-01', price: 100 },
          end: { time: '2026-01-02', price: 110 },
        },
      ],
      selectedId: 't1',
      dark: false,
    })
    primitive.attached({ chart: fakeChart(), series: fakeSeries(), requestUpdate })

    expect(requestUpdate).toHaveBeenCalledOnce()
    expect(primitive.paneViews()).toBe(primitive.paneViews())
    expect(primitive.projectDrawings()).toEqual([
      expect.objectContaining({ id: 'h1', x1: 0, y1: 80, x2: 200, y2: 80 }),
      expect.objectContaining({ id: 't1', x1: 20, y1: 100, x2: 80, y2: 90 }),
    ])
    expect(primitive.findAt(50, 95, 3)).toMatchObject({ id: 't1' })
    expect(primitive.findHandleAt('t1', 20, 100, 5)).toBe('start')
    expect(primitive.hitTest(50, 95)).toMatchObject({
      externalId: 'chart-drawing:t1',
      zOrder: 'top',
      itemType: 'primitive',
    })
  })

  it('宽度或坐标无效时跳过图形，detach 后不再投影', () => {
    const primitive = new ChartDrawingsPrimitive()
    primitive.setState({ drawings: [{ id: 'h1', type: 'horizontal', price: 120 }] })
    primitive.attached({
      chart: fakeChart({ width: 0 }),
      series: fakeSeries(),
      requestUpdate: vi.fn(),
    })
    expect(primitive.projectDrawings()).toEqual([])

    primitive.detached()
    expect(primitive.projectDrawings()).toEqual([])
    expect(primitive.hitTest(20, 20)).toBeNull()
  })
})

function fakeChart({ width = 200 } = {}) {
  const xByTime = new Map([
    ['2026-01-01', 20],
    ['2026-01-02', 80],
  ])
  return {
    timeScale: () => ({
      width: () => width,
      timeToCoordinate: (time) => xByTime.get(time) ?? null,
    }),
  }
}

function fakeSeries() {
  return {
    priceToCoordinate: (price) => (Number.isFinite(price) ? 200 - price : null),
  }
}
