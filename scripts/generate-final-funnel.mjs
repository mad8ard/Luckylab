#!/usr/bin/env node
// 第三段漏斗：30 只回放候选 → 样本外折 + 10bps → 15 只 → 135 资金流最终评分。

import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseCsvText } from '../src/domain/market-data/ohlcv.js'
import { inferTdpy } from '../src/domain/market-data/tdpy.js'
import {
  ANALOG_DEFAULTS,
  buildAnalogFeatureSeries,
  findAnalogMatches,
  scorePathStats,
  summarizeAnalogs,
} from '../src/domain/strategy-planning/analogAudit.js'
import { computeFundFlowScore, fundFlowBand } from '../src/domain/strategy-planning/fundFlowScore.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const ANALOG_PATH = join(ROOT, 'src', 'data', 'analog-audit-latest.json')
const FUND_FLOW_PATH = join(ROOT, 'src', 'data', 'fund-flow-latest.json')
const INDEX_PATH = join(ROOT, 'src', 'data', 'stock-index.json')
const DATA_DIR = join(ROOT, 'public', 'data')
const OUT_DIR = join(ROOT, 'src', 'data', 'final-funnels')
const LATEST_PATH = join(ROOT, 'src', 'data', 'final-funnel-latest.json')
const FINAL_N = 15
const STAGE2_N = 30

const analog = JSON.parse(await readFile(ANALOG_PATH, 'utf8'))
const index = JSON.parse(await readFile(INDEX_PATH, 'utf8'))
const bySymbol = new Map(index.map((entry) => [entry.symbol, entry]))
const stage2Rows = (analog.rows ?? [])
  .filter((row) => row.stage2Selected && row.market === 'A股')
  .sort((left, right) => left.stage2Rank - right.stage2Rank)
  .slice(0, STAGE2_N)

const candidates = []
for (const row of stage2Rows) {
  const entry = bySymbol.get(row.symbol)
  if (!entry) continue
  try {
    const rows = parseCsvText(await readFile(join(DATA_DIR, String(entry.url ?? '').split('/').at(-1)), 'utf8'))
    const tdpy = inferTdpy(entry).value
    const { series } = buildAnalogFeatureSeries(rows, { tdpy })
    const currentIndex = rows.length - 1
    const currentAnalogs = findAnalogMatches({ rows, series, currentIndex, options: { ...ANALOG_DEFAULTS } })
    const currentStats = summarizeAnalogs(currentAnalogs, rows)
    const cutoff = Math.floor(rows.length * 0.8)
    const oosAnalogs = findAnalogMatches({
      rows,
      series,
      currentIndex: cutoff,
      options: { ...ANALOG_DEFAULTS, maxIndex: cutoff - ANALOG_DEFAULTS.minForward },
    })
    const oosStats = summarizeAnalogs(oosAnalogs, rows)
    const costStats = adjustForBps(currentStats, 0.2)
    const currentPath = scorePathStats(currentStats)
    const oosPath = scorePathStats(oosStats)
    const costPath = scorePathStats(costStats)
    const stage3Score = Number.isFinite(oosPath) && Number.isFinite(costPath)
      ? round(oosPath * 0.6 + costPath * 0.4, 2)
      : null
    candidates.push({
      symbol: row.symbol,
      label: row.label,
      market: row.market,
      tier: row.tier,
      poolScore: row.poolScore,
      poolMaxScore: row.poolMaxScore,
      northbound: row.northbound ?? null,
      stage2Rank: row.stage2Rank,
      stage2Score: row.audit?.auditScore ?? null,
      currentDate: rows.at(-1)?.date ?? null,
      current: { stats: publicStats(currentStats), pathScore: currentPath },
      oos: { cutoffDate: rows[cutoff]?.date ?? null, stats: publicStats(oosStats), pathScore: oosPath },
      cost10bps: { stats: publicStats(costStats), pathScore: costPath, note: '10bps 单边；买卖两端合计约 20bps' },
      sampleConfidence: round((currentStats.sampleConfidence + oosStats.sampleConfidence) / 2, 4),
      stage3Score,
    })
  } catch (error) {
    console.warn(`  [warn] ${row.symbol}: ${error.message}`)
  }
}

candidates.sort((left, right) => {
  const a = Number.isFinite(left.stage3Score) ? left.stage3Score : -1
  const b = Number.isFinite(right.stage3Score) ? right.stage3Score : -1
  return b - a || left.stage2Rank - right.stage2Rank
})
candidates.forEach((item, index) => {
  item.stage3Rank = index + 1
  item.finalSelected = index < FINAL_N
})
const selected = candidates.slice(0, FINAL_N)

