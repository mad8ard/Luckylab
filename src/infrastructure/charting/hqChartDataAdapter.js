const HISTORY_REQUEST = 'KLineChartContainer::RequestHistoryData'
const HISTORY_MINUTE_REQUEST = 'KLineChartContainer::ReqeustHistoryMinuteData'
const API_INDEX_REQUEST = 'APIScriptIndex::ExecuteScript'

export function toHqSymbol(source = {}) {
  const raw = String(source.symbol ?? source.id ?? 'market-lab').trim()
  if (!raw) return 'market-lab'
  if (raw.includes('.')) return raw.toLowerCase()

  const market = String(source.market ?? '').toLowerCase()
  const id = String(source.id ?? '').toLowerCase()
  if (/^\d{6}$/.test(raw) && (market.includes('a股') || id.startsWith('cn-') || id.startsWith('auto-'))) {
    return `${raw}.${/^[569]/.test(raw) ? 'sh' : 'sz'}`
  }
  if (market.includes('港') || id.startsWith('hk-')) return `${raw}.hk`.toLowerCase()
  if (market.includes('美') || id.startsWith('us-')) return `${raw}.us`.toLowerCase()
  if (market.includes('加密') || id.includes('usdt')) return `${raw}.bit`.toLowerCase()
  return raw.toLowerCase()
}

export function toHqHistoryResponse(rows, source = {}) {
  const symbol = toHqSymbol(source)
  const data = sanitizeRows(rows).map((row, index, validRows) => {
    const previousClose = index > 0 ? validRows[index - 1].close : row.open
    const amount = Number.isFinite(row.amount) ? row.amount : row.close * row.volume
    return [dateNumber(row.date), previousClose, row.open, row.high, row.low, row.close, row.volume, amount]
  })
  return {
    data,
    symbol,
    name: String(source.label ?? source.symbol ?? symbol),
    ver: 2,
  }
}

export function createHqNetworkFilter({ getRows, getSource, getResearchResponse, onUnsupported } = {}) {
  return (request, callback) => {
    if (!request || typeof request !== 'object') return
    request.PreventDefault = true
    const name = request.Name
    if (name === HISTORY_REQUEST) {
      const response = toHqHistoryResponse(getRows?.() ?? [], getSource?.() ?? {})
      const count = Number(request.Request?.Data?.count)
      if (Number.isFinite(count) && count > 0 && response.data.length > count) {
        response.data = response.data.slice(-count)
      }
      queueCallback(callback, response)
      return
    }
    if (name === HISTORY_MINUTE_REQUEST) {
      onUnsupported?.({ name, reason: 'minute-data-unavailable' })
      const source = getSource?.() ?? {}
      queueCallback(callback, {
        data: [],
        symbol: toHqSymbol(source),
        name: String(source.label ?? source.symbol ?? ''),
        ver: 2,
      })
      return
    }
    if (name === API_INDEX_REQUEST) {
      const apiId = request.Request?.Data?.indexname
      const response = getResearchResponse?.(apiId)
      if (response) {
        queueCallback(callback, response)
        return
      }
      onUnsupported?.({ name, apiId, reason: 'research-index-unavailable' })
      queueCallback(callback, {
        code: 0,
        error: { message: `本地研究指标不可用: ${String(apiId || 'unknown')}` },
        outdata: { name: 'Market Lab', date: [], outvar: [] },
      })
      return
    }
    onUnsupported?.({ name, reason: 'local-data-fail-closed' })
  }
}

export function dateNumber(value) {
  const compact = String(value ?? '')
    .replaceAll('-', '')
    .slice(0, 8)
  const number = Number(compact)
  return Number.isInteger(number) && compact.length === 8 ? number : 0
}

function sanitizeRows(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .filter(
      (row) =>
        dateNumber(row?.date) > 0 &&
        [row?.open, row?.high, row?.low, row?.close, row?.volume].every(Number.isFinite) &&
        row.open > 0 &&
        row.high >= Math.max(row.open, row.close) &&
        row.low <= Math.min(row.open, row.close) &&
        row.volume >= 0,
    )
    .sort((left, right) => dateNumber(left.date) - dateNumber(right.date))
}

function queueCallback(callback, payload) {
  if (typeof callback !== 'function') return
  if (typeof queueMicrotask === 'function') queueMicrotask(() => callback(payload))
  else Promise.resolve().then(() => callback(payload))
}
