#!/usr/bin/env node
// 渲染港股独立推荐页：固定只展示前三名。

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const LATEST_PATH = join(ROOT, 'src', 'data', 'hong-kong-recommendation-latest.json')
const PUBLIC_DIR = join(ROOT, 'public', 'hong-kong-recommendation')

const payload = JSON.parse(await readFile(LATEST_PATH, 'utf8'))
const html = renderPage(payload)
await mkdir(PUBLIC_DIR, { recursive: true })
await writeFile(join(PUBLIC_DIR, 'index.html'), html, 'utf8')
const datedDir = join(PUBLIC_DIR, payload.asOfDate)
await mkdir(datedDir, { recursive: true })
await writeFile(join(datedDir, 'index.html'), html, 'utf8')
console.log(`港股推荐页生成：${join(PUBLIC_DIR, 'index.html')}（前${payload.items.length}名）`)

function renderPage(data) {
  const cards = data.items.map(renderCard).join('\n')
  const dimensions = Object.entries(data.weights)
    .map(([id, weight]) => `<span class="weight"><b>${weight}</b> ${esc(dimensionLabel(id))}</span>`)
    .join('')
  const exclusionCounts = new Map()
  for (const item of data.exclusions) {
    for (const reason of item.reasons ?? []) {
      exclusionCounts.set(reason, (exclusionCounts.get(reason) ?? 0) + 1)
    }
  }
  const exclusionSummary = [...exclusionCounts.entries()]
    .map(([reason, count]) => `<span class="weight">${esc(reasonText([reason]))} ${count}</span>`)
    .join('')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>港股独立推荐 · Market Lab</title>
<style>
  :root { --bg:#f7f8f7; --surface:#fff; --ink:#17201d; --muted:#68716e; --line:#dde3e0; --accent:#0e7558; --chip:#edf3f0; --bad:#a33a32; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.6 "Segoe UI","Microsoft YaHei",system-ui,sans-serif; }
  header { padding:20px 22px 16px; background:var(--surface); border-bottom:1px solid var(--line); }
  h1 { margin:0 0 4px; font-size:1.25rem; }
  .meta { color:var(--muted); font-size:.78rem; display:flex; flex-wrap:wrap; gap:6px 16px; }
  main { max-width:1180px; margin:0 auto; padding:18px 18px 36px; }
  .notice { border-left:3px solid var(--accent); background:var(--chip); padding:10px 13px; border-radius:0 7px 7px 0; font-size:.8rem; }
  .weights { display:flex; flex-wrap:wrap; gap:6px; margin:12px 0 18px; }
  .weight { border:1px solid var(--line); background:var(--surface); border-radius:999px; padding:3px 9px; font-size:.7rem; color:var(--muted); }
  .weight b { color:var(--accent); }
  .cards { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:16px; box-shadow:0 5px 18px rgba(20,35,28,.04); }
  .rank { color:var(--accent); font-weight:800; font-size:.74rem; letter-spacing:.08em; }
  .name { margin:5px 0 1px; font-size:1.08rem; }
  .symbol { color:var(--muted); font-family:Consolas,monospace; font-size:.75rem; }
  .score { margin:14px 0 5px; font-size:2rem; font-weight:800; color:var(--accent); }
  .score span { font-size:.72rem; color:var(--muted); font-weight:500; }
  .bar { height:7px; background:var(--chip); border-radius:999px; overflow:hidden; margin-bottom:14px; }
  .bar i { display:block; height:100%; background:var(--accent); }
  .metrics { display:grid; grid-template-columns:1fr auto; gap:6px 12px; font-size:.76rem; }
  .metrics dt { color:var(--muted); }
  .metrics dd { margin:0; text-align:right; font-family:Consolas,monospace; }
  .hits { margin-top:12px; display:flex; flex-wrap:wrap; gap:5px; }
  .hit { background:var(--chip); color:var(--accent); border-radius:4px; padding:2px 6px; font-size:.67rem; }
  details { margin-top:20px; background:var(--surface); border:1px solid var(--line); border-radius:9px; padding:10px 13px; }
  summary { cursor:pointer; font-weight:600; font-size:.82rem; }
  .limit { color:var(--muted); font-size:.76rem; }
  ul { margin:8px 0 0; padding-left:20px; color:var(--muted); font-size:.75rem; }
  code { font-family:Consolas,monospace; }
  @media (max-width:850px) { .cards { grid-template-columns:1fr; } }
  @media (prefers-color-scheme:dark) {
    :root { --bg:#151816; --surface:#1d211f; --ink:#e8ece9; --muted:#9da6a1; --line:#303733; --chip:#232b27; --accent:#58b996; }
  }
</style>
</head>
<body>
<header>
  <h1>港股独立研究推荐</h1>
  <div class="meta">
    <span>只展示前 ${data.items.length} 名</span>
    <span>行情截至 ${esc(data.dataThrough ?? '—')}</span>
    <span>候选 ${data.counts.evaluated} / 通过门禁 ${data.counts.eligible}</span>
    <a href="/control/">返回控制台</a>
  </div>
</header>
<main>
  <div class="notice">
    本条线只使用港股复权日线 OHLCV 和成交量；不使用 A 股四段漏斗，也不使用财报、南向资金、研报公告或行业估值。
    结果是研究排序，不是交易建议。
  </div>
  <div class="weights">${dimensions}</div>
  <section class="cards">${cards || '<p>没有通过风险门禁的港股。</p>'}</section>
  <details>
    <summary>风险门禁（排除 ${data.exclusions.length} 只）</summary>
    <p class="limit">排除：数据超过45天、年化波动超过100%、成本锚近期跌幅超过4%、20日跌幅超过16%、价格高于成本锚18%、低于成本带4个标准差或明显过热。</p>
    <div class="weights">${exclusionSummary || '<span class="weight">无</span>'}</div>
  </details>
</main>
</body>
</html>`
}

function renderCard(item) {
  const m = item.metrics
  const scoreWidth = Math.max(0, Math.min(100, item.score ?? 0))
  return `<article class="card">
    <div class="rank">TOP ${item.rank}</div>
    <h2 class="name">${esc(item.label)}</h2>
    <div class="symbol">${esc(item.symbol)}</div>
    <div class="score">${fmt(item.score)} <span>/ 100</span></div>
    <div class="bar"><i style="width:${scoreWidth}%"></i></div>
    <dl class="metrics">
      <dt>收盘</dt><dd>${fmt(m.close)}</dd>
      <dt>一年价格位置</dt><dd>${pct(m.pricePercentile)}</dd>
      <dt>距成本锚</dt><dd>${signedPct(m.costDistance)}</dd>
      <dt>一年回撤修复</dt><dd>${pct(m.drawdownRepair)}</dd>
      <dt>20日动量</dt><dd>${signedPct(m.return20)}</dd>
      <dt>成本锚近期斜率</dt><dd>${signedPct(m.costSlopeRecent)}</dd>
      <dt>5/20日量比</dt><dd>${fmt(m.volumeRatio)}</dd>
      <dt>数据</dt><dd>${m.rows}行</dd>
    </dl>
    <div class="hits">${item.hits.map((hit) => `<span class="hit">${esc(hit)}</span>`).join('')}</div>
  </article>`
}

function dimensionLabel(id) {
  return {
    pricePosition: '一年价格位置',
    costValuation: '成本锚偏离',
    drawdownRepair: '回撤修复',
    anchorTrend: '成本锚趋势',
    momentum20: '20日动量',
    volumeConfirmation: '量能确认',
    dataQuality: '数据质量',
  }[id] ?? id
}

function reasonText(reasons) {
  return (reasons ?? []).map((reason) => ({
    'stale-data': '行情陈旧',
    'volatility-too-high': '波动过高',
    'anchor-still-falling': '成本锚仍在下行',
    'momentum-too-weak': '20日动量过弱',
    'too-far-above-anchor': '价格过高于成本锚',
    'falling-knife': '偏离过深，仍在下跌',
    overextended: '偏离过热',
    'insufficient-history': '历史不足',
  })[reason] ?? reason).join('、')
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
}

function signedPct(value) {
  if (!Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
}

function fmt(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '—'
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
