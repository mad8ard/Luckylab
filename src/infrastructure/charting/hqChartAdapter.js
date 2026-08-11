import { createHqNetworkFilter, dateNumber, toHqSymbol } from './hqChartDataAdapter.js'
import { HQ_PERIODS } from './hqChartCatalog.js'
import {
  applyHqResearchSeriesStyle,
  buildHqResearchChartConfig,
  toHqResearchIndexResponse,
} from './hqChartResearchAdapter.js'
import {
  installSmoothWheelBridge,
  isFullHqViewport,
  readHqStockChipViewport,
  syncHostDiagnostics,
} from './hqChartViewport.js'
import { destroyHqChartSafely, installHqDialogDragTracker } from './hqChartLifecycle.js'
import { filterHqRightMenuByPolicy, guardHqRightMenuCommand } from './hqChartMenuPolicy.js'

let hqChartModulePromise = null

export async function loadHqChartRuntime() {
  if (!hqChartModulePromise) {
    hqChartModulePromise = import('hqchart')
      .then((module) => module.default ?? module)
      .catch((error) => {
        hqChartModulePromise = null
        throw error
      })
  }
  return hqChartModulePromise
}

export async function createHqChartAdapter({
  element,
  getRows,
  getSource,
  getResearchModel,
  drawingScope,
  dark = false,
  preferences,
  signal,
  onCursor,
  onDrawingFinished,
  onUnsupported,
  onWarning,
  onPreferenceChange,
} = {}) {
  assertNotAborted(signal)
  if (!element) throw new Error('HQChart 容器不存在')
  if (!element.clientWidth || !element.clientHeight) throw new Error('HQChart 容器尺寸为 0')

  const HQChart = await loadHqChartRuntime()
  assertNotAborted(signal)
  const ChartApi = HQChart?.Chart
  if (!ChartApi?.JSChart?.Init) throw new Error('HQChart JSChart API 不可用')
  repairHqRuntimeRegistry(ChartApi)
  applyHqTheme(ChartApi, dark)

  let destroyed = false
  let currentPeriod = Number(preferences?.period ?? 0)
  let readyTimer = null
  let releaseSmoothWheel = () => {}
  let releaseDialogTracker = () => {}
  let releaseCursorBoundary = () => {}
  let resolveReady
  let rejectReady
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const abortReady = () => rejectReady?.(abortError())
  signal?.addEventListener('abort', abortReady, { once: true })
  const dateIndex = () => new Map((getRows?.() ?? []).map((row, index) => [dateNumber(row.date), index]))
  const eventIds = ChartApi.JSCHART_EVENT_ID
  const menuIds = ChartApi.JS_ID?.JSCHART_MENU_ID
  const initialResearchModel = getResearchModel?.()
  const initialRowCount = getRows?.()?.length ?? 0
  const volumeEnabled = initialResearchModel?.controls?.volume?.active !== false
  const baseWindowCount = 1 + Number(volumeEnabled) + activeNativeSubIndexes(preferences).length
  const researchConfig = buildHqResearchChartConfig(initialResearchModel, { windowOffset: baseWindowCount })
  const networkFilter = createHqNetworkFilter({
    getRows,
    getSource,
    getResearchResponse: (apiId) => toHqResearchIndexResponse(getResearchModel?.(), apiId, getSource?.() ?? {}),
    onUnsupported,
  })
  const chart = ChartApi.JSChart.Init(element)
  // Keep the instance on its owning host. Besides matching HQChart's common
  // integration pattern, this makes lifecycle ownership explicit and lets
  // diagnostics verify the real viewport without reaching into Vue state.
  element.JSChart = chart
  releaseDialogTracker = installHqDialogDragTracker(chart?.JSChartContainer)

  try {
    const result = chart.SetOption(
      buildHqChartOption({
        source: getSource?.() ?? {},
        drawingScope,
        preferences,
        pageSize: initialRowCount,
        volumeEnabled,
        researchConfig,
        networkFilter,
        eventIds,
        menuIds,
        onHistoryReady: () => resolveReady?.(),
        onCursor: (eventData) => emitCursor(eventData, currentPeriod, dateIndex(), onCursor),
        onDrawingFinished,
        onReloadIndexResource: (data) => applyHqResearchSeriesStyle(data, getResearchModel?.()),
        onReloadOverlayResource: (data) => applyHqResearchSeriesStyle(data, getResearchModel?.()),
        onWarning,
        onMenuCommand: (data) => {
          if (data?.CommandID === menuIds?.CMD_CHANGE_PERIOD_ID) {
            currentPeriod = data.Args[0]
            onPreferenceChange?.('period', currentPeriod)
          } else if (data?.CommandID === menuIds?.CMD_CHANGE_KLINE_TYPE_ID) {
            onPreferenceChange?.('drawType', data.Args[0])
          }
        },
      }),
    )
    if (result === false) throw new Error('HQChart 拒绝了当前配置')
    if (Number(preferences?.drawType) > 0) chart.ChangeKLineDrawType(Number(preferences.drawType), true)
    readyTimer = window.setTimeout(() => rejectReady?.(new Error('HQChart 首帧等待超时')), 8000)
    await ready
    assertNotAborted(signal)
    window.clearTimeout(readyTimer)
    readyTimer = null
    releaseCursorBoundary = installCursorBoundary(element, chart, onCursor)
    // Type=2 走 HQChart 的 ShowAllKLine，避免精确首屏数量又被
    // OnSize(Type=1) 按内置柱宽改回较少的可见数量。
    chart.OnSize({ Type: 2 })
    syncHostDiagnostics(element, chart)
    releaseSmoothWheel = installSmoothWheelBridge(element, chart)
  } catch (error) {
    window.clearTimeout(readyTimer)
    releaseCursorBoundary()
    destroyHqChartSafely(chart, element, { releaseDialogTracker })
    throw error
  } finally {
    signal?.removeEventListener('abort', abortReady)
  }

  return {
    resize() {
      if (destroyed) return
      // Light 在全览状态下 resize 后仍覆盖完整数据；已经由用户缩放
      // 到局部时则保留局部视角。HQ 的 Type=1 会把“全览”悄悄裁掉
      // 数根 K 线，因此只在局部视角使用它。
      chart.OnSize({ Type: isFullHqViewport(chart) ? 2 : 1 })
      syncHostDiagnostics(element, chart)
    },
    changePeriod(period) {
      const value = Number(period)
      if (!HQ_PERIODS.some((item) => item.id === value)) return
      currentPeriod = value
      chart.ChangePeriod(value)
      chart.OnSize({ Type: 2 })
      syncHostDiagnostics(element, chart)
    },
    changeIndex(windowIndex, indexName) {
      chart.ChangeIndex(Number(windowIndex), String(indexName), { Redraw: true })
    },
    changeKLineStyle(drawType) {
      chart.ChangeKLineDrawType(Number(drawType), true)
    },
    startDrawing(name) {
      return chart.CreateChartDrawPicture(String(name), {
        LineColor: dark ? '#7dd3fc' : '#0f766e',
        LineWidth: 2,
        PointColor: '#e98b2a',
      })
    },
    showDrawTools() {
      chart.JSChartContainer?.ShowDrawToolDialog?.(0, 0)
    },
    fitContent() {
      chart.OnSize({ Type: 2 })
      syncHostDiagnostics(element, chart)
    },
    getStockChipViewport() {
      return destroyed ? null : readHqStockChipViewport(chart)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      window.clearTimeout(readyTimer)
      releaseCursorBoundary()
      destroyHqChartSafely(chart, element, { releaseDialogTracker, releaseWheel: releaseSmoothWheel })
    },
    raw: chart,
  }
}

