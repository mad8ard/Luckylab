import { afterEach, describe, expect, it, vi } from 'vitest'
import { destroyHqChartSafely, installHqDialogDragTracker, releaseHqDialogDrags } from '../hqChartLifecycle.js'

afterEach(() => {
  document.onmousemove = null
  document.onmouseup = null
})

describe('HQChart lifecycle', () => {
  it.each([
    'DialogDrawTool',
    'DialogModifyDraw',
    'DialogTooltip',
    'DialogSelectRect',
    'DialogSearchIndex',
    'DialogModifyIndexParam',
  ])('只释放当前实例拥有的 %s 标题拖动', (key) => {
    const div = document.createElement('div')
    document.body.append(div)
    const dialog = { DivDialog: div, DragTitle: { x: 1 }, DocOnMouseUpTitle: vi.fn() }
    const container = { [key]: dialog }
    const stopTracking = installHqDialogDragTracker(container)
    div.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    document.onmousemove = vi.fn()
    document.onmouseup = vi.fn()

    releaseHqDialogDrags(container)

    expect(dialog.DocOnMouseUpTitle).toHaveBeenCalledWith({})
    expect(dialog.DragTitle).toBeNull()
    expect(document.onmousemove).toBeNull()
    expect(document.onmouseup).toBeNull()
    stopTracking()
    div.remove()
  })

  it('第三方清理抛错时仍完成其余销毁并保留宿主清理', () => {
    const element = document.createElement('div')
    element.dataset.hqDiagnostics = 'ready'
    element.append(document.createElement('canvas'))
    const dialogDiv = document.createElement('div')
    document.body.append(dialogDiv)
    const dialog = {
      DivDialog: dialogDiv,
      DragTitle: { x: 1 },
      DocOnMouseUpTitle: vi.fn(() => {
        throw new Error('vendor drag cleanup failed')
      }),
    }
    const chart = {
      JSChartContainer: { DialogModifyIndexParam: dialog },
      StopAutoUpdate: vi.fn(() => {
        throw new Error('vendor stop failed')
      }),
      ChartDestroy: vi.fn(),
    }
    element.JSChart = chart
    const releaseDialogTracker = installHqDialogDragTracker(chart.JSChartContainer)
    dialogDiv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(() =>
      destroyHqChartSafely(chart, element, {
        releaseDialogTracker,
        releaseWheel: () => {
          throw new Error('wheel cleanup failed')
        },
      }),
    ).not.toThrow()
    expect(chart.ChartDestroy).toHaveBeenCalledOnce()
    expect(element.childNodes).toHaveLength(0)
    expect(element.JSChart).toBeUndefined()
    expect(element.dataset.hqDiagnostics).toBeUndefined()
    dialogDiv.remove()
  })

  it('旧实例晚到销毁时不清空同一宿主的新实例', () => {
    const element = document.createElement('div')
    const canvas = document.createElement('canvas')
    element.append(canvas)
    element.dataset.hqDiagnostics = 'ready'
    const oldChart = { StopAutoUpdate: vi.fn(), ChartDestroy: vi.fn() }
    const newChart = { id: 'new' }
    element.JSChart = newChart

    expect(destroyHqChartSafely(oldChart, element)).toBe(false)
    expect(oldChart.StopAutoUpdate).toHaveBeenCalledOnce()
    expect(oldChart.ChartDestroy).not.toHaveBeenCalled()
    expect(element.JSChart).toBe(newChart)
    expect(element.firstChild).toBe(canvas)
    expect(element.dataset.hqDiagnostics).toBe('ready')
  })

  it('销毁非当前拖动实例不会清掉另一实例的全局拖动', () => {
    const divA = document.createElement('div')
    const divB = document.createElement('div')
    document.body.append(divA, divB)
    const dialogA = { DivDialog: divA, DragTitle: { x: 1 }, DocOnMouseUpTitle: vi.fn() }
    const dialogB = { DivDialog: divB, DragTitle: { x: 1 }, DocOnMouseUpTitle: vi.fn() }
    const stopA = installHqDialogDragTracker({ DialogDrawTool: dialogA })
    const stopB = installHqDialogDragTracker({ DialogDrawTool: dialogB })
    divB.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    const moveB = vi.fn()
    const upB = vi.fn()
    document.onmousemove = moveB
    document.onmouseup = upB

    releaseHqDialogDrags({ DialogDrawTool: dialogA })

    expect(dialogA.DragTitle).toBeNull()
    expect(dialogA.DocOnMouseUpTitle).not.toHaveBeenCalled()
    expect(document.onmousemove).toBe(moveB)
    expect(document.onmouseup).toBe(upB)
    stopA()
    stopB()
    divA.remove()
    divB.remove()
  })

  it('正常松手也能清理 ModifyIndexParam 遗留的 document handler', () => {
    const div = document.createElement('div')
    document.body.append(div)
    const dialog = {
      DivDialog: div,
      DragTitle: null,
      DocOnMouseUpTitle: vi.fn(function () {
        this.DragTitle = null
        // Mirror the current HQChart bug: it clears instance fields rather
        // than the document-level handlers installed on mousedown.
        this.onmousemove = null
        this.onmouseup = null
      }),
    }
    const stopTracking = installHqDialogDragTracker({ DialogModifyIndexParam: dialog })
    div.addEventListener('mousedown', () => {
      dialog.DragTitle = { x: 1 }
      document.onmousemove = vi.fn()
      document.onmouseup = vi.fn()
    })

    div.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    div.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

    expect(dialog.DocOnMouseUpTitle).toHaveBeenCalledWith({})
    expect(dialog.DragTitle).toBeNull()
    expect(document.onmousemove).toBeNull()
    expect(document.onmouseup).toBeNull()
    stopTracking()
    div.remove()
  })

  it('弹窗内普通点击不清理无关的 document handler', () => {
    const div = document.createElement('div')
    document.body.append(div)
    const dialog = { DivDialog: div, DragTitle: null, DocOnMouseUpTitle: vi.fn() }
    const stopTracking = installHqDialogDragTracker({ DialogModifyIndexParam: dialog })
    const unrelatedMove = vi.fn()
    const unrelatedUp = vi.fn()
    document.onmousemove = unrelatedMove
    document.onmouseup = unrelatedUp

    div.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    div.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

    expect(dialog.DocOnMouseUpTitle).not.toHaveBeenCalled()
    expect(document.onmousemove).toBe(unrelatedMove)
    expect(document.onmouseup).toBe(unrelatedUp)
    stopTracking()
    div.remove()
  })
})
