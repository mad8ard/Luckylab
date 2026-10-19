#!/usr/bin/env node
// 由大盘原始数据算出趋势分层与总分。
//
// 关键约束：
//   - 指数趋势复用项目 domain 的 buildMarketStatePath（成本锚/成本带/斜率），
//     不新写一套均线口径 —— 这与 SKILL.md 禁用 MA/EMA 的纪律一致。
//   - 所有指标先归一到 0-1，再按权重合成分组，再按分组权重合成总分。
//   - 总分只描述"当下偏多程度"，不预测后市。

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildMarketStatePath } from '../src/domain/market-data/cost.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT_DIR = join(ROOT, 'src', 'data', 'market-regime')
const RAW_PATH = join(OUT_DIR, 'market-regime-raw-latest.json')
const LATEST_PATH = join(OUT_DIR, 'market-regime-latest.json')
const BREADTH_HISTORY_PATH = join(OUT_DIR, 'breadth-history.jsonl')

const SCHEMA_VERSION = 'market-regime.v1'
const TDPY = 242
const LOOKBACK_SESSIONS = TDPY * 5
const AMOUNT_UNIT = 1e5 // 腾讯指数 amount 口径为千元，除以 1e5 得亿元

// 用户指定：资金权重 35%，其余三项平分剩余
const FUNDING_WEIGHT = 0.35
const EVEN_WEIGHT = (1 - FUNDING_WEIGHT) / 3
export const WEIGHTS = { momentum: EVEN_WEIGHT, breadth: EVEN_WEIGHT, volume: EVEN_WEIGHT, funding: FUNDING_WEIGHT }

const INDEX_TDPY = TDPY

const raw = JSON.parse(await readFile(RAW_PATH, 'utf8'))
const breadthHistory = await readBreadthHistory()
const payload = buildPayload(raw, breadthHistory)

await mkdir(OUT_DIR, { recursive: true })
const body = `${JSON.stringify(payload, null, 2)}\n`
await writeFile(LATEST_PATH, body, 'utf8')
if (payload.asOfDate) await writeFile(join(OUT_DIR, `market-regime-${payload.asOfDate}.json`), body, 'utf8')

console.log(`大盘趋势算出：总分 ${payload.total.score} → ${payload.total.label}（asOf ${payload.asOfDate}）`)
for (const group of payload.groups) {
  console.log(`  ${group.label.padEnd(6, ' ')} 权重 ${(group.weight * 100).toFixed(1)}%  得分 ${(group.score * 100).toFixed(1)}`)
}

function buildPayload(source, history) {
  const indexPanel = buildIndexPanel(source.indices)
  const breadthGroup = buildBreadthGroup(source.breadth, history)
  const volumeGroup = buildVolumeGroup(source.indices)
  const fundingGroup = buildFundingGroup(source.margin)

  const groups = [
    { id: 'momentum', label: '动量', weight: WEIGHTS.momentum, ...buildMomentumGroup(indexPanel) },
    { id: 'breadth', label: '宽度', weight: WEIGHTS.breadth, ...breadthGroup },
    { id: 'volume', label: '量能', weight: WEIGHTS.volume, ...volumeGroup },
    { id: 'funding', label: '资金', weight: WEIGHTS.funding, ...fundingGroup },
  ]

  const scored = groups.filter((group) => Number.isFinite(group.score))
  const weightSum = scored.reduce((sum, group) => sum + group.weight, 0)
  const totalScore = weightSum > 0 ? scored.reduce((sum, group) => sum + group.score * group.weight, 0) / weightSum : null
  const asOfDate = latestDate(indexPanel.map((item) => item.asOf).filter(Boolean)) ?? String(source.generatedAt ?? '').slice(0, 10)

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: source.generatedAt,
    computedAt: new Date().toISOString(),
    asOfDate,
    sourceSchemaVersion: source.schemaVersion,
    weights: WEIGHTS,
    total: {
      score: round1(totalScore === null ? null : totalScore * 100),
      label: labelFor(totalScore),
      interpretation:
        '总分是各分组归一化指标按权重的加权和，描述当下市场的偏多程度；它不预测后市，也不构成交易信号。',
      scaledBy: `${scored.length}/${groups.length} 个分组参与计分`,
    },
    groups: groups.map((group) => ({
      id: group.id,
      label: group.label,
      weight: group.weight,
      score: round4(group.score),
      scorePct: round1(group.score === null ? null : group.score * 100),
      metrics: group.metrics,
    })),
    indexPanel,
    breadth: source.breadth,
    breadthHistory: history.summary,
    fundingDetail: {
      marginLatestDate: latestDate((source.margin ?? []).map((row) => row.date)),
    },
    disclosures: buildDisclosures(source, history),
    failures: source.failures ?? [],
    provenance: {
      raw: 'src/data/market-regime/market-regime-raw-latest.json',
      indexEndpoints: ['stock_zh_index_daily_tx', 'stock_zh_index_daily'],
      breadthEndpoint: 'stock_market_activity_legu',
      marginEndpoint: 'stock_margin_account_info',
      costModel: 'src/domain/market-data/cost.js#buildMarketStatePath',
      tradingDaysPerYear: TDPY,
      lookbackSessions: LOOKBACK_SESSIONS,
      amountUnitNote: `腾讯指数 amount 按千元处理，页面展示时除以 1e5 换算为亿元（AMOUNT_UNIT=${AMOUNT_UNIT}）`,
    },
  }
}

