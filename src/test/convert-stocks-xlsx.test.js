import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import { parseCsvText } from '../domain/market-data/ohlcv.js'

const execFileAsync = promisify(execFile)
const PROJECT_ROOT = process.cwd()
const SCRIPT_PATH = join(PROJECT_ROOT, 'scripts', 'convert-stocks-xlsx.mjs')
const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('convert-stocks-xlsx', () => {
  it('preserves the workbook opening price instead of replacing it with close', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'market-lab-xlsx-'))
    temporaryDirectories.push(outputRoot)
    const outputDirectory = join(outputRoot, 'data')
    const indexPath = join(outputRoot, 'stock-index.json')
    const workbookPath = join(outputRoot, 'smoke.xlsx')
    writeWorkbookFixture(workbookPath)

    await execFileAsync(process.execPath, [
      SCRIPT_PATH,
      workbookPath,
      '--out-dir',
      outputDirectory,
      '--index-path',
      indexPath,
      '--replace-index',
    ])

    const rows = parseCsvText(await readFile(join(outputDirectory, '000568-1d.csv'), 'utf8'))
    expect(rows).toHaveLength(10)
    expect(rows[0]).toMatchObject({
      date: '2026-05-06',
      open: 113.2037,
      close: 115.1016,
    })
    expect(rows.some((row) => row.open !== row.close)).toBe(true)
    const index = JSON.parse(await readFile(indexPath, 'utf8'))
    expect(index).toHaveLength(1)
    expect(index[0]).toMatchObject({
      priceBasis: 'adjusted',
      dataThrough: '2026-05-15',
      isPartial: false,
      isStale: false,
    })
  })
})

function writeWorkbookFixture(workbookPath) {
  const candles = Array.from({ length: 10 }, (_, index) => {
    const open = index === 0 ? 113.2037 : 116 + index
    const close = index === 0 ? 115.1016 : open + (index % 2 === 0 ? 0.8 : -0.6)
    return {
      date: `2026-05-${String(index + 6).padStart(2, '0')}`,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 1_000 + index,
    }
  })
  const workbook = XLSX.utils.book_new()

  for (const field of ['open', 'high', 'low', 'close', 'volume']) {
    const rows = [
      ['code', '000568'],
      ['name', 'CI fixture'],
      ['Date', null],
      ...candles.map((candle) => [candle.date, candle[field]]),
    ]
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), field)
  }

  XLSX.writeFile(workbook, workbookPath)
}
