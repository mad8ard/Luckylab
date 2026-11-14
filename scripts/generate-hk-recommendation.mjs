#!/usr/bin/env node
// 港股独立推荐：只使用港股日线 OHLCV，不复用 A 股四段漏斗。

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseCsvText } from '../src/domain/market-data/ohlcv.js'
import {
  HK_RECOMMENDATION_GATES,
  HK_RECOMMENDATION_WEIGHTS,
  rankHongKongCandidates,
} from '../src/domain/strategy-planning/hongKongRecommendation.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const INDEX_PATH = join(ROOT, 'src', 'data', 'stock-index.json')
const DATA_DIR = join(ROOT, 'public', 'data')
const OUT_DIR = join(ROOT, 'src', 'data', 'hong-kong-recommendations')
const LATEST_PATH = join(ROOT, 'src', 'data', 'hong-kong-recommendation-latest.json')
const TOP_N = 3

const index = JSON.parse(await readFile(INDEX_PATH, 'utf8'))
const hkEntries = index.filter((entry) => entry.market === '港股')
const records = []
const failures = []
for (const entry of hkEntries) {
  try {
    const fileName = String(entry.url ?? '').split('/').at(-1)
    const rows = parseCsvText(await readFile(join(DATA_DIR, fileName), 'utf8'))
    records.push({ entry, rows })
  } catch (error) {
    failures.push({
      symbol: entry.symbol,
      label: entry.label,
      reason: String(error?.message ?? error),
    })
  }
}

const generatedAt = new Date().toISOString()
const asOfDate = generatedAt.slice(0, 10)
const ranked = rankHongKongCandidates(records, {
  asOfDate,
  limit: TOP_N,
})
const excluded = ranked.evaluated
  .filter((item) => !item.eligible)
  .map((item) => ({
    symbol: item.symbol,
    label: item.label,
    reasons: item.gateReasons,
    metrics: item.metrics,
  }))
const dataThrough = records
  .map((record) => record.rows.at(-1)?.date)
  .filter(Boolean)
  .sort()
  .at(-1)

const payload = {
  schemaVersion: 'hong-kong-recommendation.v1',
  market: '港股',
  generatedAt,
  asOfDate,
  dataThrough,
  inputScope: {
    available: ['复权日线 OHLCV', '成交量'],
    unavailable: ['港股财报统一比较', '南向资金', '研报/公告即时评分', '估值与行业景气度'],
  },
  weights: HK_RECOMMENDATION_WEIGHTS,
  gates: HK_RECOMMENDATION_GATES,
  counts: {
    indexed: hkEntries.length,
    loaded: records.length,
    evaluated: ranked.evaluated.length,
    eligible: ranked.eligibleCount,
    selected: ranked.items.length,
    excluded: excluded.length,
    failures: failures.length,
  },
  logic:
    '港股独立研究排序：低位程度、成本锚偏离、回撤修复、成本锚趋势、20日动量、量能和数据质量加权；' +
    '先排除数据陈旧、波动过高、成本锚仍深跌、动量为负过度或价格明显高于成本锚的标的。只展示前3名。',
  claimClass: 'research-ranking-not-trade-advice',
  items: ranked.items,
  exclusions: excluded,
  failures,
}

await mkdir(OUT_DIR, { recursive: true })
const datedPath = join(OUT_DIR, `hk-recommendation-${asOfDate}.json`)
const body = `${JSON.stringify(payload, null, 2)}\n`
await writeFile(datedPath, body, 'utf8')
await writeFile(LATEST_PATH, body, 'utf8')

console.log(
  `港股独立推荐生成完毕：selected=${ranked.items.length} / eligible=${ranked.eligibleCount} / ` +
    `evaluated=${ranked.evaluated.length} / excluded=${excluded.length} / failures=${failures.length}`,
)
console.log(`  ${datedPath}`)
console.log(`  ${LATEST_PATH}`)
