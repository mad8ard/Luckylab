import { computed } from 'vue'
import {
  formulaCapabilities,
  getCapabilityStages,
  getFormulaCapability,
  getFormulaStage,
} from '../domain/formulas/registry.js'
import { strategyProfileList } from '../domain/strategy-planning/orderPlan.js'
import { persistedReactive, persistedRef } from './usePersisted.js'

/**
 * 输入参数 + UI 选中态层
 *
 * input 保持默认事实工作台语义；三栏、拖宽、公式选中态属于 ViewModel UI 状态。
 */
export function usePlanning() {
  const input = persistedReactive('lab.input.v5', {
    entryPrice: 0,
    holdingDays: 30,
    iv: 0,
    deltaSlope: 0.3,
    exitTargetReturn: 0,
    targetReturn: 0.3,
    capital: 0,
    baseNotional: 0,
    accountStartDate: '',
    strategyProfile: 'balanced',
    strategyEdgeSigma: 1.0,
    strategyMomentumSigma: 0.25,
    strategyCostSlopeSigma: 0.6,
    strategyRiskPct: 0.01,
    strategyExposurePct: 0.25,
    strategyFirstWeight: 0.35,
    strategyCooldownFactor: 2.0,
    strategyCutLossSigma: 1.2,
    strikePrice: 0,
    riskFreeRate: 0.04,
    optionType: 'put',
    optionStrategy: 'single',
    optionSide: 'long',
    optionQuantity: 1,
    optionMultiplier: 1,
    optionPremium: 0,
    optionWidthPct: 0.05,
    strikePrice2: 0,
    startPrice: 0,
    rangeWidth: 0.1,
    skew: 1,
    liquidity: 1,
    hedgeSize: 0,
    fees: 0,
    perpTwap: 0,
    spotTwap: 0,
    pathUsesScenarioInputs: false,
    tradingDaysPerYear: 365,
  })

  const featureFlags = persistedReactive('lab.featureFlags.v1', {
    replayAccount: false,
    replayAutoProfile: false,
    portfolioResearch: false,
  })

  // 按 symbol 存 tdpy 覆盖值
  const tdpyOverride = persistedReactive('lab.tdpyOverride.v1', {})

  function setTdpyOverride(symbol, value) {
    if (!symbol) return
    if (value === null || !Number.isFinite(value) || value <= 0) {
      delete tdpyOverride[symbol]
      return
    }
    tdpyOverride[symbol] = value
  }

  function clearTdpyOverride(symbol) {
    if (symbol) delete tdpyOverride[symbol]
  }

  const activeFormulaId = persistedRef('lab.activeFormulaId.v1', 'delta-band')
  const activeCapabilityId = persistedRef('lab.activeCapabilityId.v1', 'move-derivative')
  const activeCapability = computed(() => getFormulaCapability(activeCapabilityId.value))
  const activeCapabilityStages = computed(() => getCapabilityStages(activeCapabilityId.value))
  const activeFormula = computed(() => getFormulaStage(activeFormulaId.value))

  function selectCapability(id) {
    activeCapabilityId.value = id
    activeFormulaId.value = getCapabilityStages(id)[0]?.id ?? activeFormulaId.value
  }

  // 三栏面板状态：左/右面板开闭 + 左面板当前 tab
  const leftPanelOpen = persistedRef('lab.leftPanelOpen.v1', true)
  const rightPanelOpen = persistedRef('lab.rightPanelOpen.v1', true)
  const activeLeftTab = persistedRef('lab.activeLeftTab.v1', 'decision')

  function toggleLeftPanel() { leftPanelOpen.value = !leftPanelOpen.value }
  function toggleRightPanel() { rightPanelOpen.value = !rightPanelOpen.value }

  // 面板宽度（v3.2 拖宽）
  const LEFT_MIN  = 200, LEFT_MAX  = 400
  const RIGHT_MIN = 200, RIGHT_MAX = 380
  const LEFT_DEFAULT  = 280
  const RIGHT_DEFAULT = 240

  const leftPanelW  = persistedRef('lab.leftPanelW.v1', LEFT_DEFAULT)
  const rightPanelW = persistedRef('lab.rightPanelW.v1', RIGHT_DEFAULT)

  function setLeftPanelW(w) {
    leftPanelW.value = clamp(w, LEFT_MIN, LEFT_MAX)
  }
  function setRightPanelW(w) {
    rightPanelW.value = clamp(w, RIGHT_MIN, RIGHT_MAX)
  }
  function resetLeftPanelW()  { leftPanelW.value  = LEFT_DEFAULT }
  function resetRightPanelW() { rightPanelW.value = RIGHT_DEFAULT }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min
    return Math.min(max, Math.max(min, Math.round(value)))
  }

  return {
    input,
    featureFlags,
    tdpyOverride,
    setTdpyOverride,
    clearTdpyOverride,
    activeCapabilityId,
    activeFormulaId,
    activeCapability,
    activeCapabilityStages,
    activeFormula,
    formulaCapabilities,
    strategyProfileList,
    selectCapability,
    leftPanelOpen,
    rightPanelOpen,
    activeLeftTab,
    toggleLeftPanel,
    toggleRightPanel,
    leftPanelW,
    rightPanelW,
    setLeftPanelW,
    setRightPanelW,
    resetLeftPanelW,
    resetRightPanelW,
  }
}

export function buildExecutionBrief(graph) {
  const state = graph?.decision?.state ?? '未载入路径'
  const orders = graph?.plan?.primaryOrders ?? []
  const firstOrder = orders[0]
  const blocked = graph?.decision?.blockedReasons ?? []
  const missing = graph?.decision?.missingInputs ?? []
  return {
    title: state,
    bias: orders.length ? '已生成模拟挂单' : '信号条件未触发或缺少必要输入',
    profileLabel: `手动档位 ${graph?.profile?.label ?? '均衡'}`,
    price: firstOrder?.price ?? null,
    notional: firstOrder?.notional ?? null,
    stop: graph?.position?.stopPrice ?? null,
    target: graph?.position?.targetPrice ?? null,
    reason: blocked[0] ?? missing[0] ?? graph?.decision?.timing?.reason ?? '等待真实 K 线。',
    triggeredConditions: graph?.decision?.triggeredConditions ?? [],
    blockedReasons: blocked,
    missingInputs: missing,
  }
}
