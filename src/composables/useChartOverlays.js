import { persistedReactive } from './usePersisted.js'

/**
 * 主图叠加项开关，持久化到 localStorage
 *
 * 设计：
 *   - 默认优先保护 K 线阅读面积，显示成本带 / 入场 / 波动 / 量 / 当前点
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
  volume: true,
  stockChipProfile: true,
  replayMarkers: true,
  replayMarkerLabels: false,
  currentDecision: true,
  deltaPane: false,
  equityPane: false,
  kdjPane: true,
  rsiPane: true,
}

const STORAGE_KEY = 'lab.chartOverlays.v9'
const LEGACY_KEYS = ['lab.chartOverlays.v6', 'lab.chartOverlays.v7', 'lab.chartOverlays.v8']

export function useChartOverlays() {
  migrateChartOverlayState()
  return persistedReactive(STORAGE_KEY, DEFAULTS)
}

export const CHART_OVERLAY_DEFAULTS = DEFAULTS

function migrateChartOverlayState() {
  if (typeof window === 'undefined' || !window.localStorage) return
  if (window.localStorage.getItem(STORAGE_KEY)) return
  const legacy = LEGACY_KEYS
    .map((key) => safeRead(key))
    .find((value) => value && typeof value === 'object')
  if (!legacy) return
  const next = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    if (key in legacy) next[key] = legacy[key]
  }
  if (!('kdjPane' in legacy)) next.kdjPane = true
  if (!('rsiPane' in legacy)) next.rsiPane = true
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

function safeRead(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key))
  } catch {
    return null
  }
}