function buildIndexPanel(indices) {
  return Object.entries(indices ?? {})
    .filter(([, item]) => Array.isArray(item?.rows) && item.rows.length > LOOKBACK_SESSIONS / 10)
    .map(([symbol, item]) => {
      const rows = item.rows.map((row) => ({
        date: row.date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: Number.isFinite(row.amount) && row.amount > 0 ? row.amount : 1,
      }))
      const path = buildMarketStatePath(rows, INDEX_TDPY)
      const last = path.at(-1)
      const row = rows.at(-1)
      const amountSeries = rows.map((entry) => entry.volume).filter(Number.isFinite)
      return {
        symbol,
        label: item.label,
        role: item.role,
        asOf: row?.date ?? null,
        close: round4(row?.close),
        costAnchor: round4(last?.costAnchor),
        costLow: round4(last?.costLow),
        costHigh: round4(last?.costHigh),
        costDistancePct: round2(Number.isFinite(last?.costDistance) ? last.costDistance * 100 : null),
        costSlopePct: round2(Number.isFinite(last?.costSlopeRecent) ? last.costSlopeRecent * 100 : null),
        annualVolPct: round2(Number.isFinite(last?.annualVol) ? last.annualVol * 100 : null),
        aboveAnchor: Number.isFinite(last?.costAnchor) && Number.isFinite(row?.close) ? row.close > last.costAnchor : null,
        anchorSlopeUp: Number.isFinite(last?.costSlopeRecent) ? last.costSlopeRecent > 0 : null,
        amountYi: Number.isFinite(row?.volume) ? round1(row.volume / AMOUNT_UNIT) : null,
        amountPercentile5y: round4(percentileOf(amountSeries.slice(-LOOKBACK_SESSIONS), row?.volume)),
        rows: rows.length,
      }
    })
}

function buildMomentumGroup(indexPanel) {
  const panel = indexPanel.filter((item) => item.role === 'panel')
  const above = panel.map((item) => item.aboveAnchor).filter((value) => typeof value === 'boolean')
  const slope = panel.map((item) => item.anchorSlopeUp).filter((value) => typeof value === 'boolean')
  const aboveShare = above.length ? above.filter(Boolean).length / above.length : null
  const slopeShare = slope.length ? slope.filter(Boolean).length / slope.length : null
  return {
    score: mean([aboveShare, slopeShare].filter(Number.isFinite)),
    metrics: [
      metric('aboveAnchorShare', '收盘价在成本锚上方', aboveShare, `${above.filter(Boolean).length}/${above.length} 个指数`, '指数收盘价高于自身成本锚的比例。成本锚在这里替代均线，锚上方＝结构未破。'),
      metric('anchorSlopeUpShare', '成本锚斜率为正', slopeShare, `${slope.filter(Boolean).length}/${slope.length} 个指数`, '成本锚近期斜率向上的指数比例。锚本身在下移时，价格反弹通常只是修复。'),
    ],
  }
}

