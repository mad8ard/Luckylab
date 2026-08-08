#!/usr/bin/env node
// 生成「今日推荐股票池」快照（v3 多维 + 半衰期 + 接飞刀豁免）

import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseCsvText } from '../src/domain/market-data/ohlcv.js'
import { buildMarketStatePath } from '../src/domain/market-data/cost.js'
import { computeKDJ } from '../src/domain/indicators/kdj.js'
import { computeRSI } from '../src/domain/indicators/rsi.js'
import { uniswapV3Inventory } from '../src/domain/formulas/lp.js'
import {
  buildScoreConfig,
  deriveRecommendedStockDecisionMetrics,
  generateRecommendedStockPool,
  regressionProbabilityFromZ,
} from '../src/domain/strategy-planning/recommendedStockPool.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const INDEX_PATH = join(ROOT, 'src', 'data', 'stock-index.json')
const DATA_DIR = join(ROOT, 'public', 'data')
const OUT_DIR = join(ROOT, 'src', 'data', 'recommended-pools')
const LATEST_PATH = join(ROOT, 'src', 'data', 'recommended-pool-latest.json')
const WHITELIST_PATH = join(ROOT, 'src', 'data', 'social-security-q1-whitelist.json')

const TOP_N = numberArg('--top', 10)
const RANGE_WIDTH = numberArg('--range-width', 0.10)
const LIQUIDITY = numberArg('--liquidity', 1)
const HISTORY_DAYS_1Y = numberArg('--history-days', 252)
const HISTORY_DAYS_3Y = HISTORY_DAYS_1Y * 3

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

