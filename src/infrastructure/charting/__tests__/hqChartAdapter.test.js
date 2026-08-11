import { beforeEach, describe, expect, it, vi } from 'vitest'
const hq = vi.hoisted(() => {
  const chart = {
    SetOption: vi.fn(),
    OnSize: vi.fn(),
    ChangePeriod: vi.fn(),
    ChangeIndex: vi.fn(),
    ChangeKLineDrawType: vi.fn(),
    CreateChartDrawPicture: vi.fn(() => 'drawing-created'),
    StopAutoUpdate: vi.fn(),
    ChartDestroy: vi.fn(),
    JSChartContainer: { ShowDrawToolDialog: vi.fn(), OnWheel: vi.fn() },
  }
  const style = { name: 'mock-style' }
  const Chart = {
    JSCHART_EVENT_ID: {
      RECV_HISTROY_DATA: 3,
      ON_FINISH_DRAWPICTURE: 18,
      ON_MOUSE_MOVE: 64,
      ON_RELOAD_INDEX_CHART_RESOURCE: 103,
      ON_RELOAD_OVERLAY_INDEX_CHART_RESOURCE: 104,
      ON_MENU_COMMAND: 151,
      ON_CREATE_RIGHT_MENU: 152,
    },
    JS_ID: {
      JSCHART_MENU_ID: {
        CMD_CHANGE_PERIOD_ID: 1,
        CMD_CHANGE_INDEX_ID: 4,
        CMD_CHANGE_COLOR_INDEX_ID: 5,
        CMD_CHANGE_KLINE_TYPE_ID: 9,
        CMD_OVERLAY_SYMBOL_ID: 11,
        CMD_SHOW_DRAWTOOL_ID: 18,
        CMD_SHOW_CORSS_LINE_ID: 39,
        CMD_ENABLE_POP_MINUTE_CHART_ID: 40,
        CMD_SHOW_CHANGE_INDEX_DIALOG_ID: 70,
      },
    },
    IChartDrawPicture: {
      ArrayDrawPricture: [{ Name: 'TVShortPosition', ClassName: 'ChartDrawTVShortPositionn' }],
    },
    STYLE_TYPE_ID: { WHITE_ID: 1, BLACK_ID: 2 },
    HQChartStyle: { GetStyleConfig: vi.fn(() => style) },
    JSChart: {
      Init: vi.fn(() => chart),
      SetStyle: vi.fn(),
      SetCSSStyle: vi.fn(),
    },
  }
  return { chart, Chart, runtime: { Chart }, style }
})
vi.mock('hqchart', () => ({ default: hq.runtime }))
import { buildHqChartOption, createHqChartAdapter, repairHqRuntimeRegistry } from '../hqChartAdapter.js'

function sizedElement() {
  const element = document.createElement('div')
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 520 },
  })
  return element
}

function resolveFirstFrame(option) {
  const ready = option.EventCallback.find((item) => item.event === hq.Chart.JSCHART_EVENT_ID.RECV_HISTROY_DATA)
  ready.callback()
  return true
}