function buildBreadthGroup(breadth, history) {
  const up = num(breadth?.['上涨'])
  const down = num(breadth?.['下跌'])
  const limitUp = num(breadth?.['涨停'])
  const limitDown = num(breadth?.['跌停'])
  const activity = num(breadth?.['活跃度'])
  const advanceRatio = up !== null && down !== null && up + down > 0 ? up / (up + down) : null
  const limitBalance = limitUp !== null && limitDown !== null && limitUp + limitDown > 0 ? limitUp / (limitUp + limitDown) : null
  const activityRatio = Number.isFinite(activity) ? (activity > 1 ? activity / 100 : activity) : null
  return {
    score: mean([advanceRatio, limitBalance, activityRatio].filter(Number.isFinite)),
    metrics: [
      metric('advanceRatio', '上涨家数占比', advanceRatio, up !== null && down !== null ? `${up} 涨 / ${down} 跌` : '—', '全市场上涨家数占涨跌家数之和的比例。'),
      metric('limitBalance', '涨停相对跌停', limitBalance, limitUp !== null && limitDown !== null ? `${limitUp} 涨停 / ${limitDown} 跌停` : '—', '涨停家数占涨跌停家数之和的比例。A 股情绪最直接的温度计。'),
      metric('activityRatio', '市场活跃度', activityRatio, Number.isFinite(activity) ? `${activity}%` : '—', '上游给出的全市场活跃度百分比。'),
    ],
    note: history.summary?.samples > 1 ? `宽度历史已本地累积 ${history.summary.samples} 个交易日。` : '宽度接口只给当日快照，历史分位需要本地逐日累积。',
  }
}

function buildVolumeGroup(indices) {
  const sh = indices?.sh000001?.rows ?? []
  const sz = indices?.sz399106?.rows ?? []
  const byDate = new Map()
  for (const row of sh) if (Number.isFinite(row.amount)) byDate.set(row.date, Number(row.amount))
  for (const row of sz) {
    if (!Number.isFinite(row.amount)) continue
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + Number(row.amount))
  }
  const series = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const amounts = series.map(([, value]) => value)
  const latest = amounts.at(-1) ?? null
  const mean5 = amounts.length >= 5 ? mean(amounts.slice(-5)) : null
  const mean60 = amounts.length >= 60 ? mean(amounts.slice(-60)) : null
  const expansion = Number.isFinite(mean5) && Number.isFinite(mean60) && mean60 > 0 ? mean5 / mean60 : null
  const expansionSeries = []
  for (let index = 60; index <= amounts.length; index += 1) {
    const fast = mean(amounts.slice(index - 5, index))
    const slow = mean(amounts.slice(index - 60, index))
    if (Number.isFinite(fast) && Number.isFinite(slow) && slow > 0) expansionSeries.push(fast / slow)
  }
  const turnoverPercentile = percentileOf(amounts.slice(-LOOKBACK_SESSIONS), latest)
  const expansionPercentile = percentileOf(expansionSeries.slice(-LOOKBACK_SESSIONS), expansion)
  return {
    score: mean([turnoverPercentile, expansionPercentile].filter(Number.isFinite)),
    metrics: [
      metric('turnoverPercentile5y', '全市场成交额 5 年分位', turnoverPercentile, Number.isFinite(latest) ? `${round1(latest / AMOUNT_UNIT / 10000)} 万亿` : '—', '沪深两市成交额在最近 5 年（约 1215 个交易日）中的百分位。这是活跃度，不是换手率。'),
      metric('amountExpansionPercentile', '近 5 日 / 近 60 日放量分位', expansionPercentile, Number.isFinite(expansion) ? `${round2(expansion)} ×` : '—', '短期成交额相对中期均值的倍数，及其在历史中的分位。'),
    ],
    note: '量能组度量的是市场活跃度高低，本身不含方向：放量既可能是趋势确认，也可能是恐慌抛售。',
  }
}