async function main() {
  const indexRaw = await readFile(INDEX_PATH, 'utf8')
  const index = JSON.parse(indexRaw)
  if (!Array.isArray(index)) throw new Error('stock-index.json 不是数组')

  const csvSet = new Set((await readdir(DATA_DIR)).filter((f) => f.endsWith('.csv')))
  const whitelist = await loadWhitelist()

  const candidates = []
  let okCount = 0
  let skipCount = 0
  for (const entry of index) {
    const file = String(entry.url ?? '').replace(/^\/(?:data|datasets)\//, '')
    if (!file || !csvSet.has(file)) { skipCount += 1; continue }
    try {
      const text = await readFile(join(DATA_DIR, file), 'utf8')
      const rows = parseCsvText(text)
      if (rows.length < 60) { skipCount += 1; continue }

      const metrics = computeMetricsForRows(rows, entry, whitelist)
      if (!metrics) { skipCount += 1; continue }
      const derivedMetrics = deriveRecommendedStockDecisionMetrics(metrics)
      candidates.push({
        symbol: entry.symbol,
        label: entry.label,
        market: entry.market,
        metrics: { ...metrics, ...derivedMetrics },
      })
      okCount += 1
    } catch (err) {
      skipCount += 1
      console.warn(`  [warn] ${entry.symbol}: ${err.message}`)
    }
  }

  const generatedAt = new Date().toISOString()
  const dimensions = buildScoreConfig()
  const pool = generateRecommendedStockPool(candidates, {
    topN: TOP_N,
    generatedAt,
    dimensions,
  })

  await mkdir(OUT_DIR, { recursive: true })
  const datedPath = join(OUT_DIR, `stock-pool-${pool.generatedDate}.json`)

  const payload = {
    ...pool,
    parameters: {
      topN: TOP_N,
      rangeWidth: RANGE_WIDTH,
      liquidity: LIQUIDITY,
      historyDays1y: HISTORY_DAYS_1Y,
      historyDays3y: HISTORY_DAYS_3Y,
    },
    counts: {
      indexEntries: index.length,
      processed: okCount,
      skipped: skipCount,
      whitelistEntries: whitelist.size,
    },
  }

  // 把所有候选（包含未入选的）也保留一份，让前端能在调权重后重新排序
  payload.candidatesAll = candidates.map((c) => ({
    symbol: c.symbol,
    label: c.label,
    market: c.market,
    metrics: c.metrics,
  }))

  await writeFile(datedPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await writeFile(LATEST_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  console.log(
    `推荐股票池生成完毕：focus=${pool.focusItems.length} / wait=${pool.waitItems.length}，` +
    `processed=${okCount}, skipped=${skipCount}, whitelist=${whitelist.size}, dated=${datedPath}`,
  )
}

async function loadWhitelist() {
  try {
    const text = await readFile(WHITELIST_PATH, 'utf8')
    const data = JSON.parse(text)
    const set = new Set()
    if (Array.isArray(data?.symbols)) for (const s of data.symbols) set.add(String(s).trim())
    return set
  } catch {
    return new Set()
  }
}

function computeMetricsForRows(rows, entry, whitelist) {
  const market = entry.market
  const tdpy = inferTdpy(market)
  const last = rows.at(-1)
  if (!last) return null

  const marketStatePath = buildMarketStatePath(rows, tdpy)
  const lastMarket = marketStatePath.at(-1)
  if (!lastMarket) return null

  const kdj = computeKDJ(rows).at(-1)
  const rsi = computeRSI(rows).at(-1)

  // 1 年 lpValue 序列 → 当前百分位
  const lpValues1y = collectLpValues(rows, marketStatePath, HISTORY_DAYS_1Y)
  // 3 年 lpValue 序列 → max/min 比值
  const lpValues3y = collectLpValues(rows, marketStatePath, HISTORY_DAYS_3Y)

  const currentLp = computeLpAt({ price: last.close, anchor: lastMarket.costAnchor })
  if (!currentLp) return null

  const lpValuePercentile = lpValues1y.length >= 30
    ? percentileOf(lpValues1y, currentLp.value)
    : null

  const lpRatio3y = lpValues3y.length >= 60
    ? Math.max(...lpValues3y) / Math.max(Math.min(...lpValues3y), 1e-12)
    : null

  // z 值
  const halfWidth = lastMarket.costHigh > lastMarket.costAnchor
    ? lastMarket.costHigh - lastMarket.costAnchor
    : (lastMarket.costLow < lastMarket.costAnchor ? lastMarket.costAnchor - lastMarket.costLow : null)
  const zScore = halfWidth && halfWidth > 0
    ? (last.close - lastMarket.costAnchor) / halfWidth
    : null
  const regressionProbability = zScore !== null ? regressionProbabilityFromZ(zScore) : null

  // costDistance 序列（用于半衰期）
  const distSeries = []
  const distStart = Math.max(0, marketStatePath.length - HISTORY_DAYS_1Y)
  for (let i = distStart; i < marketStatePath.length; i += 1) {
    const ms = marketStatePath[i]
    if (Number.isFinite(ms?.costDistance)) distSeries.push(ms.costDistance)
  }

  return {
    price: last.close,
    costAnchor: lastMarket.costAnchor,
    costLow: lastMarket.costLow,
    costHigh: lastMarket.costHigh,
    costDistance: lastMarket.costDistance,
    costSlope5: lastMarket.costSlope5,
    annualVol: lastMarket.annualVol,
    j: kdj?.j ?? null,
    rsi: rsi?.raw ?? null,
    lpZone: currentLp.zone,
    lpValue: currentLp.value,
    lpValuePercentile,
    lpValueMin1y: lpValues1y.length ? Math.min(...lpValues1y) : null,
    lpValueMax1y: lpValues1y.length ? Math.max(...lpValues1y) : null,
    lpValueRatio3y: lpRatio3y,
    zScore,
    regressionProbability,
    anchorDirection: directionOfSlope(lastMarket.costSlope5),
    costDistanceSeries: distSeries,
    tradingDays: distSeries.length,
    tradingDaysPerYear: tdpy,
    socialSecurityWhitelisted: whitelist.has(entry.symbol),
    observationDate: last.date,
  }
}

function collectLpValues(rows, marketStatePath, historyLen) {
  const start = Math.max(0, marketStatePath.length - historyLen)
  const out = []
  for (let i = start; i < marketStatePath.length; i += 1) {
    const ms = marketStatePath[i]
    const row = rows[i]
    if (!ms || !row) continue
    const lp = computeLpAt({ price: row.close, anchor: ms.costAnchor })
    if (lp && Number.isFinite(lp.value) && lp.value > 0) out.push(lp.value)
  }
  return out
}

function computeLpAt({ price, anchor }) {
  if (![price, anchor].every((v) => Number.isFinite(v) && v > 0)) return null
  const lower = anchor * (1 - RANGE_WIDTH)
  const upper = anchor * (1 + RANGE_WIDTH)
  if (lower <= 0 || upper <= lower) return null
  const inv = uniswapV3Inventory({ markPrice: price, lowerPrice: lower, upperPrice: upper, liquidity: LIQUIDITY })
  if (!inv) return null
  return { value: inv.value, zone: inv.zone }
}

function percentileOf(series, value) {
  if (!series.length || !Number.isFinite(value)) return null
  let count = 0
  for (const v of series) if (v <= value) count += 1
  return count / series.length
}

function directionOfSlope(slope) {
  if (!Number.isFinite(slope)) return null
  if (slope >= 0.003) return 'up'
  if (slope <= -0.003) return 'down'
  return 'flat'
}

function inferTdpy(market) {
  return 252
}

function numberArg(name, fallback) {
  const idx = process.argv.indexOf(name)
  if (idx < 0) return fallback
  const value = Number(process.argv[idx + 1])
  return Number.isFinite(value) && value > 0 ? value : fallback
}
