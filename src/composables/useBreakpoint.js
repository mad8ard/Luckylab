// src/composables/useBreakpoint.js
// 统一的响应式断点信号。
// 模块级单例：所有组件共享同一对 matchMedia 监听，避免 N 个组件 = N 套监听器。
import { ref } from 'vue'

const QUERIES = {
  mobile: '(max-width: 768px)',
  tablet: '(max-width: 1024px)',
}

const isMobile = ref(false)
const isTablet = ref(false)

let initialized = false
let mqMobile = null
let mqTablet = null

function syncMobile() { isMobile.value = mqMobile?.matches ?? false }
function syncTablet() { isTablet.value = mqTablet?.matches ?? false }

function ensureInit() {
  if (initialized) return
  if (typeof window === 'undefined' || !window.matchMedia) return
  mqMobile = window.matchMedia(QUERIES.mobile)
  mqTablet = window.matchMedia(QUERIES.tablet)
  mqMobile.addEventListener('change', syncMobile)
  mqTablet.addEventListener('change', syncTablet)
  syncMobile()
  syncTablet()
  initialized = true
}

// 测试 hook：让单测能在不同 mock 之间重置单例状态。生产代码不应调用。
export function __resetBreakpointForTests() {
  if (mqMobile) mqMobile.removeEventListener('change', syncMobile)
  if (mqTablet) mqTablet.removeEventListener('change', syncTablet)
  mqMobile = null
  mqTablet = null
  isMobile.value = false
  isTablet.value = false
  initialized = false
}

export function useBreakpoint() {
  ensureInit()
  return { isMobile, isTablet }
}
