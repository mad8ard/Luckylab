/**
 * 持久化 ref / reactive 的简易封装
 *
 * 设计：
 *   - 仅在浏览器环境工作（typeof window !== 'undefined'），SSR/Node 测试中是 no-op
 *   - 用 JSON 序列化；反序列化失败或字段缺失时回退到默认值
 *   - 写入用 deep watch + 防抖（200ms）避免高频写
 *   - key 加版本号，结构升级时旧数据被忽略而不是炸场
 *
 * 用法：
 *   const input = persistedReactive('lab.input.v1', { entryPrice: 0, ... })
 *   const mode = persistedRef('lab.mode.v1', 'orders')
 */
import { isRef, reactive, ref, watch } from 'vue'

const DEBOUNCE_MS = 200

function safeParse(raw) {
  try { return JSON.parse(raw) } catch { return null }
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function readStored(key) {
  if (!isBrowser()) return null
  try { return safeParse(window.localStorage.getItem(key)) } catch { return null }
}

function writeStored(key, value) {
  if (!isBrowser()) return
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch {
    // 配额不足或被禁，静默失败
  }
}

function debounce(fn, ms) {
  let t = null
  return (...args) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => { fn(...args); t = null }, ms)
  }
}

/**
 * 字段级合并：仅覆盖 default 中已声明的 key，避免 localStorage 残留把新版本 default 污染
 */
function mergeKnown(defaults, stored) {
  if (!stored || typeof stored !== 'object') return { ...defaults }
  const out = { ...defaults }
  for (const k of Object.keys(defaults)) {
    if (k in stored) out[k] = stored[k]
  }
  return out
}

export function persistedReactive(key, defaults) {
  const stored = readStored(key)
  const initial = mergeKnown(defaults, stored)
  const state = reactive(initial)
  const persist = debounce(() => writeStored(key, { ...state }), DEBOUNCE_MS)
  watch(state, persist, { deep: true })
  return state
}

export function persistedRef(key, defaultValue) {
  const stored = readStored(key)
  const initial = stored !== null && stored !== undefined ? stored : defaultValue
  const r = ref(initial)
  const persist = debounce(() => writeStored(key, r.value), DEBOUNCE_MS)
  watch(r, persist)
  return r
}

/**
 * 清空所有 lab.* 持久化项（用于"重置工作台"按钮）
 */
export function clearPersistedLab() {
  if (!isBrowser()) return
  try {
    const keys = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith('lab.')) keys.push(k)
    }
    for (const k of keys) window.localStorage.removeItem(k)
  } catch {
    // 忽略
  }
}
