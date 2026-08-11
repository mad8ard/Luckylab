import { describe, expect, it, vi } from 'vitest'
import {
  filterHqRightMenuByPolicy,
  guardHqRightMenuCommand,
  isAllowedHqRightMenuCommand,
} from '../hqChartMenuPolicy.js'

const menuIds = {
  CMD_CHANGE_PERIOD_ID: 1,
  CMD_CHANGE_WINDOW_COUNT_ID: 2,
  CMD_CHANGE_RIGHT_ID: 3,
  CMD_CHANGE_INDEX_ID: 4,
  CMD_CHANGE_COLOR_INDEX_ID: 5,
  CMD_CHANGE_TRADE_INDEX_ID: 6,
  CMD_DELETE_COLOR_INDEX_ID: 7,
  CMD_DELETE_TRADE_INDEX_ID: 8,
  CMD_CHANGE_KLINE_TYPE_ID: 9,
  CMD_OVERLAY_SYMBOL_ID: 11,
  CMD_DELETE_ALL_OVERLAY_SYMBOL_ID: 12,
  CMD_CHANGE_COORDINATETYPE_ID: 13,
  CMD_CHANGE_KLINE_INFO_ID: 14,
  CMD_DELETE_ALL_KLINE_INFO_ID: 15,
  CMD_SHOW_DRAWTOOL_ID: 18,
  CMD_HIDE_DRAWTOOL_ID: 19,
  CMD_SHOW_STOCKCHIP_ID: 20,
  CMD_HIDE_STOCKCHIP_ID: 21,
  CMD_SELECTED_ZOOM_ID: 25,
  CMD_SELECTED_SUMMARY_ID: 26,
  CMD_SHOW_INDEX_ID: 27,
  CMD_SHOW_OVERLAY_INDEX_ID: 28,
  CMD_DELETE_OVERLAY_INDEX_ID: 29,
  CMD_CHANGE_DEFAULTCURSOR_ID: 32,
  CMD_ADD_OVERLAY_INDEX_ID: 33,
  CMD_MODIFY_INDEX_PARAM: 34,
  CMD_MODIFY_OVERLAY_INDEX_PARAM: 36,
  CMD_CHANGE_DRAG_RECT_SHOW_MODE_ID: 38,
  CMD_SHOW_CORSS_LINE_ID: 39,
  CMD_ENABLE_POP_MINUTE_CHART_ID: 40,
  CMD_CHIP_CHART_SETTING_ID: 42,
  CMD_DIALOG_TOOLTIP_ATTRIBUTE: 43,
  CMD_KLINE_TOOLTIP_ATTRIBUTE: 44,
  CMD_CHANGE_API_INDEX_ID: 45,
  CMD_CHANGE_SCRIPT_INDEX_ID: 46,
  CMD_LOCK_CROSSCURSOR: 47,
  CMD_UNLOCK_CROSSCURSOR: 48,
  CMD_CORSS_ON_VAILD_TIME_ID: 50,
  CMD_CORSS_ON_KLINE_ID: 51,
  CMD_CORSS_POINT_ID: 52,
  CMD_RBUTTON_SELECT_RECT_ID: 53,
  CMD_LBUTTON_SELECT_RECT_ID: 54,
  CMD_FULLSCREEN_SUMMARY_ID: 56,
  CMD_CORSS_DBCLICK_ID: 57,
  CMD_CORSS_SHOW_INCREASE_ID: 60,
  CMD_CORSS_X_TEXTALIGN_ID: 61,
  CMD_SHOW_MAXMIN_ID: 66,
  CMD_CHANGE_MINUTE_INFO_ID: 67,
  CMD_DELETE_ALL_MINUTE_INFO_ID: 68,
  CMD_MODIFY_MINUTE_INFO_PROPERTY_ID: 69,
  CMD_SHOW_CHANGE_INDEX_DIALOG_ID: 70,
  CMD_SELECTED_DATA_ANALYZE_ID: 71,
}

const kData = { Data: Array.from({ length: 8 }, (_, index) => ({ Date: 20260801 + index, Time: 0 })) }
const chart = { GetKData: () => kData }
const selectData = { Start: 1, End: 5, Data: kData }
const selectEvent = { type: 'mouseup', data: { SelectData: selectData } }
const lockArgs = [{ KItem: { Date: 20260803, Time: 0 }, Draw: true }]

