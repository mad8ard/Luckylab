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
    iv: 0,
    ivSource: 'unset',
    deltaSlope: 0.3,
    exitTargetReturn: 0,
    capital: 0,
    baseNotional: 0,
    replayFeeRate: null,
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
    optionPremium: null,
    optionTenorSessions: null,
    optionWidthPct: 0.05,
    strikePrice2: 0,
    lpScenarioEnabled: false,
    lpScenarioStartPrice: null,
    lpScenarioRangeWidth: null,
    lpScenarioSkew: null,
    lpScenarioLiquidity: null,
    hedgeSize: 0,
    feeIncomeQuote: null,
    perpTwap: 0,
    spotTwap: 0,
    pathUsesScenarioInputs: false,
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

  function setPathUsesScenarioInputs(value) {
    input.pathUsesScenarioInputs = value === true
  }

  const activeFormulaId = persistedRef('lab.activeFormulaId.v1', 'delta-band')
  const activeCapabilityId = persistedRef('lab.activeCapabilityId.v1', 'move-derivative')
  activeFormulaId.value = normalizeFormulaId(activeFormulaId.value)
  activeCapabilityId.value = capabilityForFormula(activeFormulaId.value)?.id ?? 'move-derivative'
  const activeCapability = computed(() => getFormulaCapability(activeCapabilityId.value))
  const activeCapabilityStages = computed(() => getCapabilityStages(activeCapabilityId.value))
  const activeFormula = computed(() => getFormulaStage(activeFormulaId.value))

  function selectCapability(id) {
    const capability = formulaCapabilities.find((item) => item.id === id) ?? formulaCapabilities[0]
    activeCapabilityId.value = capability.id
    activeFormulaId.value = capability.stages[0] ?? activeFormulaId.value
  }

  function selectFormula(id) {
    const nextId = normalizeFormulaId(id)
    activeFormulaId.value = nextId
    activeCapabilityId.value = capabilityForFormula(nextId)?.id ?? activeCapabilityId.value
  }

  // 三栏面板状态：左/右面板开闭 + 左面板当前 tab
  const leftPanelOpen = persistedRef('lab.leftPanelOpen.v1', true)
  const rightPanelOpen = persistedRef('lab.rightPanelOpen.v1', true)
  const activeLeftTab = persistedRef('lab.activeLeftTab.v1', 'decision')

  function toggleLeftPanel() {
    leftPanelOpen.value = !leftPanelOpen.value
  }
  function toggleRightPanel() {
    rightPanelOpen.value = !rightPanelOpen.value
  }

  // 面板宽度（v3.2 拖宽）
  const LEFT_MIN = 200,
    LEFT_MAX = 360
  const RIGHT_MIN = 200,
    RIGHT_MAX = 300
  const LEFT_DEFAULT = 280
  const RIGHT_DEFAULT = 240

  const leftPanelW = persistedRef('lab.leftPanelW.v1', LEFT_DEFAULT)
  const rightPanelW = persistedRef('lab.rightPanelW.v1', RIGHT_DEFAULT)
  // 旧版本或手工改写的 localStorage 也必须在消费前校验，不能直接把主图挤没。
  leftPanelW.value = clamp(Number(leftPanelW.value), LEFT_MIN, LEFT_MAX)
  rightPanelW.value = clamp(Number(rightPanelW.value), RIGHT_MIN, RIGHT_MAX)

  function setLeftPanelW(w) {
    leftPanelW.value = clamp(w, LEFT_MIN, LEFT_MAX)
  }
  function setRightPanelW(w) {
    rightPanelW.value = clamp(w, RIGHT_MIN, RIGHT_MAX)
  }
  function resetLeftPanelW() {
    leftPanelW.value = LEFT_DEFAULT
  }
  function resetRightPanelW() {
    rightPanelW.value = RIGHT_DEFAULT
  }

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
    setPathUsesScenarioInputs,
    activeCapabilityId,
    activeFormulaId,
    activeCapability,
    activeCapabilityStages,
    activeFormula,
    formulaCapabilities,
    strategyProfileList,
    selectCapability,
    selectFormula,
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

function normalizeFormulaId(id) {
  return capabilityForFormula(id) ? id : 'delta-band'
}

function capabilityForFormula(id) {
  return formulaCapabilities.find((capability) => capability.stages.includes(id)) ?? null
}

export function buildExecutionBrief(graph) {
  const state = graph?.decision?.state ?? '未载入路径'
  const candidate = graph?.decision?.candidateStatus ?? '等待'
  const execution = graph?.decision?.executionStatus === 'simulation-only' ? '仅模拟' : '不可执行'
  const orders = graph?.plan?.primaryOrders ?? []
  const firstOrder = orders[0]
  const blocked = graph?.decision?.blockedReasons ?? []
  const missing = graph?.decision?.missingInputs ?? []
  return {
    title: `市场结构：${state}`,
    bias: `候选${candidate} · ${execution}${orders.length ? ` · ${orders.length} 档` : ''}`,
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