describe('buildHqChartOption', () => {
  it('锁定本地数据、窗口、周期和画线存储契约', () => {
    const networkFilter = vi.fn()
    const onHistoryReady = vi.fn()
    const onCursor = vi.fn()
    const onDrawingFinished = vi.fn()
    const onReloadIndexResource = vi.fn()
    const onReloadOverlayResource = vi.fn()
    const onWarning = vi.fn()
    const onMenuCommand = vi.fn()
    const option = buildHqChartOption({
      source: { symbol: '600519', market: 'A股', label: '贵州茅台' },
      drawingScope: 'desk/600519 A',
      preferences: { period: '2', mainIndex: 'EMA', subIndex1: 'RSI', subIndex2: 'CCI' },
      pageSize: 320,
      networkFilter,
      eventIds: hq.Chart.JSCHART_EVENT_ID,
      menuIds: hq.Chart.JS_ID.JSCHART_MENU_ID,
      onHistoryReady,
      onCursor,
      onDrawingFinished,
      onReloadIndexResource,
      onReloadOverlayResource,
      onWarning,
      onMenuCommand,
    })

    expect(option).toMatchObject({
      Type: '历史K线图',
      Symbol: '600519.sh',
      Language: 'CN',
      IsAutoUpdate: false,
      EnableResize: false,
      NetworkFilter: networkFilter,
      KLine: {
        Period: 2,
        Right: 0,
        DragMode: 1,
        ZoomType: 1,
        PageSize: 320,
        PageSizeV2: 320,
        MaxRequestDataCount: 320,
        RightSpaceCount: 8,
      },
      DrawTool: {
        StorageKey: 'lab.hqchart.drawings.v1.desk-600519-A',
        EnableCrossPeriod: true,
      },
      Border: { AutoRight: { MinWidth: 58, Blank: 4 } },
      EnableXDrag: { Bottom: true, LButton: { Type: 2 } },
      EnableYDrag: { Right: true },
      EnableBorderDrag: true,
      EnableZoomIndexWindow: true,
      SelectRectDialog: { Enable: true },
    })
    expect(option.Windows.map((item) => item.Index)).toEqual(['EMA', 'VOL', 'RSI', 'CCI'])
    expect(option.Windows[0]).toMatchObject({
      Modify: false,
      Change: false,
      Close: false,
      MaxMin: false,
      TitleWindow: false,
      TitleHeight: 0,
    })
    expect(option.Windows.slice(1, 4)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Modify: false,
          Change: false,
          Close: false,
          MaxMin: true,
          TitleWindow: true,
          IsShowIndexName: true,
          TitleHeight: 22,
        }),
      ]),
    )
    expect(option.Frame).toHaveLength(option.Windows.length)
    expect(option.Frame[0].YCoordinateType).toBe(2)
    expect(option.Frame.slice(1).every((frame) => frame.YCoordinateType === 0)).toBe(true)
    expect(option.KLineTitle.IsShowSettingInfo).toBe(false)
    expect(option.KLine).toMatchObject({
      IsShowTooltip: false,
      IsShowMaxMinPrice: false,
      EnablePrediction: false,
    })
    expect(option).toMatchObject({
      IsShowRightMenu: true,
      EnablePopMenuV2: true,
      TooltipDialog: { Enable: false },
    })
    expect(option.ModifyIndexParamDialog.Enable).toBe(false)
    expect(option.SearchIndexDialog.Enable).toBe(false)

    const historyEvent = option.EventCallback.find((item) => item.event === 3)
    const cursorEvent = option.EventCallback.find((item) => item.event === 64)
    const drawingEvent = option.EventCallback.find((item) => item.event === 18)
    const indexResourceEvent = option.EventCallback.find((item) => item.event === 103)
    const overlayResourceEvent = option.EventCallback.find((item) => item.event === 104)
    const menuEvent = option.EventCallback.find((item) => item.event === 151)
    historyEvent.callback()
    cursorEvent.callback(null, { Draw: { Date: 20260808 }, DataIndex: 7 })
    drawingEvent.callback(null, { Name: '趋势线' })
    indexResourceEvent.callback(null, { Chart: { Name: '期权 Delta' } })
    overlayResourceEvent.callback(null, { Chart: { Name: '成本锚' } })
    const minuteCommand = { CommandID: 1, Args: [4], PreventDefault: false }
    menuEvent.callback(null, minuteCommand)
    option.ScriptError({ Message: 'MACD 执行失败' })

    expect(onHistoryReady).toHaveBeenCalledOnce()
    expect(onCursor).toHaveBeenCalledWith({ Draw: { Date: 20260808 }, DataIndex: 7 })
    expect(onDrawingFinished).toHaveBeenCalledWith({ Name: '趋势线' })
    expect(onReloadIndexResource).toHaveBeenCalledWith({ Chart: { Name: '期权 Delta' } })
    expect(onReloadOverlayResource).toHaveBeenCalledWith({ Chart: { Name: '成本锚' } })
    expect(minuteCommand.PreventDefault).toBe(true)
    expect(onMenuCommand).not.toHaveBeenCalled()
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('分钟周期已禁用'))
    expect(onWarning).toHaveBeenCalledWith('MACD 执行失败')
  })

  it('把右键菜单创建和命令执行都接到同一严格白名单', () => {
    const onWarning = vi.fn()
    const onMenuCommand = vi.fn()
    const option = buildHqChartOption({
      source: {},
      eventIds: hq.Chart.JSCHART_EVENT_ID,
      menuIds: hq.Chart.JS_ID.JSCHART_MENU_ID,
      onWarning,
      onMenuCommand,
    })
    const createCallbacks = option.EventCallback.filter((item) => item.event === 152)
    const commandCallbacks = option.EventCallback.filter((item) => item.event === 151)
    const menuData = {
      MenuData: {
        Menu: [
          {
            Name: '分析周期',
            SubMenu: [
              { Name: '日线', Data: { ID: 1, Args: [0] } },
              { Name: '1分', Data: { ID: 1, Args: [4] } },
            ],
          },
          { Name: '画图工具', Data: { ID: 18, Args: [] } },
          { Name: 'BOLL', Data: { ID: 4, Args: [0, 'BOLL'] } },
        ],
      },
    }

    createCallbacks[0].callback(null, menuData, hq.chart)
    expect(menuData.MenuData.Menu.map((item) => item.Name)).toEqual(['分析周期', '画图工具'])
    expect(menuData.MenuData.Menu[0].SubMenu.map((item) => item.Name)).toEqual(['日线'])

    const allowed = { CommandID: 18, Args: [], PreventDefault: false }
    const blocked = { CommandID: 4, Args: [0, 'BOLL'], PreventDefault: false }
    commandCallbacks[0].callback(null, allowed, hq.chart)
    commandCallbacks[0].callback(null, blocked, hq.chart)

    expect(createCallbacks).toHaveLength(1)
    expect(commandCallbacks).toHaveLength(1)
    expect(allowed.PreventDefault).toBe(false)
    expect(blocked.PreventDefault).toBe(true)
    expect(onMenuCommand).toHaveBeenCalledOnce()
    expect(onMenuCommand).toHaveBeenCalledWith(allowed)
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('HQ 原生指标'))
  })

  it('修正当前 HQChart 版本空仓尺的持久化类名', () => {
    const registry = {
      IChartDrawPicture: {
        ArrayDrawPricture: [{ Name: 'TVShortPosition', ClassName: 'ChartDrawTVShortPositionn' }],
      },
    }
    expect(repairHqRuntimeRegistry(registry)).toBe(true)
    expect(registry.IChartDrawPicture.ArrayDrawPricture[0].ClassName).toBe('ChartDrawTVShortPosition')
    expect(repairHqRuntimeRegistry(registry)).toBe(false)
  })

  it('没有事件 ID 时不注册无效回调，空 scope 使用 global', () => {
    const option = buildHqChartOption({ source: {}, drawingScope: '   ', eventIds: {} })

    expect(option.EventCallback).toEqual([])
    expect(option.DrawTool.StorageKey).toBe('lab.hqchart.drawings.v1.global')
  })

  it('成交量关闭时移除 VOL 窗口并保持副图和 Frame 对齐', () => {
    const option = buildHqChartOption({
      source: {},
      volumeEnabled: false,
      preferences: { mainIndex: 'MA', subIndex1: 'MACD', subIndex2: 'EMPTY' },
      eventIds: {},
    })

    expect(option.Windows.map((item) => item.Index)).toEqual(['MA', 'MACD'])
    expect(option.Frame).toHaveLength(option.Windows.length)
    expect(option.Frame.map((frame) => frame.YCoordinateType)).toEqual([2, 0])
  })

  it('仅主图使用对数坐标，研究副图也被锁定为线性坐标', () => {
    const option = buildHqChartOption({
      source: {},
      preferences: { subIndex1: 'RSI' },
      researchConfig: {
        windows: [{ Index: 'LAB_RISK' }],
        frames: [{ Height: 1.4, YCoordinateType: 4 }],
      },
      eventIds: {},
    })

    expect(option.Frame.map((frame) => frame.YCoordinateType)).toEqual([2, 0, 0, 0])
  })

  it('默认不创建空的 HQ 副图窗口', () => {
    const option = buildHqChartOption({ source: {}, preferences: {}, eventIds: {} })

    expect(option.Windows.map((item) => item.Index)).toEqual(['EMPTY', 'VOL'])
    expect(option.Frame).toHaveLength(2)
  })
})

