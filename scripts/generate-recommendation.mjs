#!/usr/bin/env node
// 生成「集合推荐」：把推荐池（7 维排序）与筛选（门禁分）合并成一张 10 只的清单。
//
// 口径：
//   - 推荐档：推荐分 / 当前满分 ≥ 75% 为 focus（观察档），55%~75% 为 wait（等待档）
//   - 筛选门禁：状态必须是「观察」或「等待」，且筛选分 ≥ 50
//   - 最终只保留 5 只观察档 + 5 只等待档；不足时由另一档补位
// 这个脚本不重写任何评分公式，只做合并、过滤和截断。

import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_TIER_THRESHOLDS,
  buildScoreConfig,
  computeBuyScore,
} from '../src/domain/strategy-planning/recommendedStockPool.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const POOL_PATH = join(ROOT, 'src', 'data', 'recommended-pool-latest.json')
const OUT_PATH = join(ROOT, 'src', 'data', 'recommendation-latest.json')
const NORTHBOUND_PATH = join(ROOT, 'src', 'data', 'northbound-marks.json')
const SCREEN_CLI = join(ROOT, '.agents', 'skills', 'china-stock-selection', 'scripts', 'screen-cn-stocks.mjs')

const PER_TIER = 25
const SCREEN_MIN_SCORE = 50
const SCREEN_ALLOWED = new Set(['观察', '等待'])
const TIER_RANK = { focus: 0, wait: 1, skip: 2 }

// 1) 先跑推荐池生成器（它会写出 recommended-pool-latest.json）
run([process.execPath, [join(ROOT, 'scripts', 'generate-recommended-pool.mjs')]], '推荐池生成')

// 2) 再跑筛选，拿全池的门禁状态与筛选分
const screenOutput = run(
  [process.execPath, [SCREEN_CLI, '--market', 'A股,港股', '--top', '400', '--format', 'json']],
  '筛选',
  { capture: true },
)
let screen = null
try {
  screen = JSON.parse(screenOutput)
} catch (error) {
  console.error(`筛选输出不是合法 JSON：${error.message}`)
  process.exit(1)
}

// 3) 合并、过滤、排序
const pool = JSON.parse(await readFile(POOL_PATH, 'utf8'))
const screenBySymbol = new Map((screen.ranked ?? []).map((row) => [row.symbol, row]))
const dimensions = buildScoreConfig()
let northboundPayload = null
try {
  northboundPayload = JSON.parse(await readFile(NORTHBOUND_PATH, 'utf8'))
} catch (error) {
  if (error?.code !== 'ENOENT') console.warn(`北向参考读取失败：${error.message}`)
}

const merged = (pool.candidatesAll ?? []).map((candidate) => {
  const result = computeBuyScore(candidate.metrics ?? {}, { dimensions })
  const poolRatio = result.maxScore > 0 ? result.score / result.maxScore : 0
  const tier = poolRatio >= DEFAULT_TIER_THRESHOLDS.focus
    ? 'focus'
    : poolRatio >= DEFAULT_TIER_THRESHOLDS.wait
      ? 'wait'
      : 'skip'
  const verdict = screenBySymbol.get(candidate.symbol) ?? null
  const rejectReasons = []
  if (!verdict) rejectReasons.push('missing-screen')
  if (verdict && !SCREEN_ALLOWED.has(verdict.candidateStatus)) rejectReasons.push(`screen-${verdict.candidateStatus}`)
  if (verdict && !(Number(verdict.score) >= SCREEN_MIN_SCORE)) rejectReasons.push(`screen-score-below-${SCREEN_MIN_SCORE}`)
  if (tier === 'skip') rejectReasons.push('pool-tier-below-wait')
  const northbound = attachNorthbound(candidate.symbol)
  return {
    symbol: candidate.symbol,
    label: candidate.label,
    market: candidate.market,
    tier,
    poolScore: result.score,
    poolMaxScore: result.maxScore,
    poolRatio: Math.round(poolRatio * 1000) / 1000,
    hits: result.hits,
    screenScore: verdict?.score ?? null,
    screenStatus: verdict?.candidateStatus ?? null,
    screenScoreStatus: verdict?.scoreStatus ?? null,
    screenReasons: verdict?.statusReasons ?? null,
    northbound,
    northboundMark: northbound.mark,
    eligible: rejectReasons.length === 0,
    rejectReasons,
  }
})

function byScore(left, right) {
  if (right.poolScore !== left.poolScore) return right.poolScore - left.poolScore
  return (right.screenScore ?? 0) - (left.screenScore ?? 0)
}