function buildFundingGroup(margin) {
  const rows = (margin ?? []).filter((row) => Number.isFinite(row.financing))
  const balances = rows.map((row) => row.financing)
  const latest = balances.at(-1) ?? null
  const change20 = balances.length > 20 && balances.at(-21) > 0 ? latest / balances.at(-21) - 1 : null
  const changeSeries = []
  for (let index = 20; index < balances.length; index += 1) {
    const base = balances[index - 20]
    if (base > 0) changeSeries.push(balances[index] / base - 1)
  }
  const balancePercentile = percentileOf(balances.slice(-LOOKBACK_SESSIONS), latest)
  const changePercentile = percentileOf(changeSeries.slice(-LOOKBACK_SESSIONS), change20)
  return {
    score: mean([balancePercentile, changePercentile].filter(Number.isFinite)),
    metrics: [
      metric('marginBalancePercentile5y', '两融余额 5 年分位', balancePercentile, Number.isFinite(latest) ? `${round0(latest)} 亿` : '—', '融资余额在最近 5 年中的百分位。杠杆水位越高，市场对回撤越敏感。'),
      metric('marginChange20dPercentile', '两融余额 20 日变化分位', changePercentile, Number.isFinite(change20) ? `${round2(change20 * 100)}%` : '—', '融资余额 20 个交易日的变动率，及其历史分位。'),
    ],
  }
}

function buildDisclosures(source, history) {
  const list = [
    '换手率：全市场换手率需要流通市值，而提供该字段的东财接口（stock_zh_a_spot_em / index_zh_a_hist 等 push2 系）在当前 AkShare 版本下不可用，因此本页用成交额分位替代，并明确标注它不是换手率。',
    '大盘资金流与板块资金流：stock_market_fund_flow 与 stock_sector_fund_flow_rank 同属东财 push2 系，本轮实测均失败，未纳入。',
    `宽度历史：上游只给当日快照，本地已累积 ${history.summary?.samples ?? 0} 个交易日；样本越多，宽度分位越可靠。`,
    '总分口径：各组指标先归一到 0-1，再按权重加权。它不是预测，也不构成交易建议。',
  ]
  if (Array.isArray(source.failures) && source.failures.length) {
    list.push(`本次有 ${source.failures.length} 个数据源失败，详见「数据源状态」。`)
  }
  return list
}

function metric(id, label, value, display, note) {
  return {
    id,
    label,
    value: round4(value),
    valuePct: round1(value === null ? null : value * 100),
    display: display ?? '—',
    note,
  }
}

async function readBreadthHistory() {
  const summary = { samples: 0, firstDate: null, lastDate: null }
  try {
    const text = await readFile(BREADTH_HISTORY_PATH, 'utf8')
    const rows = text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    summary.samples = rows.length
    summary.firstDate = rows[0]?.date ?? null
    summary.lastDate = rows.at(-1)?.date ?? null
  } catch {
    // 首次运行时历史文件还不存在
  }
  return { summary }
}

function labelFor(score) {
  if (!Number.isFinite(score)) return '数据不足'
  if (score >= 0.7) return '偏多'
  if (score >= 0.55) return '偏多震荡'
  if (score >= 0.45) return '中性'
  if (score >= 0.3) return '偏空震荡'
  return '偏空'
}

function percentileOf(series, value) {
  const valid = (series ?? []).filter(Number.isFinite)
  if (!valid.length || !Number.isFinite(value)) return null
  return valid.filter((item) => item <= value).length / valid.length
}

function latestDate(dates) {
  const valid = (dates ?? []).filter(Boolean).sort()
  return valid.at(-1) ?? null
}

function mean(values) {
  const valid = (values ?? []).filter(Number.isFinite)
  return valid.length ? valid.reduce((sum, item) => sum + item, 0) / valid.length : null
}

function num(value) {
  if (typeof value === 'string') {
    const matched = value.match(/-?\d+(?:\.\d+)?/)
    return matched ? Number(matched[0]) : null
  }
  return Number.isFinite(value) ? Number(value) : null
}

function round0(value) { return Number.isFinite(value) ? Math.round(value) : null }
function round1(value) { return Number.isFinite(value) ? Math.round(value * 10) / 10 : null }
function round2(value) { return Number.isFinite(value) ? Math.round(value * 100) / 100 : null }
function round4(value) { return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null }