describe('HQChart right-menu policy', () => {
  it('从默认菜单只留下完整允许周期、5 种受控 K 线和本地交互', () => {
    const data = {
      MenuData: {
        Menu: [
          {
            Name: '分析周期',
            SubMenu: [0, 1, 21, 2, 9, 22, 3, 4, 5, 10, 11, 12, 20003].map((period) => ({
              Name: String(period),
              Data: { ID: 1, Args: [period] },
            })),
          },
          {
            Name: '主图线型',
            SubMenu: [
              ...[0, 3, 1].map((style) => ({ Name: String(style), Data: { ID: 9, Args: [style] } })),
              { Name: '美国线', Data: { ID: 9, Args: [2, true, { IsThinAKBar: false }] } },
              { Name: '美国线细', Data: { ID: 9, Args: [2, true, { IsThinAKBar: true }] } },
              { Name: '面积', Data: { ID: 9, Args: [4] } },
              ...[6, 11, 12, 13, 15, 19, 20].map((style) => ({
                Name: String(style),
                Data: { ID: 9, Args: [style] },
              })),
            ],
          },
          {
            Name: '光标与画图',
            SubMenu: [
              { Name: '画图工具', Data: { ID: 18, Args: [] } },
              { Name: '十字光标', Data: { ID: 39, Args: [true] } },
              { Name: '锁定', Data: { ID: 47, Args: lockArgs } },
              { Name: '解锁', Data: { ID: 48 } },
              { Name: '坐标变换', Data: { ID: 13, Args: [{ Type: 2 }] } },
              { Name: '分隔线' },
            ],
          },
          {
            Name: '区间',
            SubMenu: [
              { Name: '区间放大', Data: { ID: 25, Args: [selectData] } },
              { Name: '区间统计', Data: { ID: 26, Args: [selectEvent, selectData] } },
              { Name: '区间分析', Data: { ID: 71, Args: [selectData] } },
            ],
          },
          {
            Name: '未审查能力',
            SubMenu: [
              { Name: 'BOLL', Data: { ID: 4, Args: [0, 'BOLL'] } },
              { Name: '五彩K', Data: { ID: 5, Args: ['五彩K线-十字星'] } },
              { Name: '叠加品种', Data: { ID: 11, Args: ['000300.sh'] } },
              { Name: '分钟图', Data: { ID: 40, Args: [true] } },
              { Name: '未知', Data: { ID: 999, Args: [] } },
            ],
          },
        ],
      },
    }

    filterHqRightMenuByPolicy(data, menuIds, chart)

    expect(data.MenuData.Menu.map((item) => item.Name)).toEqual(['分析周期', '主图线型', '光标与画图', '区间'])
    expect(data.MenuData.Menu[0].SubMenu.map((item) => item.Data.Args[0])).toEqual([0, 1, 21, 2, 9, 22, 3])
    expect(data.MenuData.Menu[1].SubMenu.map((item) => item.Data.Args[0])).toEqual([0, 3, 1, 2, 4])
    expect(data.MenuData.Menu[2].SubMenu.map((item) => item.Data.ID)).toEqual([18, 39, 47, 48])
    expect(data.MenuData.Menu[3].SubMenu.map((item) => item.Data.ID)).toEqual([25, 26])
  })

  it.each([
    ...[0, 1, 21, 2, 9, 22, 3].map((period) => [`周期 ${period}`, 1, [period]]),
    ['实心 K', 9, [0]],
    ['空心阳 K', 9, [3]],
    ['收盘线', 9, [1]],
    ['美国线', 9, [2, true, { IsThinAKBar: false }]],
    ['面积图', 9, [4]],
    ['画图工具', 18, []],
    ['区间放大', 25, [selectData]],
    ['区间统计', 26, [selectEvent, selectData]],
    ['全屏区间统计', 56, null],
    ['默认光标', 32, ['default']],
    ['区间样式', 38, [2]],
    ['十字光标', 39, [true]],
    ['锁定十字光标', 47, lockArgs],
    ['解锁十字光标', 48, undefined],
    ['有效 X 轴', 50, [false]],
    ['贴 K 线', 51, [true]],
    ['十字圆点', 52, [true]],
    ['右键区间选择', 53, [false]],
    ['左键区间选择', 54, [true]],
    ['双击十字线', 57, [true]],
    ['至今涨幅', 60, [false]],
    ['X 文字对齐', 61, [1]],
    ['高低点', 66, [true]],
  ])('允许严格参数命令：%s', (_, commandId, args) => {
    expect(isAllowedHqRightMenuCommand(commandId, args, menuIds, chart)).toBe(true)
    const command = { CommandID: commandId, Args: args, PreventDefault: false }
    const onWarning = vi.fn()
    guardHqRightMenuCommand(command, menuIds, onWarning, chart)
    expect(command.PreventDefault).toBe(false)
    expect(onWarning).not.toHaveBeenCalled()
  })

  it.each([
    ['分钟周期', { CommandID: 1, Args: [4] }, '分钟'],
    ['宽松数字周期', { CommandID: 1, Args: ['0'] }, '分钟'],
    ['多余周期参数', { CommandID: 1, Args: [0, true] }, '分钟'],
    ['未来派生 K', { CommandID: 9, Args: [11] }, 'K 线样式'],
    ['美国细线', { CommandID: 9, Args: [2, true, { IsThinAKBar: true }] }, 'K 线样式'],
    ['原生指标', { CommandID: 4, Args: [0, 'BOLL'] }, 'HQ 原生指标'],
    ['外部品种', { CommandID: 11, Args: ['000300.sh'] }, '外部数据'],
    ['分钟弹窗', { CommandID: 40, Args: [true] }, '分钟功能'],
    ['坐标变换', { CommandID: 13, Args: [{ Type: 2 }] }, '安全白名单'],
    ['画图多余参数', { CommandID: 18, Args: [true] }, '安全白名单'],
    ['过期选区', { CommandID: 25, Args: [{ ...selectData, Data: { Data: kData.Data } }] }, '安全白名单'],
    ['伪造统计事件', { CommandID: 26, Args: [{ data: {} }, selectData] }, '安全白名单'],
    ['字符串命令 ID', { CommandID: '18', Args: [] }, '安全白名单'],
    ['未知命令', { CommandID: 999, Args: [] }, '安全白名单'],
  ])('执行时拒绝：%s', (_, command, warning) => {
    const onWarning = vi.fn()
    guardHqRightMenuCommand(command, menuIds, onWarning, chart)
    expect(command.PreventDefault).toBe(true)
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining(warning))
  })
})
