// MainChart 主题与轻量工具：与 lightweight-charts 强绑定但无 Vue 依赖。
// 放在 composables/ 而非 domain/，因为 import 了 lightweight-charts。

import { ColorType } from 'lightweight-charts'

// 主题（亮/暗）相关的 chart 选项工厂；chartOptions 与 syncChart 共用，
// 避免硬编码重复。
export function themeOptions(dark) {
  return {
    layout: {
      background: { type: ColorType.Solid, color: dark ? '#22241f' : '#fbfaf4' },
      textColor: dark ? '#96958b' : '#57554d',
    },
    grid: {
      vertLines: { color: dark ? 'rgba(61,60,52,0.45)' : 'rgba(215,209,194,0.45)' },
      horzLines: { color: dark ? 'rgba(61,60,52,0.72)' : 'rgba(215,209,194,0.72)' },
    },
    rightPriceScale: { borderColor: dark ? '#3d3c34' : '#d7d1c2' },
    timeScale: { borderColor: dark ? '#3d3c34' : '#d7d1c2' },
  }
}

// 主图初始化时使用的完整 chart options。
export function buildChartOptions({ dark, width, height }) {
  const theme = themeOptions(dark)
  return {
    autoSize: false,
    layout: {
      ...theme.layout,
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    grid: theme.grid,
    crosshair: { mode: 1 }, // CrosshairMode.Normal
    width,
    height,
    rightPriceScale: { ...theme.rightPriceScale, scaleMargins: { top: 0.08, bottom: 0.12 } },
    timeScale: { ...theme.timeScale, rightOffset: 8, barSpacing: 7 },
  }
}

// 价格相对成本带的着色：盈利绿 / 亏损红 / 中性绿。
export function regimeColor(close, cost) {
  if (!Number.isFinite(close) || !Number.isFinite(cost?.upper) || !Number.isFinite(cost?.lower)) return null
  if (close > cost.upper) return 'rgba(169,50,38,0.45)'
  if (close < cost.lower) return 'rgba(39,79,159,0.45)'
  return 'rgba(14,117,88,0.35)'
}

export function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null
}