export function buildHqChartOption({
  source,
  drawingScope,
  preferences = {},
  pageSize = 100,
  volumeEnabled = true,
  researchConfig = {},
  networkFilter,
  eventIds,
  menuIds,
  onHistoryReady,
  onCursor,
  onDrawingFinished,
  onReloadIndexResource,
  onReloadOverlayResource,
  onWarning,
  onMenuCommand,
}) {
  const nativeSubIndexes = activeNativeSubIndexes(preferences)
  const callbacks = []
  if (eventIds?.RECV_HISTROY_DATA) {
    callbacks.push({ event: eventIds.RECV_HISTROY_DATA, callback: onHistoryReady })
  }
  if (eventIds?.ON_MOUSE_MOVE) {
    callbacks.push({ event: eventIds.ON_MOUSE_MOVE, callback: (_, data) => onCursor?.(data) })
  }
  if (eventIds?.ON_FINISH_DRAWPICTURE) {
    callbacks.push({ event: eventIds.ON_FINISH_DRAWPICTURE, callback: (_, data) => onDrawingFinished?.(data) })
  }
  if (eventIds?.ON_RELOAD_INDEX_CHART_RESOURCE) {
    callbacks.push({
      event: eventIds.ON_RELOAD_INDEX_CHART_RESOURCE,
      callback: (_, data) => onReloadIndexResource?.(data),
    })
  }
  if (eventIds?.ON_RELOAD_OVERLAY_INDEX_CHART_RESOURCE) {
    callbacks.push({
      event: eventIds.ON_RELOAD_OVERLAY_INDEX_CHART_RESOURCE,
      callback: (_, data) => onReloadOverlayResource?.(data),
    })
  }
  if (eventIds?.ON_CREATE_RIGHT_MENU) {
    callbacks.push({
      event: eventIds.ON_CREATE_RIGHT_MENU,
      callback: (_, data, chart) => filterHqRightMenuByPolicy(data, menuIds, chart),
    })
  }
  if (eventIds?.ON_MENU_COMMAND) {
    callbacks.push({
      event: eventIds.ON_MENU_COMMAND,
      callback: (_, data, chart) => {
        guardHqRightMenuCommand(data, menuIds, onWarning, chart)
        if (!data?.PreventDefault) onMenuCommand?.(data)
      },
    })
  }

  return {
    Type: '历史K线图',
    Symbol: toHqSymbol(source),
    Language: 'CN',
    Windows: [
      controlledNativeWindow(preferences.mainIndex ?? 'EMPTY'),
      ...(volumeEnabled ? [controlledNativeWindow('VOL', { paneControls: true })] : []),
      ...nativeSubIndexes.map((index) => controlledNativeWindow(index, { paneControls: true })),
      ...(researchConfig.windows ?? []),
    ],
    Frame: [
      { Height: 5.4, SplitCount: 5, StringFormat: 0, YCoordinateType: 2 },
      ...(volumeEnabled ? [{ Height: 1.3, SplitCount: 2, StringFormat: 1, YCoordinateType: 0 }] : []),
      ...nativeSubIndexes.map(() => ({ Height: 1.35, SplitCount: 3, StringFormat: 0, YCoordinateType: 0 })),
      ...(researchConfig.frames ?? []).map((frame) => ({ ...frame, YCoordinateType: 0 })),
    ],
    OverlayIndex: researchConfig.overlayIndex ?? [],
    Border: {
      Left: 4,
      Right: 58,
      Top: 28,
      Bottom: 24,
      AutoRight: { MinWidth: 58, Blank: 4 },
    },
    KLine: {
      Period: Number(preferences.period ?? 0),
      Right: 0,
      DragMode: 1,
      ZoomType: 1,
      PageSize: Math.max(1, Number(pageSize) || 1),
      // HQChart 会把 PageSize 限制到内置缩放档位；PageSizeV2 才能按
      // 当前 Lab 数据集的实际长度展示，与 Light 的 fitContent 保持一致。
      PageSizeV2: Math.max(1, Number(pageSize) || 1),
      MaxRequestDataCount: Math.max(1, Number(pageSize) || 1),
      RightSpaceCount: 8,
      // 数值统一由共享的 Light 图例表示；关闭 HQ 原始提示和高低点
      // 标记，避免重复口径、内置参数以及未经白名单的默认显示。
      IsShowTooltip: false,
      IsShowMaxMinPrice: false,
      EnablePrediction: false,
    },
    KLineTitle: {
      // OHLC 与 Lab 指标值统一由共享的 Light 图例显示，避免 HQ 内置
      // 参数标题与项目口径重复或互相冲突。
      IsShow: false,
      IsShowName: true,
      IsShowSettingInfo: false,
      IsShowDateTime: true,
      IsTitleShowLatestData: true,
    },
    CorssCursorInfo: {
      IsShowCorss: true,
      IsShowCorssPoint: true,
      EnableKeyboard: true,
      EnableDBClick: true,
      Right: 2,
      Bottom: 1,
    },
    EnableXDrag: { Bottom: true, LButton: { Type: 2 } },
    EnableYDrag: { Right: true },
    // 恢复旧版副图交互：分隔线拖动调整高度，双击副图放大/还原。
    // 主图不参与双击缩放，按钮仍由每个受控副图的 Window 配置决定。
    EnableBorderDrag: true,
    EnableZoomIndexWindow: true,
    IsAutoUpdate: false,
    EnableResize: false,
    // 恢复 HQ 用户熟悉的右键入口；创建菜单与执行命令都经过白名单，
    // 未审查指标、外部数据功能和不受支持的分钟周期不会重新暴露。
    IsShowRightMenu: true,
    EnablePopMenuV2: true,
    EnableDrawToolDialogV2: true,
    EnableModifyDrawDialogV2: true,
    NetworkFilter: networkFilter,
    EventCallback: callbacks,
    DrawTool: {
      StorageKey: hqDrawingStorageKey(drawingScope),
      EnableCrossPeriod: true,
    },
    TooltipDialog: { Enable: false, Style: 1 },
    // 区间统计只消费当前已加载 K 线；不调用外部指标或预测参数。
    SelectRectDialog: { Enable: true },
    ModifyIndexParamDialog: { Enable: false },
    SearchIndexDialog: { Enable: false },
    ScriptError: (data) => onWarning?.(readHqError(data)),
  }
}

