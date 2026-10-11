#!/usr/bin/env node
// 把 market-regime-latest.json 渲染成单文件静态报告页。
// 与 replay / stock-news 两个报告页同一套约定：自包含 HTML + 底部字段注释。

import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC_JSON = join(ROOT, 'src', 'data', 'market-regime', 'market-regime-latest.json')
const PUBLIC_DIR = join(ROOT, 'public', 'market-regime')

const NOTES = {
  'total.score': '总分 = 各分组归一化指标按权重加权，0-100。它描述当下偏多程度，不预测后市。',
  'total.label': '按总分分档：≥70 偏多 / 55-70 偏多震荡 / 45-55 中性 / 30-45 偏空震荡 / <30 偏空。阈值写在生成器里，可改。',
  'weights': '分组权重。按你的要求：资金 35%，动量/宽度/量能各均分剩余 65%（约 21.7%）。',
  'asOfDate': '数据截止日，取各指数最新交易日。',
  'groups': '四个分组：动量、宽度、量能、资金。每组内指标先归一到 0-1 再等权平均。',
  'indexPanel': '指数面板。每个指数用项目 domain 的成本锚公式（buildMarketStatePath）算出锚、成本带与斜率。',
  'indexPanel.costAnchor': '成本锚：按成交额加权的典型价（高+低+收）/3 的滚动加权值。它在这里替代均线。',
  'indexPanel.costDistancePct': '收盘价相对成本锚的距离百分比。负值表示在锚下方。',
  'indexPanel.costSlopePct': '成本锚近期斜率（百分比点）。锚在下移时，价格反弹通常只是修复而非反转。',
  'indexPanel.aboveAnchor': '收盘价是否高于成本锚。',
  'indexPanel.anchorSlopeUp': '成本锚斜率是否为正。',
  'indexPanel.amountYi': '该指数当日成交额（亿元，按腾讯口径千元换算）。',
  'indexPanel.amountPercentile5y': '该指数成交额在最近 5 年中的百分位。',
  'breadth': '全市场宽度当日快照，来自上游「赚钱效应」接口。',
  'breadth.上涨': '全市场上涨家数。',
  'breadth.下跌': '全市场下跌家数。',
  'breadth.涨停': '全市场涨停家数。',
  'breadth.真实涨停': '剔除 ST 与新股后的真实涨停家数。',
  'breadth.跌停': '全市场跌停家数。',
  'breadth.平盘': '平盘家数。',
  'breadth.停牌': '停牌家数。',
  'breadth.活跃度': '上游给出的全市场活跃度百分比。',
  'breadthHistory': '宽度历史是本地逐日累积出来的，因为上游只给当日快照。样本越多，宽度分位越可靠。',
  'fundingDetail.marginLatestDate': '两融数据最新日期。',
  'fundingDetail.hsgtLatestDate': '北向资金最后可用的披露日期。',
  'disclosures': '口径披露。每一条都说明了一个已知缺口或替代关系。',
  'failures': '本次抓取失败的接口。为空表示全部数据源正常。',
  'provenance': '溯源：原始数据文件、各数据源的接口名、所用成本模型与窗口长度。',
}

const payload = JSON.parse(await readFile(SRC_JSON, 'utf8'))
const html = renderPage(payload)
const generatedDate = String(payload.asOfDate ?? '').slice(0, 10)

