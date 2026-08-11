import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installSmoothWheelBridge,
  isFullHqViewport,
  readHqStockChipViewport,
  syncHostDiagnostics,
} from '../hqChartViewport.js'

const originalPixelRatio = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')

afterEach(() => {
  if (originalPixelRatio) Object.defineProperty(window, 'devicePixelRatio', originalPixelRatio)
})

function buildChart(overrides = {}) {
  const getYFromData = vi.fn((price) => 440 - ((price - 80) / 40) ** 2 * 400)
  const frame = {
    XPointCount: 38,
    HorizontalMin: 80,
    HorizontalMax: 120,
    GetBorder: vi.fn(() => ({ TopEx: 40, BottomEx: 440 })),
    GetYFromData: getYFromData,
    ...overrides.frame,
  }
  const chart = {
    JSChartContainer: {
      RightSpaceCount: 8,
      ChartPaint: [{ Data: { Data: Array.from({ length: 100 }), DataOffset: 20 } }],
      Frame: { SubFrame: [{ Frame: frame }] },
      ...overrides.container,
    },
  }
  return { chart, frame, getYFromData }
}

describe('readHqStockChipViewport', () => {
  it('按主 Frame 的真实范围和对数映射输出 CSS 像素视口', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 })
    const { chart, frame, getYFromData } = buildChart()

    const viewport = readHqStockChipViewport(chart)

    expect(viewport).toMatchObject({
      top: 20,
      height: 200,
      priceLower: 80,
      priceUpper: 120,
      activeIndex: 49,
      visibleWindow: 30,
    })
    expect(viewport.priceToY(80)).toBe(200)
    expect(viewport.priceToY(100)).toBe(150)
    expect(viewport.priceToY(120)).toBe(0)
    expect(viewport.priceToY('bad')).toBeNull()
    expect(viewport.signature).toBe(
      '20.0000000000|200.000000000|80.0000000000|120.000000000|49.0000000000|30.0000000000|200.000000000|150.000000000|0.00000000000',
    )
    expect(frame.GetBorder).toHaveBeenCalled()
    expect(getYFromData).toHaveBeenCalledWith(100, true)
  })

  it('限制末端数据索引，并可从 ChartBorder 读取真实边框', () => {
    const getBorder = vi.fn(() => ({ TopEx: 10, BottomEx: 210 }))
    const { chart } = buildChart({
      frame: { GetBorder: undefined, ChartBorder: { GetBorder: getBorder }, XPointCount: 80 },
      container: {
        RightSpaceCount: 8,
        ChartPaint: [{ Data: { Data: Array.from({ length: 100 }), DataOffset: 70 } }],
      },
    })

    expect(readHqStockChipViewport(chart)).toMatchObject({
      activeIndex: 99,
      visibleWindow: 30,
      top: 10,
      height: 200,
    })
    expect(getBorder).toHaveBeenCalled()
  })

  it.each([
    ['缺少图表', null],
    ['没有数据', buildChart({ container: { ChartPaint: [{ Data: { Data: [], DataOffset: 0 } }] } }).chart],
    ['没有可见 K 线', buildChart({ frame: { XPointCount: 8 } }).chart],
    ['没有价格映射', buildChart({ frame: { GetYFromData: undefined } }).chart],
    ['价格范围无效', buildChart({ frame: { HorizontalMax: 80 } }).chart],
    ['边框无效', buildChart({ frame: { GetBorder: () => ({ TopEx: 20, BottomEx: 20 }) } }).chart],
  ])('%s 时返回 null', (_, chart) => {
    expect(readHqStockChipViewport(chart)).toBeNull()
  })
})

describe('installSmoothWheelBridge', () => {
  it('只累计 HQ 原生忽略的小触控板滚动，并可完整卸载', () => {
    const element = document.createElement('div')
    const onWheel = vi.fn()
    const release = installSmoothWheelBridge(element, { JSChartContainer: { OnWheel: onWheel } })

    element.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, clientX: 10, clientY: 20, cancelable: true }))
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, clientX: 10, clientY: 20, cancelable: true }))
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: 30, clientX: 10, clientY: 20, cancelable: true }))
    expect(onWheel).toHaveBeenCalledOnce()
    expect(onWheel.mock.calls[0][0]).toMatchObject({ deltaY: 100, clientX: 10, clientY: 20 })

    release()
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: 90, cancelable: true }))
    expect(onWheel).toHaveBeenCalledOnce()
  })
})

describe('syncHostDiagnostics', () => {
  it('把 HQ 实际数据量、偏移和可见 K 线数暴露给自动验收', () => {
    const element = document.createElement('div')
    const chart = {
      JSChartContainer: {
        RightSpaceCount: 8,
        ChartPaint: [{ Data: { Data: Array.from({ length: 1356 }), DataOffset: 0 } }],
        Frame: { SubFrame: [{ Frame: { XPointCount: 1364 } }, { Frame: {} }] },
      },
    }

    expect(syncHostDiagnostics(element, chart)).toEqual({
      dataCount: 1356,
      dataOffset: 0,
      rightSpace: 8,
      visibleKlineCount: 1356,
      windowCount: 2,
    })
    expect(element.dataset).toMatchObject({
      hqDiagnostics: 'ready',
      hqDataCount: '1356',
      hqDataOffset: '0',
      hqRightSpace: '8',
      hqVisibleKlineCount: '1356',
      hqWindowCount: '2',
    })
  })
})

describe('isFullHqViewport', () => {
  it('只把零偏移且覆盖全部数据的视角视为全览', () => {
    const chart = (dataOffset, xPointCount) => ({
      JSChartContainer: {
        RightSpaceCount: 8,
        ChartPaint: [{ Data: { Data: Array.from({ length: 100 }), DataOffset: dataOffset } }],
        Frame: { SubFrame: [{ Frame: { XPointCount: xPointCount } }] },
      },
    })

    expect(isFullHqViewport(chart(0, 108))).toBe(true)
    expect(isFullHqViewport(chart(1, 108))).toBe(false)
    expect(isFullHqViewport(chart(0, 80))).toBe(false)
    expect(isFullHqViewport({})).toBe(false)
  })
})