export function repairHqRuntimeRegistry(ChartApi) {
  const registry = ChartApi?.IChartDrawPicture?.ArrayDrawPricture
  if (!Array.isArray(registry)) return false
  const shortPosition = registry.find((item) => item?.Name === 'TVShortPosition')
  if (!shortPosition || shortPosition.ClassName !== 'ChartDrawTVShortPositionn') return false
  shortPosition.ClassName = 'ChartDrawTVShortPosition'
  return true
}

function activeNativeSubIndexes(preferences = {}) {
  return [preferences.subIndex1, preferences.subIndex2].filter((index) => index && index !== 'EMPTY')
}

function controlledNativeWindow(index, { paneControls = false } = {}) {
  return {
    Index: index,
    Modify: false,
    Change: false,
    Close: false,
    Overlay: false,
    MaxMin: paneControls,
    TitleWindow: paneControls,
    AddIndexWindow: false,
    IndexHelp: false,
    IndexAIAnalyze: false,
    // 折叠成标题条后仍要知道自己收起的是哪个副图。
    IsShowIndexName: paneControls,
    IsShowOverlayIndexName: false,
    TitleHeight: paneControls ? 22 : 0,
  }
}

function readHqError(data) {
  if (data instanceof Error) return data.message
  if (typeof data === 'string' && data) return data
  return data?.Message ?? 'HQ 指标执行失败'
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw abortError()
}

