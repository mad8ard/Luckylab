import { csvParse } from 'd3-dsv'

export const marketSamples = [
  // ── 港股 ──
  { id: 'hk-0700-1d', label: '腾讯', symbol: '0700.HK', interval: '1日', source: 'Yahoo Finance', url: '/data/0700_HK-1d.csv' },
  { id: 'hk-9988-1d', label: '阿里巴巴', symbol: '9988.HK', interval: '1日', source: 'Yahoo Finance', url: '/data/9988_HK-1d.csv' },
  { id: 'hk-1810-1d', label: '小米', symbol: '1810.HK', interval: '1日', source: 'Yahoo Finance', url: '/data/1810_HK-1d.csv' },
  { id: 'hk-3690-1d', label: '美团', symbol: '3690.HK', interval: '1日', source: 'Yahoo Finance', url: '/data/3690_HK-1d.csv' },
  { id: 'hk-1211-1d', label: '比亚迪', symbol: '1211.HK', interval: '1日', source: 'Yahoo Finance', url: '/data/1211_HK-1d.csv' },

  // ── A股 ──
  { id: 'cn-600519-1d', label: '贵州茅台', symbol: '600519', interval: '1日', source: 'Yahoo Finance', url: '/data/600519-1d.csv' },
  { id: 'cn-002594-1d', label: '比亚迪', symbol: '002594', interval: '1日', source: 'Yahoo Finance', url: '/data/002594-1d.csv' },
  { id: 'cn-300750-1d', label: '宁德时代', symbol: '300750', interval: '1日', source: 'Yahoo Finance', url: '/data/300750-1d.csv' },
  { id: 'cn-601899-1d', label: '紫金矿业', symbol: '601899', interval: '1日', source: 'Yahoo Finance', url: '/data/601899-1d.csv' },
  { id: 'cn-300308-1d', label: '中际旭创', symbol: '300308', interval: '1日', source: 'Yahoo Finance', url: '/data/300308-1d.csv' },
  { id: 'cn-688256-1d', label: '寒武纪', symbol: '688256', interval: '1日', source: 'Yahoo Finance', url: '/data/688256-1d.csv' },
]

export function parseCsvText(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return []
  const firstLine = trimmed.split(/\r?\n/, 1)[0]
  if (/^\d/.test(firstLine) && firstLine.split(',').length >= 6) return parseBinanceKlines(trimmed)
  return parseOhlcv(csvParse(trimmed))
}

export function parseBinanceKlines(text) {
  return String(text ?? '')
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const cols = line.split(',')
      const rawTimestamp = Number(cols[0])
      const timestamp = rawTimestamp > 9999999999999 ? Math.floor(rawTimestamp / 1000) : rawTimestamp
      return {
        date: new Date(timestamp).toISOString().slice(0, 10),
        timestamp,
        open: numberValue(cols[1]),
        high: numberValue(cols[2]),
        low: numberValue(cols[3]),
        close: numberValue(cols[4]),
        volume: numberValue(cols[5]),
      }
    })
    .filter(isValidOhlcv)
    .sort((a, b) => a.timestamp - b.timestamp)
}

export function parseOhlcv(rows) {
  return rows
    .map((row) => {
      const rawDate = pick(row, ['date', 'time', 'datetime', 'timestamp', 'Date', 'Time', 'Datetime'])
      const timestamp = parseTimestamp(rawDate)
      return {
        date: Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : String(rawDate ?? ''),
        timestamp,
        open: numberValue(pick(row, ['open', 'Open', 'o'])),
        high: numberValue(pick(row, ['high', 'High', 'h'])),
        low: numberValue(pick(row, ['low', 'Low', 'l'])),
        close: numberValue(pick(row, ['close', 'Close', 'c', 'adj close', 'Adj Close'])),
        volume: numberValue(pick(row, ['volume', 'Volume', 'vol', 'v'])),
      }
    })
    .filter(isValidOhlcv)
    .sort((a, b) => a.timestamp - b.timestamp)
}

function pick(row, keys) {
  const key = keys.find((candidate) => row[candidate] !== undefined)
  return key ? row[key] : undefined
}

function numberValue(value) {
  return Number(String(value ?? '').replaceAll(',', ''))
}

function parseTimestamp(value) {
  const raw = String(value ?? '').trim()
  const numeric = Number(raw)
  if (Number.isFinite(numeric)) {
    if (numeric > 1000000000000) return numeric
    if (numeric > 1000000000) return numeric * 1000
  }
  return new Date(raw).getTime()
}

function isValidOhlcv(row) {
  return (
    row.date &&
    Number.isFinite(row.timestamp) &&
    [row.open, row.high, row.low, row.close].every((value) => Number.isFinite(value) && value > 0) &&
    row.high >= Math.max(row.open, row.close) &&
    row.low <= Math.min(row.open, row.close) &&
    Number.isFinite(row.volume) &&
    row.volume >= 0
  )
}
