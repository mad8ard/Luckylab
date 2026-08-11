import { persistedReactive } from './usePersisted.js'

/**
 * 主图叠加项开关，持久化到 localStorage
 *
 * 设计：
 *   - 默认保留旧版常用的成交量与量价筹码，同时显示成本带 / 入场 / 波动 / 当前点
 *   - replay 默认显示轻量买卖位置，但文字标签、指标子图需要显式打开
 *   - persistedReactive 已内置字段级合并，旧 storage 缺字段自动回退默认
 */
const DEFAULTS = {
  priceBands: true,
  greeksPane: false,
  lpPane: false,
  carryPane: false,
  executionMarkers: true,
  researchMarkers: true,
  costBand: true,
  entryLine: true,
  volBand: true,
  lpBand: true,
  volume: true,
  replayMarkers: true,
  replayMarkerLabels: false,
  currentDecision: true,
  equityPane: false,
  kdjPane: false,
  rsiPane: false,
  stockChipProfile: true,
}

const STORAGE_KEY = 'lab.chartOverlays.v13'
const LEGACY_KEYS = [
  'lab.chartOverlays.v12',
  'lab.chartOverlays.v11',
  'lab.chartOverlays.v10',
  'lab.chartOverlays.v9',
  'lab.chartOverlays.v8',
  'lab.chartOverlays.v7',
  'lab.chartOverlays.v6',
]

export function useChartOverlays() {
  migrateChartOverlayState()
  return persistedReactive(STORAGE_KEY, DEFAULTS)
}

export const CHART_OVERLAY_DEFAULTS = DEFAULTS

function migrateChartOverlayState() {
  if (typeof window === 'undefined' || !window.localStorage) return
  if (window.localStorage.getItem(STORAGE_KEY)) return
  const legacyEntry = LEGACY_KEYS.map((key) => ({ key, value: safeRead(key) })).find(
    (entry) => entry.value && typeof entry.value === 'object',
  )
  if (!legacyEntry) return
  const legacy = legacyEntry.value
  const next = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    if (key in legacy) next[key] = legacy[key]
  }
  // 副图保持显式开启；主图 LP 研究区间按产品契约恢复为默认可见。
  next.kdjPane = false
  next.rsiPane = false
  next.lpBand = true
  // v11 曾把筹码层无条件关闭，无法区分用户选择和迁移副作用；升级时
  // 一次性恢复旧版默认。之后 v13 会正常保留用户自己的开关状态。
  if (legacyEntry.key === 'lab.chartOverlays.v11') next.stockChipProfile = true
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

function safeRead(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key))
  } catch {
    return null
  }
}
