import XLSX from 'xlsx'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { assessOhlcvQuality } from '../src/domain/market-data/ohlcv.js'

// 用法：
//   node scripts/convert-stocks-xlsx.mjs <xlsx 路径>
//   或环境变量：STOCKS_XLSX=路径 node scripts/convert-stocks-xlsx.mjs
const args = process.argv.slice(2)
const INPUT = positionalArgs(args)[0] || process.env.STOCKS_XLSX
if (!INPUT) {
  console.error('用法: node scripts/convert-stocks-xlsx.mjs <xlsx 路径>')
  console.error('     或设环境变量 STOCKS_XLSX=路径 后执行')
  process.exit(2)
}
if (!existsSync(INPUT)) {
  console.error(`文件不存在: ${INPUT}`)
  process.exit(2)
}

const OUT_DIR = optionValue('--out-dir', join(import.meta.dirname, '..', 'public', 'data'))
const INDEX_PATH = optionValue('--index-path', join(import.meta.dirname, '..', 'src', 'data', 'stock-index.json'))
const REPLACE_INDEX = args.includes('--replace-index')

const wb = XLSX.readFile(INPUT)
console.log('Sheets:', wb.SheetNames)

// Read all sheets
const sheets = {}
for (const name of ['open', 'high', 'low', 'close', 'volume']) {
  const ws = wb.Sheets[name]
  if (!ws) {
    console.error(`Sheet "${name}" not found`)
    process.exit(1)
  }
  sheets[name] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
}
validateWorkbookLayout(sheets)

const openData = sheets.open
const closeData = sheets.close
const highData = sheets.high
const lowData = sheets.low
const volumeData = sheets.volume

// Row 0: codes, Row 1: names
const codes = closeData[0].slice(1)
const names = closeData[1].slice(1)
const workbookLatestDate = closeData
  .slice(2)
  .map((row) => String(row[0] ?? '').trim())
  .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
  .sort()
  .at(-1)

console.log(`Total stocks: ${codes.length}`)
console.log(`Date rows: ${closeData.length - 2}`) // Row 2 is "Date" header, Row 3+ are data

// Build per-stock CSVs
mkdirSync(OUT_DIR, { recursive: true })

let exported = 0
const refreshedIndex = []
for (let colIdx = 0; colIdx < codes.length; colIdx++) {
  const code = String(codes[colIdx]).trim()
  const name = String(names[colIdx]).trim()
  if (!code || code === 'null') continue

  const rows = []
  let invalidCandleRows = 0
  for (let rowIdx = 2; rowIdx < closeData.length; rowIdx++) {
    const date = closeData[rowIdx][0]
    if (!date) continue

    const open = numberVal(openData[rowIdx]?.[colIdx + 1])
    const close = numberVal(closeData[rowIdx]?.[colIdx + 1])
    const high = numberVal(highData[rowIdx]?.[colIdx + 1])
    const low = numberVal(lowData[rowIdx]?.[colIdx + 1])
    const volume = numberVal(volumeData[rowIdx]?.[colIdx + 1])

    // Validation: need valid OHLCV
    if (!Number.isFinite(open) || open <= 0) continue
    if (!Number.isFinite(close) || close <= 0) continue
    if (!Number.isFinite(high) || high <= 0) continue
    if (!Number.isFinite(low) || low <= 0) continue
    if (!Number.isFinite(volume) || volume < 0) continue
    if (high < Math.max(open, close) || low > Math.min(open, close)) {
      invalidCandleRows++
      continue
    }

    rows.push({ date: String(date).trim(), open, high, low, close, volume })
  }

  const quality = assessOhlcvQuality(rows)
  if (quality.suspectedSyntheticOpen) {
    console.error(
      `  ERROR ${code} (${name}): ${quality.flatBodyRows}/${quality.rangedRows} ranged candles have open=close; source open prices look synthetic`,
    )
    process.exit(1)
  }
  if (quality.duplicateRows) {
    console.error(`  ERROR ${code} (${name}): ${quality.duplicateRows} duplicate dates`)
    process.exit(1)
  }
  if (quality.corporateActionBreaks.length) {
    const first = quality.corporateActionBreaks[0]
    console.error(
      `  ERROR ${code} (${name}): suspected unadjusted corporate action at ${first.date} (overnight ratio ${first.overnightRatio.toFixed(4)})`,
    )
    process.exit(1)
  }
  if (invalidCandleRows) {
    console.warn(`  WARN ${code} (${name}): skipped ${invalidCandleRows} invalid OHLC rows`)
  }

  if (rows.length < 10) {
    console.log(`  SKIP ${code} (${name}): only ${rows.length} valid rows`)
    continue
  }

  // Sort by date ascending
  rows.sort((a, b) => a.date.localeCompare(b.date))

  const csv = ['Date,Open,High,Low,Close,Volume']
  for (const r of rows) {
    csv.push(`${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume}`)
  }

  const safeName = code.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')
  const symbol = normalizeSymbol(code)
  const market = inferMarket(code)
  if (market !== 'A股' && market !== '港股') {
    console.log(`  SKIP ${code} (${name}): non A-share/HK instrument`)
    continue
  }
  const filename = `${safeName}-1d.csv`
  const dataThrough = rows.at(-1).date
  writeFileSync(join(OUT_DIR, filename), csv.join('\n'), 'utf-8')
  refreshedIndex.push({
    id: `auto-${safeName}-1d`,
    symbol,
    label: name && name !== 'null' ? name : symbol,
    market,
    interval: '1日',
    source: inferSource(code),
    priceBasis: inferPriceBasis(code),
    dataThrough,
    isPartial: false,
    isStale: daysBetween(dataThrough, workbookLatestDate) > 14,
    url: `/data/${filename}`,
    rows: rows.length,
  })
  console.log(`  OK ${code} (${name}): ${rows.length} rows -> ${filename}`)
  exported++
}