const eligible = merged.filter((row) => row.eligible)
let focus = eligible.filter((row) => row.tier === 'focus').sort(byScore).slice(0, PER_TIER)
let wait = eligible.filter((row) => row.tier === 'wait').sort(byScore).slice(0, PER_TIER)

// 某一档不足 5 只时，用另一档按分数补位，保证清单尽量满 10 只。
if (focus.length < PER_TIER) {
  const used = new Set(focus.map((row) => row.symbol))
  const fill = [...eligible]
    .filter((row) => row.tier === 'wait' && !used.has(row.symbol))
    .sort(byScore)
    .slice(0, PER_TIER - focus.length)
  wait = [...wait, ...fill].slice(0, PER_TIER)
}
if (wait.length < PER_TIER) {
  const used = new Set(wait.map((row) => row.symbol))
  const fill = [...eligible]
    .filter((row) => row.tier === 'focus' && !used.has(row.symbol))
    .sort(byScore)
    .slice(0, PER_TIER - wait.length)
  focus = [...focus, ...fill].slice(0, PER_TIER)
}

const selected = [
  ...focus.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || byScore(a, b)),
  ...wait.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || byScore(a, b)),
]

const byStatusAll = countBy(merged, (row) => row.screenStatus ?? '缺失')
const byTierAll = countBy(merged, (row) => row.tier)
const payload = {
  schemaVersion: 'recommendation.v2',
  generatedAt: new Date().toISOString(),
  sourcePoolGeneratedAt: pool.generatedAt,
  counts: {
    total: merged.length,
    screenRanked: (screen.ranked ?? []).length,
    eligible: eligible.length,
    selected: selected.length,
    byTierSelected: {
      observe: selected.filter((row) => row.tier === 'focus').length,
      wait: selected.filter((row) => row.tier === 'wait').length,
    },
    byStatusAll,
    byTierAll,
  },
  gate: {
    perTier: PER_TIER,
    screenMinScore: SCREEN_MIN_SCORE,
    allowedScreenStatus: [...SCREEN_ALLOWED],
    focusThreshold: DEFAULT_TIER_THRESHOLDS.focus,
    waitThreshold: DEFAULT_TIER_THRESHOLDS.wait,
  },
  logic:
    `默认输出 ${PER_TIER} 只观察档 + ${PER_TIER} 只等待档。` +
    `推荐档按 7 维加权：≥${Math.round(DEFAULT_TIER_THRESHOLDS.focus * 100)}% 为观察档，` +
    `${Math.round(DEFAULT_TIER_THRESHOLDS.wait * 100)}%~${Math.round(DEFAULT_TIER_THRESHOLDS.focus * 100)}% 为等待档；` +
    `筛选状态必须为观察/等待，且筛选分 ≥ ${SCREEN_MIN_SCORE}。` +
    '本阶段只做价量与筛选，不读取资金流；135 资金流只对最后 15 只执行。',
  northboundReference: {
    available: Boolean(northboundPayload),
    dataThrough: northboundPayload?.dataThrough ?? null,
    source: northboundPayload?.source ?? null,
    legend: '+ = 股东名单含香港中央结算（有北向持仓）；* = 当期净买入；只作参考，不参与选股评分。',
  },
  dimensions: pool.dimensions,
  rows: selected,
}

await mkdir(dirname(OUT_PATH), { recursive: true })
await writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(
  `集合推荐生成完毕：selected=${selected.length}（观察档 ${payload.counts.byTierSelected.observe} / 等待档 ${payload.counts.byTierSelected.wait}）/ ` +
    `eligible=${eligible.length} / total=${merged.length} / screen=${(screen.ranked ?? []).length}`,
)

// 4) 渲染页面
run([process.execPath, [join(ROOT, 'scripts', 'render-recommendation-page.mjs')]], '推荐页渲染')

function run([command, args], label, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.status !== 0) {
    console.error(`步骤「${label}」失败（退出码 ${result.status}）`)
    if (result.stderr) console.error(String(result.stderr).slice(0, 2000))
    process.exit(result.status ?? 1)
  }
  return options.capture ? result.stdout : ''
}

function attachNorthbound(symbol) {
  const mark = northboundPayload?.symbols?.[symbol]
  if (!mark) return { present: false, mark: '', direction: null, netAmount: null }
  return {
    present: true,
    mark: mark.direction === 'in' ? '+*' : '+',
    direction: mark.direction,
    netAmount: mark.netAmount ?? null,
    label: mark.label ?? null,
  }
}

function countBy(rows, keyOf) {
  const out = {}
  for (const row of rows) {
    const key = keyOf(row)
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}
