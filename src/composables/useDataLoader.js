import { ref } from 'vue'
import { loadMarketCsv } from '../data/generated/market-csv-index.js'
import { parseCsvText } from '../domain/market-data/ohlcv.js'

/**
 * 数据加载层：管理 rows / source / loading / error / cursor + 重试
 *
 * 错误分级：
 *   - "网络问题"：fetch 抛错或非 2xx 响应
 *   - "数据为空"：CSV 解析后无任何有效行
 *   - "解析错误"：CSV 格式异常
 *   - "未知"：兜底
 *
 * 失败后保留 lastFailedSample，调用 retryLast() 可重试
 */
export function useDataLoader(input, resetCachesOnApply = () => {}) {
  const rows = ref([])
  const source = ref(null)
  const loading = ref(false)
  const loadingSampleId = ref('')
  const error = ref(null) // { message, kind, sample? } | null
  const cursor = ref(0)
  const lastFailedSample = ref(null)
  let loadTicket = 0

  async function loadSample(sample) {
    const ticket = ++loadTicket
    loading.value = true
    loadingSampleId.value = sample.id
    error.value = null
    try {
      const text = await loadSampleText(sample)
      let nextRows
      try {
        nextRows = parseCsvText(text)
      } catch (parseErr) {
        throw kindError('parse', `CSV 解析失败：${parseErr.message || '格式异常'}`)
      }
      if (!nextRows.length) {
        throw kindError('empty', `数据为空：${sample.label}（${sample.url}）`)
      }
      if (ticket === loadTicket) {
        applyRows(nextRows, sample)
        lastFailedSample.value = null
      }
    } catch (caught) {
      if (ticket === loadTicket) {
        error.value = {
          message: caught.message || '载入失败',
          kind: caught._kind || 'unknown',
          sample,
        }
        lastFailedSample.value = sample
      }
    } finally {
      if (ticket === loadTicket) {
        loading.value = false
        loadingSampleId.value = ''
      }
    }
  }

  async function retryLast() {
    if (lastFailedSample.value) await loadSample(lastFailedSample.value)
  }

  function dismissError() {
    error.value = null
    lastFailedSample.value = null
  }

  function importText(text, label = '导入 CSV') {
    try {
      const next = parseCsvText(text)
      if (!next.length) {
        error.value = { message: '导入的 CSV 没有有效行', kind: 'empty' }
        return
      }
      applyRows(next, { label, source: '用户导入' })
      error.value = null
    } catch (caught) {
      error.value = {
        message: caught.message || '解析失败',
        kind: 'parse',
      }
    }
  }

  function applyRows(nextRows, nextSource) {
    if (!nextRows.length) throw kindError('empty', '没有可用 K 线')
    source.value = {
      ...nextSource,
      range: `${nextRows[0].date} ~ ${nextRows.at(-1).date}`,
    }
    rows.value = nextRows
    cursor.value = nextRows.length - 1
    resetCachesOnApply()
  }

  return {
    rows, source, loading, loadingSampleId, error, cursor,
    loadSample, retryLast, dismissError, importText, applyRows,
  }
}

async function loadSampleText(sample) {
  const bundled = await loadMarketCsv(sample.url)
  if (bundled !== null) return bundled

  let response
  try {
    response = await fetch(sample.url)
  } catch (netErr) {
    throw kindError('network', `网络异常：${netErr.message || '无法连接'}`)
  }
  if (!response.ok) {
    throw kindError('network', `数据读取失败：HTTP ${response.status}（${sample.url}）`)
  }
  return response.text()
}

function kindError(kind, message) {
  const e = new Error(message)
  e._kind = kind
  return e
}
