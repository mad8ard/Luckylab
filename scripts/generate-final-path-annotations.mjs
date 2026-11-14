#!/usr/bin/env node
// 第四步结论后的独立历史路径旁注；不回写最终漏斗，不影响排名和分数。

import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { deriveHistoricalPathAnnotation, HISTORICAL_PATH_THRESHOLDS } from '../src/domain/market-data/historicalPathAnnotation.js'
import { parseCsvText } from '../src/domain/market-data/ohlcv.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const FINAL_PATH = join(ROOT, 'src', 'data', 'final-funnel-latest.json')
const INDEX_PATH = join(ROOT, 'src', 'data', 'stock-index.json')
const DATA_DIR = join(ROOT, 'public', 'data')
const OUT_DIR = join(ROOT, 'src', 'data', 'final-path-annotations')
const LATEST_PATH = join(ROOT, 'src', 'data', 'final-path-annotations-latest.json')

const finalPayload = JSON.parse(await readFile(FINAL_PATH, 'utf8'))
const index = JSON.parse(await readFile(INDEX_PATH, 'utf8'))
const bySymbol = new Map(index.map((entry) => [entry.symbol, entry]))
const finalRows = Array.isArray(finalPayload.rows) ? finalPayload.rows : []
const items = []
const failures = []

for (const finalRow of finalRows) {
  const entry = bySymbol.get(finalRow.symbol)
  if (!entry) {
    failures.push({ symbol: finalRow.symbol, label: finalRow.label, reason: 'missing-index-entry' })
    continue
  }
  try {
    const fileName = String(entry.url ?? '').split('/').at(-1)
    const rows = parseCsvText(await readFile(join(DATA_DIR, fileName), 'utf8'))
    const annotation = deriveHistoricalPathAnnotation(rows)
    items.push({
      symbol: finalRow.symbol,
      label: finalRow.label,
      market: finalRow.market,
      finalRank: finalRow.finalRank,
      finalScore: finalRow.finalScore,
      stage3Score: finalRow.stage3Score,
      annotation,
    })
  } catch (error) {
    failures.push({
      symbol: finalRow.symbol,
      label: finalRow.label,
      reason: String(error?.message ?? error),
    })
  }
}

const generatedAt = new Date().toISOString()
const payload = {
  schemaVersion: 'final-path-annotations.v1',
  generatedAt,
  sourceFinalGeneratedAt: finalPayload.generatedAt ?? null,
  sourceFinalCount: finalRows.length,
  selectionUnchanged: true,
  affectsFinalRanking: false,
  thresholds: HISTORICAL_PATH_THRESHOLDS,
  semantics:
    '三项指标只在第四步结论生成后追加展示；不修改候选、最终排名、最终分数或135资金流权重。',
  counts: {
    final: finalRows.length,
    annotated: items.filter((item) => item.annotation.status === 'ok').length,
    failures: failures.length,
    markCounts: {
      belowAnchorRatio: countMarks(items, 'belowAnchorRatio'),
      annualizedLogSlope: countMarks(items, 'annualizedLogSlope'),
      maxCloseDrawdown: countMarks(items, 'maxCloseDrawdown'),
    },
  },
  items,
  failures,
}

await mkdir(OUT_DIR, { recursive: true })
const datedPath = join(OUT_DIR, `final-path-annotations-${generatedAt.slice(0, 10)}.json`)
const body = `${JSON.stringify(payload, null, 2)}\n`
await writeFile(datedPath, body, 'utf8')
await writeFile(LATEST_PATH, body, 'utf8')
console.log(
  `最终结论历史路径旁注生成：annotated=${payload.counts.annotated}/${payload.counts.final}，final ranking unchanged`,
)

const render = spawnSync(process.execPath, [join(ROOT, 'scripts', 'render-final-path-annotations-page.mjs')], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: 'inherit',
})
if (render.status !== 0) process.exit(render.status ?? 1)

function countMarks(rows, key) {
  const counts = { high: 0, watch: 0, normal: 0 }
  for (const item of rows) {
    const mark = item.annotation?.marks?.[key]
    if (mark && Object.hasOwn(counts, mark)) counts[mark] += 1
  }
  return counts
}
