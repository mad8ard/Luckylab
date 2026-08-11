import { groupIndicators } from './mainChartLegendMeta.js'

/**
 * HQ 与 Light 共用同一套图例 shape 和格式化组件。
 * 这里仅把已查询好的 domain series 映射到当前 K 线，不重新计算指标。
 */
export function buildHqChartLegend({ rows = [], model = null, index = null } = {}) {
  const isCrosshair = Number.isInteger(index) && index >= 0 && index < rows.length
  const resolvedIndex = isCrosshair ? index : rows.length - 1
  const row = rows[resolvedIndex]
  if (!row) return null
  const previous = resolvedIndex > 0 ? rows[resolvedIndex - 1] : null
  const change = Number.isFinite(previous?.close) && Number.isFinite(row.close) ? row.close - previous.close : null
  const changePct = Number.isFinite(change) && previous?.close ? change / previous.close : null
  const direction = !Number.isFinite(change) ? 'flat' : change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
  const indicators = []

  for (const group of model?.groups ?? []) {
    for (const series of group?.series ?? []) {
      const value = seriesValueAt(series, row.date, resolvedIndex)
      if (!Number.isFinite(value)) continue
      indicators.push({
        key: series.id,
        title: series.label,
        color: series.color,
        unit: series.unit,
        group: group.id,
        value,
      })
    }
  }

  return {
    date: row.date,
    asOf: {
      kind: isCrosshair ? 'crosshair' : 'snapshot',
      label: isCrosshair ? '图表回看' : '观察日快照',
    },
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

function seriesValueAt(series, date, index) {
  if (Array.isArray(series?.values)) return series.values[index]
  const point = series?.points?.find((item) => String(item?.time ?? item?.date) === String(date))
  return point?.value
}