await mkdir(PUBLIC_DIR, { recursive: true })
await writeFile(join(PUBLIC_DIR, 'index.html'), html, 'utf8')
await writeFile(join(PUBLIC_DIR, 'data.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
if (generatedDate) {
  const datedDir = join(PUBLIC_DIR, generatedDate)
  await mkdir(datedDir, { recursive: true })
  await writeFile(join(datedDir, 'index.html'), html, 'utf8')
  await copyFile(join(PUBLIC_DIR, 'data.json'), join(datedDir, 'data.json'))
}

console.log(`生成大盘趋势报告页：${join(PUBLIC_DIR, 'index.html')}（asOf ${payload.asOfDate} / 总分 ${payload.total.score} ${payload.total.label}）`)

function renderPage(data) {
  const total = data.total ?? {}
  const labelClass = Number.isFinite(total.score) ? (total.score >= 55 ? 'ok' : total.score < 45 ? 'bad' : '') : ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>大盘趋势报告 ${esc(data.asOfDate ?? '')}</title>
<style>
  :root { --bg:#fbfbfa; --surface:#fff; --ink:#1b1b1b; --muted:#6b6b6b; --line:#e2e2df; --accent:#0e7558; --warn:#b3261e; --chip:#f2f2ef; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.55 "Segoe UI","Microsoft YaHei",system-ui,sans-serif; }
  header.page { padding:20px 20px 14px; border-bottom:1px solid var(--line); background:var(--surface); }
  h1 { margin:0 0 4px; font-size:1.18rem; }
  h2 { margin:26px 20px 8px; font-size:1.02rem; padding-top:10px; border-top:2px solid var(--line); }
  h3 { margin:14px 20px 6px; font-size:.86rem; color:var(--muted); }
  .meta { color:var(--muted); font-size:.76rem; display:flex; flex-wrap:wrap; gap:6px 16px; }
  code { background:var(--chip); padding:1px 5px; border-radius:4px; font-size:.76rem; }
  .hero { display:flex; align-items:baseline; gap:14px; margin:14px 20px 0; }
  .hero .score { font-size:2.6rem; font-weight:900; font-variant-numeric:tabular-nums; line-height:1; }
  .hero .label { font-size:1.1rem; font-weight:800; }
  .hero .note { color:var(--muted); font-size:.76rem; }
  .ok { color:var(--accent); } .bad { color:var(--warn); }
  .bars { margin:14px 20px 0; display:grid; gap:8px; }
  .bar { display:grid; grid-template-columns:88px 74px 62px minmax(120px,1fr); gap:10px; align-items:center; font-size:.78rem; }
  .bar .track { height:10px; border-radius:999px; background:var(--line); overflow:hidden; }
  .bar .track i { display:block; height:100%; background:var(--accent); }
  table.plain { border-collapse:collapse; margin:0 20px; font-size:.76rem; }
  table.plain th, table.plain td { border:1px solid var(--line); padding:5px 8px; text-align:left; vertical-align:top; background:var(--surface); }
  table.plain th { background:var(--chip); }
  table.grid { border-collapse:separate; border-spacing:0; font-size:.72rem; }
  table.grid th, table.grid td { padding:5px 9px; border-bottom:1px solid var(--line); border-right:1px solid var(--line); white-space:nowrap; text-align:right; }
  table.grid th:first-child, table.grid td:first-child, table.grid th:nth-child(2), table.grid td:nth-child(2) { text-align:left; }
  table.grid th { position:sticky; top:0; background:var(--surface); z-index:2; color:var(--muted); font-size:.66rem; }
  .scroll-x { overflow-x:auto; margin:0 20px; border:1px solid var(--line); border-radius:6px; background:var(--surface); }
  .glossary td.k { width:250px; font-family:Consolas,monospace; font-size:.72rem; }
  ul.tight { margin:8px 20px 0; padding-left:22px; }
  ul.tight li { margin:3px 0; font-size:.78rem; }
  .hint { color:var(--muted); font-size:.74rem; margin:6px 20px; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16171a; --surface:#1d1f23; --ink:#e9e9e6; --muted:#9a9a95; --line:#2e3136; --chip:#24262b; }
  }
</style>
</head>
<body>
<header class="page">
  <h1>大盘趋势判断</h1>
  <div class="meta">
    <span>数据截止 ${esc(data.asOfDate ?? '—')}</span>
    <span>生成 ${esc(data.generatedAt ?? '—')}</span>
    <span>成本模型 ${esc(data.provenance?.costModel ?? '—')}</span>
    <span>权重 资金 ${esc(pct(data.weights?.funding))} / 动量 ${esc(pct(data.weights?.momentum))} / 宽度 ${esc(pct(data.weights?.breadth))} / 量能 ${esc(pct(data.weights?.volume))}</span>
    <span>${esc(data.total?.scaledBy ?? '')}</span>
  </div>
</header>
<div class="hero">
  <div class="score ${labelClass}">${esc(num(data.total?.score))}</div>
  <div class="label ${labelClass}">${esc(data.total?.label ?? '—')}</div>
  <div class="note">${esc(data.total?.interpretation ?? '')}</div>
</div>
${renderBars(data.groups)}
${(data.groups ?? []).map((group) => renderGroup(group)).join('')}
${renderIndexPanel(data.indexPanel)}
${renderBreadth(data.breadth, data.breadthHistory)}
${renderFunding(data)}
${renderDisclosures(data.disclosures)}
${renderFailures(data.failures)}
${renderGlossary()}
</body>
</html>
`
}

function renderBars(groups) {
  if (!Array.isArray(groups) || !groups.length) return ''
  return `<div class="bars">${groups
    .map(
      (group) => `<div class="bar">
      <b>${esc(group.label)}</b>
      <span>权重 ${esc(pct(group.weight))}</span>
      <span>${esc(num(group.scorePct))}</span>
      <div class="track"><i style="width:${Math.max(0, Math.min(100, group.scorePct ?? 0))}%"></i></div>
    </div>`,
    )
    .join('')}</div>`
}

function renderGroup(group) {
  const metrics = group.metrics ?? []
  const rows = metrics
    .map(
      (metric) => `<tr>
      <td class="k"><code>${esc(metric.id)}</code></td>
      <td>${esc(metric.label)}</td>
      <td>${esc(metric.display ?? '—')}</td>
      <td>${metric.valuePct === null ? '—' : esc(metric.valuePct)}</td>
      <td>${esc(metric.note ?? '')}</td>
    </tr>`,
    )
    .join('')
  return `<h2>${esc(group.label)}组 · 权重 ${esc(pct(group.weight))} · 得分 ${esc(num(group.scorePct))}</h2>
  <table class="plain glossary"><thead><tr><th>指标 id</th><th>含义</th><th>原始值</th><th>归一化 0-100</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>
  ${group.note ? `<p class="hint">${esc(group.note)}</p>` : ''}`
}

function renderIndexPanel(panel) {
  if (!Array.isArray(panel) || !panel.length) return ''
  const rows = panel
    .map(
      (item) => `<tr>
      <td>${esc(item.label)}</td>
      <td>${esc(item.symbol)}</td>
      <td>${esc(num(item.close))}</td>
      <td>${esc(num(item.costAnchor))}</td>
      <td>${esc(num(item.costDistancePct))}%</td>
      <td>${esc(num(item.costSlopePct))}%</td>
      <td>${item.aboveAnchor ? '是' : '否'}</td>
      <td>${item.anchorSlopeUp ? '是' : '否'}</td>
      <td>${esc(num(item.amountYi))}</td>
      <td>${esc(num(item.amountPercentile5y === null ? null : Math.round(item.amountPercentile5y * 1000) / 10))}%</td>
      <td>${esc(item.asOf ?? '—')}</td>
    </tr>`,
    )
    .join('')
  return `<h2>指数面板（成本锚口径）</h2>
  <p class="hint">四个指数全部用项目 domain 的 buildMarketStatePath 计算，成本锚在这里替代均线。</p>
  <div class="scroll-x"><table class="grid"><thead><tr>
    <th>指数</th><th>代码</th><th>收盘</th><th>成本锚</th><th>距锚</th><th>锚斜率</th><th>锚上方</th><th>锚向上</th><th>成交额(亿)</th><th>成交额分位</th><th>数据日</th>
  </tr></thead><tbody>${rows}</tbody></table></div>`
}

function renderBreadth(breadth, history) {
  if (!breadth) return ''
  const rows = Object.entries(breadth)
    .map(([key, value]) => `<tr><td class="k"><code>${esc(key)}</code></td><td>${esc(value ?? '—')}</td><td>${esc(NOTES[`breadth.${key}`] ?? '')}</td></tr>`)
    .join('')
  return `<h2>全市场宽度（当日快照）</h2>
  <table class="plain glossary"><thead><tr><th>字段</th><th>值</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="hint">宽度历史：已累积 ${esc(history?.samples ?? 0)} 个交易日（${esc(history?.firstDate ?? '—')} ~ ${esc(history?.lastDate ?? '—')}）。上游只给当日快照，分位靠本地逐日累积。</p>`
}

function renderFunding(data) {
  const detail = data.fundingDetail ?? {}
  return `<h2>资金明细与缺口</h2>
  <table class="plain glossary"><thead><tr><th>项</th><th>值</th><th>说明</th></tr></thead><tbody>
    <tr><td class="k"><code>marginLatestDate</code></td><td>${esc(detail.marginLatestDate ?? '—')}</td><td>${esc(NOTES['fundingDetail.marginLatestDate'])}</td></tr>
    <tr><td class="k"><code>hsgtLatestDate</code></td><td>${esc(detail.hsgtLatestDate ?? '—')}</td><td>${esc(NOTES['fundingDetail.hsgtLatestDate'])}</td></tr>
    <tr><td class="k"><code>hsgtNote</code></td><td colspan="2">${esc(detail.hsgtNote ?? '')}</td></tr>
  </tbody></table>`
}

function renderDisclosures(list) {
  if (!Array.isArray(list) || !list.length) return ''
  return `<h2>口径披露</h2><ul class="tight">${list.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
}

function renderFailures(failures) {
  if (!Array.isArray(failures) || !failures.length) {
    return `<h2>数据源状态</h2><p class="hint ok">本次全部数据源抓取成功。</p>`
  }
  return `<h2>数据源状态</h2><table class="plain"><thead><tr><th>数据源</th><th>接口</th><th>错误</th></tr></thead><tbody>${failures
    .map((item) => `<tr><td>${esc(item.id)}</td><td>${esc(item.endpoint)}</td><td>${esc(item.error)}</td></tr>`)
    .join('')}</tbody></table>`
}

function renderGlossary() {
  const rows = Object.entries(NOTES)
    .map(([key, note]) => `<tr><td class="k"><code>${esc(key)}</code></td><td>${esc(note)}</td></tr>`)
    .join('')
  return `<h2>字段注释</h2><table class="plain glossary"><tbody>${rows}</tbody></table>`
}

function num(value) {
  if (value === null || value === undefined) return '—'
  return String(value)
}

function pct(value) {
  return Number.isFinite(value) ? `${Math.round(value * 1000) / 10}%` : '—'
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}