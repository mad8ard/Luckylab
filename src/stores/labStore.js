import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { buildMarketStatePath } from '../domain/market-data/cost.js'
import lpOnchainSnapshots from '../data/lp-onchain-snapshots.json'
import { resolveLpOnchainSnapshot } from '../domain/market-data/lpOnchain.js'
import { marketSamples } from '../domain/market-data/ohlcv.js'
import { inferTdpy } from '../domain/market-data/tdpy.js'
import { buildResearchSnapshot } from '../domain/formula-research/researchSnapshot.js'
import { buildDecisionGraph } from '../domain/strategy-planning/orderPlan.js'
import { useDataLoader } from '../composables/useDataLoader.js'
import { useMarketState } from '../composables/useMarketState.js'
import { useReplay } from '../composables/useReplay.js'
import { usePlanning, buildExecutionBrief } from '../composables/usePlanning.js'
import { useChartOverlays } from '../composables/useChartOverlays.js'
import { persistedReactive } from '../composables/usePersisted.js'

/**
 * Lab 工作台 facade store
 *
 * 依赖图（线性，无循环）：
 *   planning.input
 *     → data (rows/cursor)
 *     → baseInput → marketState
 *     → optional replayResearch
 *     → effectiveInput → planningGraph + researchGraph → executionBrief
 *
 * 对外 API 面向三栏工作台；回放只保留空查询模型，不参与默认计划。
 */