function abortError() {
  return new DOMException('HQChart 初始化已取消', 'AbortError')
}

function applyHqTheme(ChartApi, dark) {
  const styleId = dark ? ChartApi.STYLE_TYPE_ID.BLACK_ID : ChartApi.STYLE_TYPE_ID.WHITE_ID
  const style = ChartApi.HQChartStyle.GetStyleConfig(styleId)
  ChartApi.JSChart.SetStyle(style)
  ChartApi.JSChart.SetCSSStyle(styleId)
}

export function emitCursor(data, period, indexByDate, onCursor) {
  if (typeof onCursor !== 'function') return
  const date = dateNumber(data?.Draw?.Date ?? data?.Date)
  if (indexByDate.has(date)) return onCursor(indexByDate.get(date))
  const index = Number(data?.DataIndex)
  if (period === 0 && Number.isInteger(index) && [...indexByDate.values()].includes(index)) return onCursor(index)
  onCursor(null)
}

function installCursorBoundary(element, chart, onCursor) {
  if (!element?.addEventListener) return () => {}
  const onEnter = () => chart?.EnableShowCorssCursorLine?.(true)
  const onLeave = () => {
    chart?.EnableShowCorssCursorLine?.(false)
    chart?.Draw?.()
    onCursor?.(null)
  }
  element.addEventListener('mouseenter', onEnter)
  element.addEventListener('mouseleave', onLeave)
  return () => {
    element.removeEventListener('mouseenter', onEnter)
    element.removeEventListener('mouseleave', onLeave)
  }
}

function hqDrawingStorageKey(scope) {
  const normalized = String(scope || 'global')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(0, 80)
  return `lab.hqchart.drawings.v1.${normalized || 'global'}`
}