let fundFlowPayload = null
try {
  fundFlowPayload = JSON.parse(await readFile(FUND_FLOW_PATH, 'utf8'))
} catch (error) {
  if (error?.code !== 'ENOENT') console.warn(`资金流快照读取失败：${error.message}`)
}
for (const item of selected) {
  const ff = fundFlowPayload?.rows?.[item.symbol]
  const flow = ff ? computeFundFlowScore(ff) : { score: null, components: {}, missingWindows: ['today', 'd3', 'd5'] }
  item.flow = {
    available: flow.score !== null,
    score: flow.score,
    band: fundFlowBand(flow.score),
    today: ff?.today ?? null,
    todayPct: ff?.todayPct ?? null,
    d3: ff?.d3 ?? null,
    d3Pct: ff?.d3Pct ?? null,
    d5: ff?.d5 ?? null,
    d5Pct: ff?.d5Pct ?? null,
    components: flow.components ?? {},
    missingWindows: flow.missingWindows ?? [],
    source: fundFlowPayload?.source ?? null,
    generatedAt: fundFlowPayload?.generatedAt ?? null,
    dataThrough: fundFlowPayload?.dataThrough ?? null,
  }
  item.finalScore = Number.isFinite(item.flow.score) && Number.isFinite(item.stage3Score)
    ? round(item.stage3Score * 0.7 + item.flow.score * 0.3, 2)
    : item.stage3Score
}
selected.sort((left, right) => {
  const a = Number.isFinite(left.finalScore) ? left.finalScore : -1
  const b = Number.isFinite(right.finalScore) ? right.finalScore : -1
  return b - a || left.stage3Rank - right.stage3Rank
})
selected.forEach((item, index) => { item.finalRank = index + 1 })

const generatedAt = new Date().toISOString()
const flowScored = selected.filter((item) => item.flow?.available).length
const payload = {
  schemaVersion: 'final-funnel.v1',
  generatedAt,
  sourceAnalogGeneratedAt: analog.generatedAt ?? null,
  funnel: { stage1: analog.counts?.candidates ?? 50, stage2: stage2Rows.length, stage3: selected.length, final: selected.length },
  weights: { stage2Path: '同股 10/40/10', oos: 0.6, cost10bps: 0.4, stage3: 0.7, flow135: 0.3 },
  flow: fundFlowPayload ? {
    available: true,
    generatedAt: fundFlowPayload.generatedAt,
    dataThrough: fundFlowPayload.dataThrough,
    source: fundFlowPayload.source,
    scored: flowScored,
    total: selected.length,
  } : { available: false, scored: 0, total: selected.length },
  counts: { stage2: stage2Rows.length, stage3: selected.length, final: selected.length, flowScored, failures: 0 },
  rows: selected,
  stage3Rows: candidates,
}

await mkdir(OUT_DIR, { recursive: true })
const datedPath = join(OUT_DIR, `final-funnel-${generatedAt.slice(0, 10)}.json`)
const body = `${JSON.stringify(payload, null, 2)}\n`
await writeFile(datedPath, body, 'utf8')
await writeFile(LATEST_PATH, body, 'utf8')

console.log(`最终漏斗完成：50 → ${stage2Rows.length} → ${selected.length}；135资金流 ${flowScored}/${selected.length}`)
console.log(`  ${datedPath}`)
console.log(`  ${LATEST_PATH}`)

const render = spawnSync(process.execPath, [join(ROOT, 'scripts', 'render-final-funnel-page.mjs')], { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' })
if (render.status !== 0) process.exit(render.status ?? 1)

function adjustForBps(stats, bpsPct) {
  return {
    ...stats,
    fwd10MedianPct: finite(stats.fwd10MedianPct) ? round(stats.fwd10MedianPct - bpsPct, 2) : stats.fwd10MedianPct,
    fwd20MedianPct: finite(stats.fwd20MedianPct) ? round(stats.fwd20MedianPct - bpsPct, 2) : stats.fwd20MedianPct,
    mae20MedianPct: finite(stats.mae20MedianPct) ? round(stats.mae20MedianPct - bpsPct, 2) : stats.mae20MedianPct,
    mae20TailPct: finite(stats.mae20TailPct) ? round(stats.mae20TailPct - bpsPct, 2) : stats.mae20TailPct,
  }
}

function publicStats(stats) {
  return {
    count: stats.count,
    effectiveCount: stats.effectiveCount,
    fwd10MedianPct: stats.fwd10MedianPct,
    fwd20MedianPct: stats.fwd20MedianPct,
    winRate20Pct: stats.winRate20Pct,
    mae20MedianPct: stats.mae20MedianPct,
    mae20TailPct: stats.mae20TailPct,
    targetFirstRate: stats.targetFirstRate,
    avgSimilarity: stats.avgSimilarity,
    sampleConfidence: stats.sampleConfidence,
  }
}

function finite(value) {
  return Number.isFinite(value)
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
