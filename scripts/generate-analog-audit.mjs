#!/usr/bin/env node
// 对 50 只推荐候选做历史相似节点审核。
//
// 变体：
//   sameStock        同股历史
//   sameStockRegime  同股 + 市场 regime 距离惩罚
//   crossSectional   全池横截面 + regime（排除目标股票自身）
//
// 历史块评分（60）：目标先于止损 30 + MAE 20 + 10 日收益 10。
// 当前资金流 30；样本置信 10。
// 60%/70% 截止点用于设计，80% 截止点用于独立验证；主变体只按设计集选择。

import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseCsvText } from '../src/domain/market-data/ohlcv.js'
import { inferTdpy } from '../src/domain/market-data/tdpy.js'
import {
  ANALOG_DEFAULTS,
  ANALOG_FEATURE_SPECS,
  buildAnalogFeatureSeries,
  scoreAnalogAudit,
  summarizeAnalogs,
} from '../src/domain/strategy-planning/analogAudit.js'
import {
  buildRegimeMap,
  choosePrimaryVariant,
  createVariantMatchers,
  validateVariants,
} from '../src/domain/strategy-planning/analogVariants.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CANDIDATES_PATH = join(ROOT, 'src', 'data', 'recommendation-latest.json')
const INDEX_PATH = join(ROOT, 'src', 'data', 'stock-index.json')
const DATA_DIR = join(ROOT, 'public', 'data')
const REGIME_PATH = join(ROOT, 'src', 'data', 'market-regime', 'market-regime-raw-latest.json')
const OUT_DIR = join(ROOT, 'src', 'data', 'analog-audits')
const LATEST_PATH = join(ROOT, 'src', 'data', 'analog-audit-latest.json')
const VARIANTS = ['sameStock', 'sameStockRegime', 'crossSectional']

const args = parseArgs(process.argv.slice(2))
const candidatesPayload = JSON.parse(await readFile(CANDIDATES_PATH, 'utf8'))
const index = JSON.parse(await readFile(INDEX_PATH, 'utf8'))
const bySymbol = new Map(index.map((entry) => [entry.symbol, entry]))
const candidates = Array.isArray(candidatesPayload.rows) ? candidatesPayload.rows : []

const regimePayload = await readJson(REGIME_PATH)
const regimeRows = regimePayload?.indices?.sh000001?.rows ?? []
const regimeByDate = buildRegimeMap(regimeRows)
const regimeDataThrough = regimeRows.at(-1)?.date ?? null

const config = {
  topK: positiveInt(args['--top'], ANALOG_DEFAULTS.topK),
  minGap: positiveInt(args['--min-gap'], ANALOG_DEFAULTS.minGap),
  minForward: positiveInt(args['--min-forward'], ANALOG_DEFAULTS.minForward),
  minAnalogs: ANALOG_DEFAULTS.minAnalogs,
  maxPerSource: positiveInt(args['--max-per-source'], 2),
  featureSpecs: ANALOG_FEATURE_SPECS,
  scoreWeights: { historicalPath: 0.9, sampleConfidence: 0.1 },
  historicalComponents: { targetFirst: 10, mae20d: 40, return10d: 10 },
  validation: { designFractions: [0.6, 0.7], testFractions: [0.8] },
}

const stocks = []
const failures = []
for (const candidate of candidates) {
  const entry = bySymbol.get(candidate.symbol)
  if (!entry) {
    failures.push({ symbol: candidate.symbol, label: candidate.label, error: 'missing-index-entry' })
    continue
  }
  try {
    const rows = parseCsvText(await readFile(join(DATA_DIR, String(entry.url ?? '').split('/').at(-1)), 'utf8'))
    if (rows.length < 80) {
      failures.push({ symbol: candidate.symbol, label: candidate.label, error: 'insufficient-rows', rows: rows.length })
      continue
    }
    const tdpy = inferTdpy(entry).value
    const { series } = buildAnalogFeatureSeries(rows, { tdpy, regimeByDate })
    stocks.push({ ...candidate, rows, series, tdpy })
  } catch (error) {
    failures.push({ symbol: candidate.symbol, label: candidate.label, error: String(error?.message ?? error) })
  }
}
console.log(`载入 ${stocks.length}/${candidates.length} 只候选；regime=${regimeByDate.size} 个交易日`)

const matchers = createVariantMatchers(stocks)
console.log('开始变体验证：同股 / 同股+regime / 全池+regime')
const variantValidation = validateVariants(stocks, {
  ...ANALOG_DEFAULTS,
  topK: config.topK,
  minGap: config.minGap,
  minForward: config.minForward,
  matchers,
})
const variantDesignChoice = choosePrimaryVariant(variantValidation)
const primaryVariant = 'sameStock'
console.log(`第二段回放 50→30：sameStock 路径（目标10/MAE40/10日10），不读取资金流；设计集原本会选 ${variantDesignChoice}`)

