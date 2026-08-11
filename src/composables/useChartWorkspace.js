import { computed, ref, shallowRef, watch } from 'vue'
import { CHART_ENGINE_IDS, normalizeChartEngine } from '../domain/research-visualization/chartEngines.js'
import { persistedRef } from './usePersisted.js'

export function useChartWorkspace({ loadHqComponent = () => import('../components/HqChartTerminal.vue') } = {}) {
  const storedEngine = persistedRef('lab.chartEngine.v1', CHART_ENGINE_IDS.LIGHTWEIGHT)
  const hqComponent = shallowRef(null)
  const hqLoadState = ref('idle')
  const fallbackError = ref('')
  const requestedEngine = ref(null)
  let loadGeneration = 0

  const engine = computed(() => normalizeChartEngine(storedEngine.value))
  const isHq = computed(() => engine.value === CHART_ENGINE_IDS.HQCHART)
  const isHqPending = computed(() => requestedEngine.value === CHART_ENGINE_IDS.HQCHART)

  watch(
    engine,
    (next) => {
      if (storedEngine.value !== next) storedEngine.value = next
      if (next === CHART_ENGINE_IDS.HQCHART) ensureHqComponent()
    },
    { immediate: true },
  )

  function selectEngine(next) {
    const normalized = normalizeChartEngine(next)
    fallbackError.value = ''
    if (normalized === CHART_ENGINE_IDS.LIGHTWEIGHT) {
      requestedEngine.value = null
      storedEngine.value = normalized
      return null
    }
    if (isHq.value && !isHqPending.value) return hqComponent.value
    requestedEngine.value = CHART_ENGINE_IDS.HQCHART
    return ensureHqComponent()
  }

  async function ensureHqComponent({ force = false } = {}) {
    if (hqComponent.value && !force) return hqComponent.value
    if (hqLoadState.value === 'loading' && !force) return null
    const generation = ++loadGeneration
    hqLoadState.value = 'loading'
    fallbackError.value = ''
    try {
      const module = await loadHqComponent()
      if (generation !== loadGeneration) return null
      const component = module?.default ?? module
      if (!component) throw new Error('HQChart 组件未导出')
      hqComponent.value = component
      hqLoadState.value = 'ready'
      return component
    } catch (caught) {
      if (generation !== loadGeneration) return null
      hqComponent.value = null
      hqLoadState.value = 'error'
      fallbackToLight(caught)
      return null
    }
  }

  function fallbackToLight(error) {
    fallbackError.value = readableError(error)
    requestedEngine.value = null
    storedEngine.value = CHART_ENGINE_IDS.LIGHTWEIGHT
  }

  function retryHq() {
    fallbackError.value = ''
    requestedEngine.value = CHART_ENGINE_IDS.HQCHART
    return ensureHqComponent({ force: true })
  }

  function confirmHqReady() {
    fallbackError.value = ''
    requestedEngine.value = null
    storedEngine.value = CHART_ENGINE_IDS.HQCHART
  }

  return {
    engine,
    isHq,
    isHqPending,
    hqComponent,
    hqLoadState,
    fallbackError,
    selectEngine,
    retryHq,
    fallbackToLight,
    confirmHqReady,
  }
}

function readableError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message ? `HQ 专业图启动失败：${message}` : 'HQ 专业图启动失败，已继续使用研究图。'
}
