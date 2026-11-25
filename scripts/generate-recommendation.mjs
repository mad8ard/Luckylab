#!/usr/bin/env node
// 生成「集合推荐」：把推荐池（7 维排序）与筛选（门禁分）合并成一张 35 只的清单。
//
// 口径：
//   - 推荐档：推荐分 / 当前满分 ≥ 75% 为 focus（观察档），55%~75% 为 wait（等待档）
//   - 筛选门禁：状态必须是「观察」或「等待」，且筛选分 ≥ 50
//   - 默认保留 18 只观察档 + 17 只等待档；不足时由另一档补位
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
import { A_SHARE_FUNNEL } from '../src/domain/strategy-planning/funnelConfig.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const POOL_PATH = join(ROOT, 'src', 'data', 'recommended-pool-latest.json')
const OUT_PATH = join(ROOT, 'src', 'data', 'recommendation-latest.json')
const SCREEN_CLI = join(ROOT, '.agents', 'skills', 'china-stock-selection', 'scripts', 'screen-cn-stocks.mjs')

const FOCUS_LIMIT = A_SHARE_FUNNEL.firstStage.focus
const WAIT_LIMIT = A_SHARE_FUNNEL.firstStage.wait
const TARGET_TOTAL = A_SHARE_FUNNEL.firstStage.total
const SCREEN_MIN_SCORE = 50
const SCREEN_ALLOWED = new Set(['观察', '等待'])
const TIER_RANK = { focus: 0, wait: 1, skip: 2 }

// 1) 先跑推荐池生成器（它会写出 recommended-pool-latest.json）
run([process.execPath, [join(ROOT, 'scripts', 'generate-recommended-pool.mjs')]], '推荐池生成')

// 2) 再跑筛选，拿全池的门禁状态与筛选分
const screenOutput = run(
  [process.execPath, [SCREEN_CLI, '--market', 'A股', '--top', '400', '--format', 'json']],
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
    eligible: rejectReasons.length === 0,
    rejectReasons,
  }
})

function byScore(left, right) {
  if (right.poolScore !== left.poolScore) return right.poolScore - left.poolScore
  return (right.screenScore ?? 0) - (left.screenScore ?? 0)
}

const eligible = merged.filter((row) => row.eligible)
const focus = eligible.filter((row) => row.tier === 'focus').sort(byScore).slice(0, FOCUS_LIMIT)
const wait = eligible.filter((row) => row.tier === 'wait').sort(byScore).slice(0, WAIT_LIMIT)
const selected = [...focus, ...wait]

// 某一档不足时，从尚未入选的合格标的中按分数补位；每个 symbol 只出现一次。
if (selected.length < TARGET_TOTAL) {
  const used = new Set(selected.map((row) => row.symbol))
  const fill = [...eligible]
    .filter((row) => !used.has(row.symbol))
    .sort(byScore)
    .slice(0, TARGET_TOTAL - selected.length)
  selected.push(...fill)
}
selected.sort((left, right) => {
  const tierDiff = (TIER_RANK[left.tier] ?? 9) - (TIER_RANK[right.tier] ?? 9)
  return tierDiff || byScore(left, right)
})

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
    needsRefresh: byStatusAll['需刷新数据'] ?? 0,
    shortfall: Math.max(0, TARGET_TOTAL - selected.length),
    byTierSelected: {
      observe: selected.filter((row) => row.tier === 'focus').length,
      wait: selected.filter((row) => row.tier === 'wait').length,
    },
    byStatusAll,
    byTierAll,
  },
  gate: {
    focusLimit: FOCUS_LIMIT,
    waitLimit: WAIT_LIMIT,
    targetTotal: TARGET_TOTAL,
    screenMinScore: SCREEN_MIN_SCORE,
    allowedScreenStatus: [...SCREEN_ALLOWED],
    focusThreshold: DEFAULT_TIER_THRESHOLDS.focus,
    waitThreshold: DEFAULT_TIER_THRESHOLDS.wait,
  },
  logic:
    `默认输出 ${FOCUS_LIMIT} 只观察档 + ${WAIT_LIMIT} 只等待档（合计 ${TARGET_TOTAL} 只）。` +
    `推荐档按 7 维加权：≥${Math.round(DEFAULT_TIER_THRESHOLDS.focus * 100)}% 为观察档，` +
    `${Math.round(DEFAULT_TIER_THRESHOLDS.wait * 100)}%~${Math.round(DEFAULT_TIER_THRESHOLDS.focus * 100)}% 为等待档；` +
    `筛选状态必须为观察/等待，且筛选分 ≥ ${SCREEN_MIN_SCORE}。` +
    '每个 symbol 只出现一次；某档不足时从尚未入选的合格标的补位。' +
    `本阶段只做价量与筛选，不读取资金流；135 资金流只对最后 ${A_SHARE_FUNNEL.finalStage} 只执行。`,
  dimensions: pool.dimensions,
  rows: selected,
}

await mkdir(dirname(OUT_PATH), { recursive: true })
await writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(
  `集合推荐生成完毕：selected=${selected.length}（观察档 ${payload.counts.byTierSelected.observe} / 等待档 ${payload.counts.byTierSelected.wait}）/ ` +
    `eligible=${eligible.length} / total=${merged.length} / screen=${(screen.ranked ?? []).length} / needsRefresh=${payload.counts.needsRefresh}`,
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

function countBy(rows, keyOf) {
  const out = {}
  for (const row of rows) {
    const key = keyOf(row)
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}