const audited = []
for (const stock of stocks) {
  const currentIndex = stock.rows.length - 1
  const variants = {}
  for (const name of VARIANTS) {
    const analogs = matchers[name](stock, currentIndex, config)
    const stats = summarizeAnalogs(analogs, stock.rows)
    const audit = scoreAnalogAudit({
      stats,
      sampleConfidence: stats.sampleConfidence,
    })
    variants[name] = {
      stats: publicStats(stats),
      audit,
      topAnalogs: stats.analogs.slice(0, 10).map((analog) => ({
        date: analog.date,
        sourceSymbol: analog.sourceSymbol ?? stock.symbol,
        entryDate: analog.entryDate,
        distance: analog.distance,
        similarity: analog.similarity,
        recency: analog.recency,
        weight: round(analog.weight, 4),
        fwd5Pct: analog.fwd5Pct,
        fwd10Pct: analog.fwd10Pct,
        fwd20Pct: analog.fwd20Pct,
        fwd60Pct: analog.fwd60Pct,
        mae20Pct: analog.mae20Pct,
        outcome: analog.outcome,
      })),
    }
  }
  const primary = variants[primaryVariant] ?? variants.sameStock
  audited.push({
    symbol: stock.symbol,
    label: stock.label,
    market: stock.market,
    tier: stock.tier,
    poolScore: stock.poolScore,
    poolMaxScore: stock.poolMaxScore,
    screenScore: stock.screenScore,
    northbound: stock.northbound ?? null,
    northboundMark: stock.northbound?.mark ?? '',
    currentDate: stock.rows.at(-1).date,
    currentFeatures: stock.series.at(-1),
    primaryVariant,
    stats: primary.stats,
    audit: primary.audit,
    topAnalogs: primary.topAnalogs,
    targetAnalogs: variants.sameStock.topAnalogs,
    riskAnalogs: variants.sameStock.topAnalogs,
    variants: Object.fromEntries(VARIANTS.map((name) => [name, {
      stats: variants[name].stats,
      audit: variants[name].audit,
      topAnalogs: variants[name].topAnalogs,
    }])),
  })
}

audited.sort((left, right) => {
  const leftScore = Number.isFinite(left.audit.auditScore) ? left.audit.auditScore : -1
  const rightScore = Number.isFinite(right.audit.auditScore) ? right.audit.auditScore : -1
  return rightScore - leftScore || (right.poolScore ?? 0) - (left.poolScore ?? 0)
})
audited.forEach((item, index) => {
  item.auditRank = index + 1
  item.stage2Rank = index + 1
  item.stage2Selected = index < 30
})

const generatedAt = new Date().toISOString()
const primaryValidation = variantValidation[primaryVariant] ?? variantValidation.sameStock
const payload = {
  schemaVersion: 'analog-audit.v2',
  generatedAt,
  sourceCandidatesGeneratedAt: candidatesPayload.generatedAt ?? null,
  sourceDataThrough: audited.map((item) => item.currentDate).filter(Boolean).sort().at(-1) ?? null,
  regimeDataThrough,
  source: 'local daily OHLCV; prefix-causal cost anchor / deviation / synthetic geometry; SH000001 regime',
  semantics: '历史相似节点是研究样本，不是胜率承诺；当前资金流只做当前确认，不进入历史回测。',
  config: { ...config, designVariant: primaryVariant, variantDesignChoice },
  counts: {
    candidates: candidates.length,
    audited: audited.length,
    scored: audited.filter((item) => item.audit.status === 'ok').length,
    stage2Selected: Math.min(30, audited.length),
    insufficient: audited.filter((item) => item.audit.status !== 'ok').length,
    failures: failures.length,
    regimeDays: regimeByDate.size,
  },
  stage: 'replay-30',
  primaryVariant,
  variantValidation,
  validation: primaryValidation?.test ?? null,
  rows: audited,
  failures,
}

await mkdir(OUT_DIR, { recursive: true })
const datedPath = join(OUT_DIR, `analog-audit-${generatedAt.slice(0, 10)}.json`)
const body = `${JSON.stringify(payload, null, 2)}\n`
await writeFile(datedPath, body, 'utf8')
await writeFile(LATEST_PATH, body, 'utf8')

console.log(`历史相似节点审核完成：audited=${audited.length}/${candidates.length} / scored=${payload.counts.scored} / primary=${primaryVariant}`)
for (const name of VARIANTS) {
  const design = variantValidation[name]?.design
  const test = variantValidation[name]?.test
  console.log(`  ${name}: design target=${fmt(design?.targetRankCorrelation)} mae=${fmt(design?.maeRankCorrelation)} fwd10=${fmt(design?.fwd10RankCorrelation)} path=${fmt(design?.pathRankCorrelation)} | test target=${fmt(test?.targetRankCorrelation)} mae=${fmt(test?.maeRankCorrelation)} fwd10=${fmt(test?.fwd10RankCorrelation)} path=${fmt(test?.pathRankCorrelation)}`)
}
console.log(`  ${datedPath}`)
console.log(`  ${LATEST_PATH}`)

const rendered = spawnSync(process.execPath, [join(ROOT, 'scripts', 'render-analog-audit-page.mjs')], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: 'inherit',
})
if (rendered.status !== 0) process.exit(rendered.status ?? 1)

function publicStats(stats) {
  return {
    count: stats.count,
    crossCount: stats.crossCount ?? null,
    effectiveCount: stats.effectiveCount,
    fwd5: stats.fwd5,
    fwd10: stats.fwd10,
    fwd20: stats.fwd20,
    fwd60: stats.fwd60,
    mae20: stats.mae20,
    targetFirstRate: stats.targetFirstRate,
    avgSimilarity: stats.avgSimilarity,
    sampleConfidence: stats.sampleConfidence,
    fwd10MedianPct: stats.fwd10MedianPct,
    fwd20MedianPct: stats.fwd20MedianPct,
    winRate20Pct: stats.winRate20Pct,
    mae20MedianPct: stats.mae20MedianPct,
    mae20TailPct: stats.mae20TailPct,
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function parseArgs(argv) {
  const out = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    out[token] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : 'true'
  }
  return out
}

function positiveInt(value, fallback) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : fallback
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function fmt(value) {
  return Number.isFinite(value) ? Number(value).toFixed(3) : '—'
}