const index = REPLACE_INDEX ? refreshedIndex : mergeIndex(readExistingIndex(INDEX_PATH), refreshedIndex)
index.sort((a, b) => a.symbol.localeCompare(b.symbol))
writeFileSync(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, 'utf-8')

console.log(`\nExported ${exported} stock CSVs to ${OUT_DIR}`)
console.log(`Updated stock index: ${INDEX_PATH} (${REPLACE_INDEX ? 'replace' : 'merge'} mode, ${index.length} entries)`)

function numberVal(v) {
  if (v === null || v === undefined || v === '') return NaN
  return Number(String(v).replace(/,/g, ''))
}

function validateWorkbookLayout(inputSheets) {
  const baseline = inputSheets.close
  const baselineCodes = baseline[0]?.slice(1) ?? []
  const baselineNames = baseline[1]?.slice(1) ?? []

  for (const [sheetName, rows] of Object.entries(inputSheets)) {
    if (rows.length !== baseline.length) {
      throw new Error(`Sheet "${sheetName}" row count ${rows.length} does not match close sheet ${baseline.length}`)
    }
    assertSameCells(sheetName, 'code headers', rows[0]?.slice(1) ?? [], baselineCodes)
    assertSameCells(sheetName, 'name headers', rows[1]?.slice(1) ?? [], baselineNames)
    for (let rowIdx = 2; rowIdx < baseline.length; rowIdx++) {
      if (cellKey(rows[rowIdx]?.[0]) !== cellKey(baseline[rowIdx]?.[0])) {
        throw new Error(`Sheet "${sheetName}" date mismatch at row ${rowIdx + 1}`)
      }
    }
  }
}

function assertSameCells(sheetName, label, actual, expected) {
  if (actual.length !== expected.length) {
    throw new Error(
      `Sheet "${sheetName}" ${label} length ${actual.length} does not match close sheet ${expected.length}`,
    )
  }
  for (let index = 0; index < expected.length; index++) {
    if (cellKey(actual[index]) !== cellKey(expected[index])) {
      throw new Error(`Sheet "${sheetName}" ${label} mismatch at column ${index + 2}`)
    }
  }
}

function cellKey(value) {
  return String(value ?? '').trim()
}

function optionValue(name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

function positionalArgs(values) {
  const optionNamesWithValue = new Set(['--out-dir', '--index-path'])
  const positional = []
  for (let index = 0; index < values.length; index++) {
    const value = values[index]
    if (optionNamesWithValue.has(value)) {
      index++
      continue
    }
    if (!value.startsWith('--')) positional.push(value)
  }
  return positional
}

function readExistingIndex(indexPath) {
  if (!existsSync(indexPath)) return []
  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf-8'))
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.warn(`Cannot read existing stock index, using refreshed entries only: ${error.message}`)
    return []
  }
}

function mergeIndex(existing, refreshed) {
  const bySymbol = new Map(existing.map((entry) => [entry.symbol, entry]))
  for (const entry of refreshed) {
    const prior = bySymbol.get(entry.symbol)
    bySymbol.set(entry.symbol, mergeEntry(prior, entry))
  }
  return [...bySymbol.values()]
}

function mergeEntry(prior, next) {
  if (!prior) return next
  const weakLabel = !next.label || next.label === next.symbol || next.label === 'null'
  return {
    ...prior,
    ...next,
    label: weakLabel && prior.label ? prior.label : next.label,
  }
}

function normalizeSymbol(code) {
  return String(code).trim().replace(/_HK$/i, '.HK')
}

function inferMarket(code) {
  const value = normalizeSymbol(code)
  if (/^\d{6}$/.test(value)) return 'A股'
  if (/\.HK$/i.test(value)) return '港股'
  return '美股'
}

function inferSource(code) {
  const market = inferMarket(code)
  if (market === 'A股') return 'BaoStock / AkShare'
  if (market === '港股') return 'AkShare adjusted / Tencent adjusted'
  return 'Nasdaq / AkShare adjusted / Alpha Vantage'
}

function inferPriceBasis(code) {
  return 'adjusted'
}

function daysBetween(from, to) {
  return Math.max(0, (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000)
}
