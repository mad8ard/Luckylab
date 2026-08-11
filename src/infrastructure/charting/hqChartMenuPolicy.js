import { HQ_KLINE_STYLES, HQ_PERIODS } from './hqChartCatalog.js'

const NATIVE_INDICATOR_COMMAND_NAMES = Object.freeze([
  'CMD_CHANGE_INDEX_ID',
  'CMD_SHOW_CHANGE_INDEX_DIALOG_ID',
  'CMD_DELETE_INDEX_ID',
  'CMD_CHANGE_API_INDEX_ID',
  'CMD_CHANGE_SCRIPT_INDEX_ID',
  'CMD_CHANGE_COLOR_INDEX_ID',
  'CMD_CHANGE_TRADE_INDEX_ID',
  'CMD_DELETE_COLOR_INDEX_ID',
  'CMD_DELETE_TRADE_INDEX_ID',
  'CMD_SHOW_INDEX_ID',
  'CMD_SHOW_OVERLAY_INDEX_ID',
  'CMD_DELETE_OVERLAY_INDEX_ID',
  'CMD_ADD_OVERLAY_INDEX_ID',
  'CMD_MODIFY_INDEX_PARAM',
  'CMD_MODIFY_OVERLAY_INDEX_PARAM',
])

const EXTERNAL_DATA_COMMAND_NAMES = Object.freeze([
  'CMD_OVERLAY_SYMBOL_ID',
  'CMD_DELETE_ALL_OVERLAY_SYMBOL_ID',
  'CMD_CHANGE_KLINE_INFO_ID',
  'CMD_DELETE_ALL_KLINE_INFO_ID',
  'CMD_SHOW_STOCKCHIP_ID',
  'CMD_HIDE_STOCKCHIP_ID',
  'CMD_CHIP_CHART_SETTING_ID',
])

const MINUTE_COMMAND_NAMES = Object.freeze([
  'CMD_CHANGE_MINUTE_INFO_ID',
  'CMD_DELETE_ALL_MINUTE_INFO_ID',
  'CMD_MODIFY_MINUTE_INFO_PROPERTY_ID',
  'CMD_ENABLE_POP_MINUTE_CHART_ID',
  'CMD_SHOW_CALLCATION_ID',
  'CMD_CHANGE_DAY_COUNT_ID',
  'CMD_SHOW_BUYSELL_BAR_ID',
])

const allowedPeriods = new Set(HQ_PERIODS.map((item) => item.id))
const allowedKLineStyles = new Set(HQ_KLINE_STYLES.map((item) => item.id))

const COMMAND_MATCHERS = Object.freeze({
  CMD_CHANGE_PERIOD_ID: matchesPeriod,
  CMD_CHANGE_KLINE_TYPE_ID: matchesKLineStyle,
  CMD_SHOW_DRAWTOOL_ID: matchesEmptyArgs,
  CMD_SELECTED_ZOOM_ID: matchesSelectedZoom,
  CMD_SELECTED_SUMMARY_ID: matchesSelectedSummary,
  CMD_FULLSCREEN_SUMMARY_ID: matchesOptionalNoArgs,
  CMD_CHANGE_DEFAULTCURSOR_ID: (args) => matchesOneOf(args, ['default', 'crosshair']),
  CMD_CHANGE_DRAG_RECT_SHOW_MODE_ID: (args) => matchesOneOf(args, [0, 1, 2]),
  CMD_SHOW_CORSS_LINE_ID: matchesBoolean,
  CMD_LOCK_CROSSCURSOR: matchesLockCrossCursor,
  CMD_UNLOCK_CROSSCURSOR: matchesOptionalNoArgs,
  CMD_CORSS_ON_VAILD_TIME_ID: matchesBoolean,
  CMD_CORSS_ON_KLINE_ID: matchesBoolean,
  CMD_CORSS_POINT_ID: matchesBoolean,
  CMD_RBUTTON_SELECT_RECT_ID: matchesBoolean,
  CMD_LBUTTON_SELECT_RECT_ID: matchesBoolean,
  CMD_CORSS_DBCLICK_ID: matchesBoolean,
  CMD_CORSS_SHOW_INCREASE_ID: matchesBoolean,
  CMD_CORSS_X_TEXTALIGN_ID: (args) => matchesOneOf(args, [0, 1]),
  CMD_SHOW_MAXMIN_ID: matchesBoolean,
})

export function filterHqRightMenuByPolicy(data, menuIds = {}, chart) {
  const menu = data?.MenuData?.Menu
  if (!Array.isArray(menu)) return
  filterMenuTree(menu, menuIds, chart)
}

