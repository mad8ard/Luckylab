// MainChart hover legend：把 crosshair 事件 + 当前 series/seriesMeta + props
// 翻译成一个可渲染的 legend 对象。MainChart.vue 通过 watch refs 拿数据。

import { ref } from 'vue'
import { fallbackValue, groupIndicators } from '../components/mainChartLegendMeta.js'

export function useMainChartLegend({ getRows, getSeries, getSeriesMeta, getProps }) {
  const hoverIndex = ref(null)
  const hoverLegend = ref(null)

  function handleCrosshair(param) {
    if (!param?.time) {
      hoverIndex.value = null
      hoverLegend.value = null
      return null
    }
    const rows = getRows()
    const idx = rows.findIndex((r) => r.date === param.time)
    hoverIndex.value = idx >= 0 ? idx : null
    hoverLegend.value =
      idx >= 0
        ? buildLegend(idx, param, { rows, series: getSeries(), seriesMeta: getSeriesMeta(), props: getProps() })
        : null
    return hoverIndex.value
  }

  return { hoverIndex, hoverLegend, handleCrosshair }
}

function buildLegend(idx, param, { rows, series, seriesMeta, props }) {
  const row = rows[idx]
  if (!row) return null
  const prev = idx > 0 ? rows[idx - 1] : null
  const change = Number.isFinite(prev?.close) && Number.isFinite(row.close) ? row.close - prev.close : null
  const changePct = Number.isFinite(change) && prev?.close ? change / prev.close : null
  const direction = !Number.isFinite(change) ? 'flat' : change > 0 ? 'up' : change < 0 ? 'down' : 'flat'

  const indicators = []
  // 优先取 lightweight-charts 提供的 seriesData（hover 那一刻的真实绘制点）
  for (const [key, meta] of Object.entries(seriesMeta)) {
    const s = series[key]
    if (!s) continue
    let value = null
    if (param?.seriesData) {
      const d = param.seriesData.get(s)
      if (d) value = typeof d.value === 'number' ? d.value : typeof d.close === 'number' ? d.close : null
    }
    // 兜底：从 props 数组按 idx 取
    if (value === null) value = fallbackValue(key, idx, props)
    if (!Number.isFinite(value)) continue
    indicators.push({ key, ...meta, value })
  }

  return {
    date: row.date,
    ohlcv: {
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      change,
      changePct,
      direction,
    },
    indicators: groupIndicators(indicators),
  }
}
