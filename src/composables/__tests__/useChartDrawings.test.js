import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChartDrawings } from '../useChartDrawings.js'

describe('useChartDrawings', () => {
  beforeEach(() => {
    window.localStorage.removeItem('lab.chartDrawings.v1')
  })

  it('只在主绘图区接收坐标，并按标的持久化、撤销和恢复画线', async () => {
    const harness = createHarness()
    const drawing = harness.drawing
    drawing.attach()
    drawing.setTool('horizontal')

    const onAxis = pointerEvent({ x: 230, y: 50 })
    drawing.onPointerDown(onAxis)
    expect(onAxis.preventDefault).not.toHaveBeenCalled()
    expect(drawing.drawings.value).toEqual([])

    const onPlot = pointerEvent({ x: 100, y: 50 })
    drawing.onPointerDown(onPlot)
    expect(onPlot.preventDefault).toHaveBeenCalledOnce()
    expect(drawing.drawings.value).toHaveLength(1)
    expect(drawing.drawings.value[0]).toMatchObject({ type: 'horizontal', price: 150 })
    expect(drawing.tool.value).toBe('select')

    drawing.undo()
    expect(drawing.drawings.value).toEqual([])
    drawing.redo()
    expect(drawing.drawings.value).toHaveLength(1)

    harness.scope.value = 'scope-b'
    await nextTick()
    expect(drawing.drawings.value).toEqual([])
    expect(drawing.tool.value).toBe('cursor')

    harness.scope.value = 'scope-a'
    await nextTick()
    expect(drawing.drawings.value).toHaveLength(1)
    expect(drawing.drawings.value[0].price).toBe(150)
    drawing.dispose()
  })

  it('拖动状态是 reactive，丢失 pointer capture 时回滚，pointerup 时形成可撤销命令', () => {
    const harness = createHarness()
    const drawing = harness.drawing
    drawing.attach()
    drawing.setTool('horizontal')
    drawing.onPointerDown(pointerEvent({ x: 100, y: 50 }))
    const id = drawing.drawings.value[0].id

    harness.primitive.findAt.mockReturnValue({ id })
    harness.primitive.findHandleAt.mockReturnValue('price')
    drawing.onPointerDown(pointerEvent({ x: 100, y: 50, pointerId: 7 }))
    expect(drawing.sessionState.value).toBe('editing')
    drawing.onPointerMove(pointerEvent({ x: 100, y: 80, pointerId: 7 }))
    expect(drawing.drawings.value[0].price).toBe(120)

    drawing.onLostPointerCapture(pointerEvent({ x: 100, y: 80, pointerId: 7 }))
    expect(drawing.sessionState.value).toBe('armed')
    expect(drawing.drawings.value[0].price).toBe(150)

    drawing.onPointerDown(pointerEvent({ x: 100, y: 50, pointerId: 8 }))
    drawing.onPointerMove(pointerEvent({ x: 100, y: 70, pointerId: 8 }))
    drawing.onPointerUp(pointerEvent({ x: 100, y: 70, pointerId: 8 }))
    expect(drawing.drawings.value[0].price).toBe(130)
    expect(harness.layer.releasePointerCapture).toHaveBeenCalledWith(8)
    drawing.undo()
    expect(drawing.drawings.value[0].price).toBe(150)
    drawing.dispose()
  })

  it('attach 幂等且 dispose 解绑全局键盘事件并释放进行中的捕获', () => {
    const harness = createHarness()
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const drawing = harness.drawing

    drawing.attach()
    drawing.attach()
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1)

    drawing.setTool('horizontal')
    drawing.onPointerDown(pointerEvent({ x: 100, y: 50 }))
    const id = drawing.drawings.value[0].id
    harness.primitive.findAt.mockReturnValue({ id })
    harness.primitive.findHandleAt.mockReturnValue('price')
    drawing.onPointerDown(pointerEvent({ x: 100, y: 50, pointerId: 9 }))
    drawing.onPointerMove(pointerEvent({ x: 100, y: 75, pointerId: 9 }))

    drawing.dispose()
    expect(remove.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1)
    expect(harness.layer.releasePointerCapture).toHaveBeenCalledWith(9)
    expect(drawing.drawings.value[0].price).toBe(150)
    add.mockRestore()
    remove.mockRestore()
  })
})

function createHarness() {
  const scope = ref('scope-a')
  const captured = new Set()
  const layer = {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 300, height: 180 }),
    setPointerCapture: vi.fn((id) => captured.add(id)),
    hasPointerCapture: vi.fn((id) => captured.has(id)),
    releasePointerCapture: vi.fn((id) => captured.delete(id)),
  }
  const timeScale = {
    width: () => 200,
    coordinateToTime: (x) => (x >= 0 && x <= 200 ? '2026-01-02' : null),
  }
  const chart = {
    timeScale: () => timeScale,
    panes: () => [{ getHeight: () => 100 }],
  }
  const series = { candle: { coordinateToPrice: (y) => 200 - y } }
  const primitive = {
    setState: vi.fn(),
    findAt: vi.fn(),
    findHandleAt: vi.fn(),
  }
  const drawing = useChartDrawings({
    getChart: () => chart,
    getSeries: () => series,
    getPrimitive: () => primitive,
    getScope: () => scope.value,
    getLayer: () => layer,
  })
  return { drawing, scope, layer, primitive }
}

function pointerEvent({ x, y, pointerId = 1, pointerType = 'mouse' }) {
  return {
    clientX: x + 10,
    clientY: y + 20,
    pointerId,
    pointerType,
    preventDefault: vi.fn(),
  }
}