export function guardHqRightMenuCommand(data, menuIds = {}, onWarning, chart) {
  if (!data || typeof data !== 'object') return
  const commandId = data.CommandID
  if (isAllowedHqRightMenuCommand(commandId, data.Args, menuIds, chart)) return

  data.PreventDefault = true
  if (commandId === menuIds.CMD_CHANGE_PERIOD_ID) {
    onWarning?.('当前静态数据源只有日 K；分钟周期已禁用，自定义周期也已禁用，未伪造分钟行情。')
  } else if (commandId === menuIds.CMD_CHANGE_KLINE_TYPE_ID) {
    onWarning?.('该衍生 K 线样式未与 Light 对齐，已保留原始 OHLC 可验证样式。')
  } else if (idsForNames(menuIds, NATIVE_INDICATOR_COMMAND_NAMES).has(commandId)) {
    onWarning?.('HQ 原生指标入口已禁用；图上只使用与 Light 同口径的受控指标。')
  } else if (idsForNames(menuIds, MINUTE_COMMAND_NAMES).has(commandId)) {
    onWarning?.('该分钟功能需要未接入的分钟数据，已按本地研究边界禁用。')
  } else if (idsForNames(menuIds, EXTERNAL_DATA_COMMAND_NAMES).has(commandId)) {
    onWarning?.('该功能依赖未接入的外部数据，已按本地研究边界禁用。')
  } else {
    onWarning?.('该 HQ 右键功能未进入安全白名单，已避免改变研究口径。')
  }
}

export function isAllowedHqRightMenuCommand(commandId, args, menuIds = {}, chart) {
  if (!Number.isInteger(commandId)) return false
  for (const [name, matches] of Object.entries(COMMAND_MATCHERS)) {
    if (menuIds?.[name] === commandId) return matches(args, chart)
  }
  return false
}

function filterMenuTree(items, menuIds, chart) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (Array.isArray(item?.SubMenu)) filterMenuTree(item.SubMenu, menuIds, chart)
    const hasChildren = item?.SubMenu?.length > 0
    const hasAllowedCommand = item?.Data && isAllowedHqRightMenuCommand(item.Data.ID, item.Data.Args, menuIds, chart)
    if (!hasChildren && !hasAllowedCommand) items.splice(index, 1)
  }
}

function matchesPeriod(args) {
  return Array.isArray(args) && args.length === 1 && allowedPeriods.has(args[0])
}

function matchesKLineStyle(args) {
  if (!Array.isArray(args) || !allowedKLineStyles.has(args[0])) return false
  if (args[0] !== 2) return args.length === 1
  return (
    args.length === 3 && args[1] === true && hasExactKeys(args[2], ['IsThinAKBar']) && args[2].IsThinAKBar === false
  )
}

function matchesEmptyArgs(args) {
  return Array.isArray(args) && args.length === 0
}

function matchesOptionalNoArgs(args) {
  return args === undefined || args === null || (Array.isArray(args) && args.length === 0)
}

function matchesBoolean(args) {
  return Array.isArray(args) && args.length === 1 && typeof args[0] === 'boolean'
}

function matchesOneOf(args, values) {
  return Array.isArray(args) && args.length === 1 && values.includes(args[0])
}

function matchesSelectedZoom(args, chart) {
  return Array.isArray(args) && args.length === 1 && matchesSelectData(args[0], chart)
}

function matchesSelectedSummary(args, chart) {
  if (!Array.isArray(args) || args.length !== 2 || !matchesSelectData(args[1], chart)) return false
  return isObject(args[0]) && args[0]?.data?.SelectData === args[1]
}

function matchesSelectData(value, chart) {
  if (!isObject(value) || !Number.isInteger(value.Start) || !Number.isInteger(value.End)) return false
  const data = value.Data
  if (!isObject(data) || !Array.isArray(data.Data)) return false
  if (value.Start < 0 || value.End < value.Start || value.End >= data.Data.length) return false
  const chartData = chart?.GetKData?.()
  return chartData === undefined || chartData === data
}

function matchesLockCrossCursor(args, chart) {
  if (!Array.isArray(args) || args.length !== 1) return false
  const option = args[0]
  if (!hasExactKeys(option, ['KItem', 'Draw']) || option.Draw !== true) return false
  if (!hasExactKeys(option.KItem, ['Date', 'Time'])) return false
  const { Date: date, Time: time } = option.KItem
  if (!Number.isFinite(date) || !(time == null || Number.isFinite(time))) return false
  const data = chart?.GetKData?.()?.Data
  if (!Array.isArray(data)) return true
  return data.some((item) => item?.Date === date && (time == null || item?.Time === time))
}

function hasExactKeys(value, keys) {
  if (!isObject(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function idsForNames(menuIds, names) {
  return new Set(names.map((name) => menuIds?.[name]).filter(Number.isInteger))
}