export const useLabStore = defineStore('lab', () => {
  // 1. 输入与 UI 状态
  const planning = usePlanning()
  const { input } = planning

  // 2. 数据加载
  const data = useDataLoader(input)
  const { rows, cursor } = data
  const observationDates = persistedReactive('lab.observationDates.v1', {})
  const sourceKey = computed(() => data.source.value?.id ?? data.source.value?.symbol ?? data.source.value?.label ?? '')
  const observationDate = computed(() => (sourceKey.value ? (observationDates[sourceKey.value] ?? '') : ''))

  // 3. tdpy：按品种自动 + 用户覆盖
  const tdpyMeta = computed(() => inferTdpy(data.source.value))
  const effectiveTdpy = computed(() => {
    const sym = data.source.value?.symbol
    const override = sym ? planning.tdpyOverride[sym] : null
    return Number.isFinite(override) && override > 0 ? override : tdpyMeta.value.value
  })

  // 4. baseInput：合并 tdpy；默认 profile 只来自用户手动选择。
  const baseInput = computed(() => ({
    ...input,
    tradingDaysPerYear: effectiveTdpy.value,
    strategyProfile: input.strategyProfile,
  }))

  // 5. 市场态只吃事实输入；不被回放或研究层反向污染。
  const marketState = useMarketState(rows, cursor, baseInput)
  const activeMarketStates = computed(() => marketState.marketStateActive.value)

  // 6. ReplayAccount 是显式开启的旁路查询；只有 replayAutoProfile 打开才参与 profile 选择。
  const replayLayer = useReplay(marketState.activeRows, input, baseInput, activeMarketStates, planning.featureFlags)

  const effectiveInput = computed(() => ({
    ...baseInput.value,
    lpOnchainSnapshot: resolveLpOnchainSnapshot(data.source.value, lpOnchainSnapshots),
    strategyProfile:
      planning.featureFlags.replayAccount && planning.featureFlags.replayAutoProfile
        ? replayLayer.recommendedProfile.value.id
        : input.strategyProfile,
  }))

  // 7. 默认条件图 + 研究层快照并列组合。
  //    StrategyPlanning 不直接依赖研究层，facade 只为 UI 组装查询模型。
  const planningGraph = computed(() =>
    buildDecisionGraph({
      market: marketState.market.value,
      input: effectiveInput.value,
    }),
  )
  const researchGraph = computed(() => {
    if (!marketState.market.value || !planningGraph.value?.inputs) return null
    return buildResearchSnapshot({
      market: marketState.market.value,
      input: effectiveInput.value,
      executable: planningGraph.value,
    })
  })
  const graph = computed(() => ({
    ...planningGraph.value,
    ...(researchGraph.value ?? {}),
    research: researchGraph.value,
  }))

  const executionBrief = computed(() => buildExecutionBrief(graph.value))

  const sourceLabel = computed(() => data.source.value?.label ?? '未载入')

  // 加载新 rows 时按观察日期定位，不把观察日期之后的数据送入默认计划或回放。
  watch(rows, (next) => {
    if (!next.length) return
    const savedDate = observationDate.value
    const index = savedDate ? findDateIndex(next, savedDate) : next.length - 1
    setCursorIndex(index)
  })

  function syncInputFromCursor() {
    const currentRows = rows.value.slice(0, cursor.value + 1)
    if (!currentRows.length) return
    const tdpy = effectiveTdpy.value
    const market = buildMarketStatePath(currentRows, tdpy).at(-1)
    if (!market) return
    input.entryPrice = round(market.markPrice, 2)
    input.iv = round(market.annualVol, 4)
    input.strikePrice = round(market.markPrice * 1.05, 2)
    input.startPrice = round(market.costAnchor, 2)
    if (samePrice(input.perpTwap, market.markPrice) && samePrice(input.spotTwap, market.costAnchor)) {
      input.perpTwap = 0
      input.spotTwap = 0
    }
  }

  function setCursorIndex(index) {
    const currentRows = rows.value
    if (!currentRows.length) return
    const next = clampIndex(index, currentRows.length)
    cursor.value = next
    if (sourceKey.value) observationDates[sourceKey.value] = currentRows[next]?.date ?? ''
    syncInputFromCursor()
  }

  function setObservationDate(date) {
    if (!date) return useLatestObservation()
    if (sourceKey.value) observationDates[sourceKey.value] = date
    if (rows.value.length) setCursorIndex(findDateIndex(rows.value, date))
  }

  function useLatestObservation() {
    if (!rows.value.length) return
    setCursorIndex(rows.value.length - 1)
  }

  function useCursorCloseAsEntry() {
    const close = marketState.activeRows.value.at(-1)?.close
    if (Number.isFinite(close) && close > 0) input.entryPrice = round(close, 2)
  }

  function selectSample(sample) {
    input.tradingDaysPerYear = inferTdpy(sample).value
    return data.loadSample(sample)
  }

  // chartOverlays 在 store 顶层初始化一次（同一份在所有组件间共享）
  const chartOverlays = useChartOverlays()

  // ── Hover 视图状态（独立于 cursor，仅用于指标面板预览）──
  // cursor 是观察日期（计划锚点），hoverIndex 仅是鼠标当前所在的 bar，hover 不能改写计划。
  const hoverIndex = ref(null)
  function setHoverIndex(index) {
    if (index === null || index === undefined) {
      hoverIndex.value = null
      return
    }
    const n = Number(index)
    const len = rows.value.length
    if (!Number.isFinite(n) || len === 0) {
      hoverIndex.value = null
      return
    }
    hoverIndex.value = Math.max(0, Math.min(len - 1, Math.round(n)))
  }
  // 切换品种 → 清空 hoverIndex，避免脏索引
  watch(rows, () => {
    hoverIndex.value = null
  })

  const isHovering = computed(() => hoverIndex.value !== null)
  const hoverRow = computed(() => {
    const idx = hoverIndex.value
    if (idx === null) return null
    return marketState.activeRows.value[idx] ?? null
  })
  const hoverPrevRow = computed(() => {
    const idx = hoverIndex.value
    if (idx === null || idx <= 0) return null
    return marketState.activeRows.value[idx - 1] ?? null
  })
  const hoverDate = computed(() => hoverRow.value?.date ?? observationDate.value ?? '')
  const hoverMarket = computed(() => {
    const idx = hoverIndex.value
    if (idx === null) return marketState.market.value
    return marketState.marketStateActive.value[idx] ?? marketState.market.value
  })
  const hoverFormulaRow = computed(() => {
    const idx = hoverIndex.value
    if (idx === null) return marketState.formulaPath.value.at(-1) ?? null
    return marketState.formulaPath.value[idx] ?? marketState.formulaPath.value.at(-1) ?? null
  })

  return {
    // 数据层
    rows: data.rows,
    source: data.source,
    loading: data.loading,
    loadingSampleId: data.loadingSampleId,
    error: data.error,
    cursor: data.cursor,
    observationDate,
    observationDates,
    setCursorIndex,
    setObservationDate,
    useLatestObservation,
    loadSample: data.loadSample,
    selectSample,
    retryLast: data.retryLast,
    dismissError: data.dismissError,
    importText: data.importText,
    sourceLabel,
    marketSamples,

    // tdpy 层（PR-1）
    tdpyMeta,
    effectiveTdpy,
    setTdpyOverride: planning.setTdpyOverride,
    clearTdpyOverride: planning.clearTdpyOverride,
    tdpyOverride: planning.tdpyOverride,

    // 市场态层
    activeRows: marketState.activeRows,
    market: marketState.market,
    costPath: marketState.costPath,
    formulaPath: marketState.formulaPath,

    // 决策层
    input: planning.input,
    featureFlags: planning.featureFlags,
    baseInput,
    effectiveInput,
    graph,
    executionBrief,
    activeFormula: planning.activeFormula,
    activeFormulaId: planning.activeFormulaId,
    activeCapability: planning.activeCapability,
    activeCapabilityId: planning.activeCapabilityId,
    activeCapabilityStages: planning.activeCapabilityStages,
    formulaCapabilities: planning.formulaCapabilities,
    strategyProfileList: planning.strategyProfileList,
    selectCapability: planning.selectCapability,

    // 三栏面板态 + 主图叠加（v3.1）+ 面板宽度（v3.2）
    leftPanelOpen: planning.leftPanelOpen,
    rightPanelOpen: planning.rightPanelOpen,
    activeLeftTab: planning.activeLeftTab,
    toggleLeftPanel: planning.toggleLeftPanel,
    toggleRightPanel: planning.toggleRightPanel,
    leftPanelW: planning.leftPanelW,
    rightPanelW: planning.rightPanelW,
    setLeftPanelW: planning.setLeftPanelW,
    setRightPanelW: planning.setRightPanelW,
    resetLeftPanelW: planning.resetLeftPanelW,
    resetRightPanelW: planning.resetRightPanelW,
    chartOverlays,

    // 回放层：显式开关默认关闭；关闭时返回空模型。
    profileReplays: replayLayer.profileReplays,
    recommendedProfile: replayLayer.recommendedProfile,
    replay: replayLayer.replay,

    // 杂项
    useCursorCloseAsEntry,

    // Hover 视图状态（仅指标面板使用，不影响 cursor / 计划锚点）
    hoverIndex,
    setHoverIndex,
    isHovering,
    hoverRow,
    hoverPrevRow,
    hoverDate,
    hoverMarket,
    hoverFormulaRow,
  }
})

function round(value, digits) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0
}

function samePrice(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - round(right, 2)) < 0.005
}

function clampIndex(index, length) {
  const n = Number(index)
  if (!Number.isFinite(n)) return Math.max(0, length - 1)
  return Math.max(0, Math.min(length - 1, Math.round(n)))
}

function findDateIndex(rows, date) {
  const exact = rows.findIndex((row) => row.date === date)
  if (exact >= 0) return exact
  const next = rows.findIndex((row) => row.date > date)
  return next <= 0 ? 0 : next - 1
}