describe('createHqChartAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hq.chart.JSChartContainer = { ShowDrawToolDialog: vi.fn(), OnWheel: vi.fn() }
    hq.Chart.IChartDrawPicture.ArrayDrawPricture[0].ClassName = 'ChartDrawTVShortPositionn'
    hq.chart.SetOption.mockImplementation(resolveFirstFrame)
    hq.chart.CreateChartDrawPicture.mockReturnValue('drawing-created')
  })

  it('初始化主题与首帧，并把公开命令映射到 HQChart', async () => {
    const element = sizedElement()
    element.append(document.createElement('canvas'))
    element.JSChart = { stale: true }
    const onPreferenceChange = vi.fn()

    const adapter = await createHqChartAdapter({
      element,
      dark: true,
      drawingScope: 'fixture',
      preferences: { period: 1, drawType: 2 },
      getRows: () => [{ date: '2026-08-08' }],
      getSource: () => ({ symbol: '600519', market: 'A股' }),
      onPreferenceChange,
    })

    expect(hq.Chart.HQChartStyle.GetStyleConfig).toHaveBeenCalledWith(2)
    expect(hq.Chart.JSChart.SetStyle).toHaveBeenCalledWith(hq.style)
    expect(hq.Chart.JSChart.SetCSSStyle).toHaveBeenCalledWith(2)
    expect(hq.Chart.JSChart.Init).toHaveBeenCalledWith(element)
    expect(element.JSChart).toBe(hq.chart)
    expect(hq.chart.SetOption).toHaveBeenCalledWith(expect.objectContaining({ Symbol: '600519.sh' }))
    expect(hq.chart.SetOption.mock.calls[0][0].KLine).toMatchObject({
      PageSize: 1,
      PageSizeV2: 1,
      MaxRequestDataCount: 1,
    })
    expect(hq.chart.ChangeKLineDrawType).toHaveBeenCalledWith(2, true)
    expect(hq.chart.OnSize).toHaveBeenCalledWith({ Type: 2 })

    const menuCallback = hq.chart.SetOption.mock.calls[0][0].EventCallback.find((item) => item.event === 151)
    menuCallback.callback(null, { CommandID: 1, Args: [2], PreventDefault: false }, hq.chart)
    menuCallback.callback(null, { CommandID: 9, Args: [3], PreventDefault: false }, hq.chart)
    expect(onPreferenceChange).toHaveBeenNthCalledWith(1, 'period', 2)
    expect(onPreferenceChange).toHaveBeenNthCalledWith(2, 'drawType', 3)

    adapter.resize()
    adapter.changePeriod(2)
    adapter.changePeriod(999)
    adapter.changeIndex('2', 'RSI')
    adapter.changeKLineStyle('3')
    const drawing = adapter.startDrawing('趋势线')
    adapter.showDrawTools()
    adapter.fitContent()

    expect(hq.chart.OnSize).toHaveBeenCalledTimes(4)
    expect(hq.chart.OnSize).toHaveBeenNthCalledWith(2, { Type: 1 })
    expect(hq.chart.OnSize).toHaveBeenNthCalledWith(3, { Type: 2 })
    expect(hq.chart.OnSize).toHaveBeenNthCalledWith(4, { Type: 2 })
    expect(hq.chart.ChangePeriod).toHaveBeenCalledTimes(1)
    expect(hq.chart.ChangePeriod).toHaveBeenCalledWith(2)
    expect(hq.chart.ChangeIndex).toHaveBeenCalledWith(2, 'RSI', { Redraw: true })
    expect(hq.chart.ChangeKLineDrawType).toHaveBeenLastCalledWith(3, true)
    expect(hq.chart.CreateChartDrawPicture).toHaveBeenCalledWith('趋势线', {
      LineColor: '#7dd3fc',
      LineWidth: 2,
      PointColor: '#e98b2a',
    })
    expect(drawing).toBe('drawing-created')
    expect(hq.chart.JSChartContainer.ShowDrawToolDialog).toHaveBeenCalledWith(0, 0)

    Object.assign(hq.chart.JSChartContainer, {
      RightSpaceCount: 0,
      ChartPaint: [{ Data: { Data: [{}], DataOffset: 0 } }],
      Frame: {
        SubFrame: [
          {
            Frame: {
              XPointCount: 1,
              HorizontalMin: 20,
              HorizontalMax: 120,
              GetBorder: () => ({ TopEx: 20, BottomEx: 220 }),
              GetYFromData: (price) => 220 - price,
            },
          },
        ],
      },
    })
    expect(adapter.getStockChipViewport()).toMatchObject({
      top: 20,
      height: 200,
      priceLower: 20,
      priceUpper: 120,
      activeIndex: 0,
      visibleWindow: 1,
    })

    adapter.destroy()
    adapter.destroy()

    expect(hq.chart.StopAutoUpdate).toHaveBeenCalledOnce()
    expect(hq.chart.ChartDestroy).toHaveBeenCalledOnce()
    expect(element.childNodes).toHaveLength(0)
    expect(element.JSChart).toBeUndefined()
    expect(adapter.getStockChipViewport()).toBeNull()

    adapter.resize()
    expect(hq.chart.OnSize).toHaveBeenCalledTimes(4)
  })

  it('在加载 runtime 前拒绝缺失或零尺寸容器', async () => {
    await expect(createHqChartAdapter()).rejects.toThrow('HQChart 容器不存在')

    const zeroSize = document.createElement('div')
    await expect(createHqChartAdapter({ element: zeroSize })).rejects.toThrow('HQChart 容器尺寸为 0')

    expect(hq.Chart.JSChart.Init).not.toHaveBeenCalled()
  })

  it('初始化已取消时不会创建脱离页面的 HQChart', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(createHqChartAdapter({ element: sizedElement(), signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(hq.Chart.JSChart.Init).not.toHaveBeenCalled()
  })

  it('SetOption 拒绝配置时销毁半初始化实例', async () => {
    const element = sizedElement()
    element.append(document.createElement('canvas'))
    hq.chart.SetOption.mockReturnValue(false)

    await expect(
      createHqChartAdapter({
        element,
        getRows: () => [],
        getSource: () => ({ symbol: '600519', market: 'A股' }),
      }),
    ).rejects.toThrow('HQChart 拒绝了当前配置')

    expect(hq.chart.StopAutoUpdate).toHaveBeenCalledOnce()
    expect(hq.chart.ChartDestroy).toHaveBeenCalledOnce()
    expect(element.childNodes).toHaveLength(0)
  })
})
