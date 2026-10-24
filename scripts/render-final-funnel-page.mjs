#!/usr/bin/env node
// 渲染最终漏斗页：50 → 30 → 15 → 135资金流确认。

import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src', 'data', 'final-funnel-latest.json')
const OUT_DIR = join(ROOT, 'public', 'final-funnel')

const payload = JSON.parse(await readFile(SRC, 'utf8'))
const rows = Array.isArray(payload.rows) ? payload.rows : []
const flow = payload.flow ?? {}
const html = render(payload, rows, flow)
const date = String(payload.generatedAt ?? '').slice(0, 10)

await mkdir(OUT_DIR, { recursive: true })
await writeFile(join(OUT_DIR, 'index.html'), html, 'utf8')
await writeFile(join(OUT_DIR, 'data.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
if (date) {
  const dated = join(OUT_DIR, date)
  await mkdir(dated, { recursive: true })
  await writeFile(join(dated, 'index.html'), html, 'utf8')
  await copyFile(join(OUT_DIR, 'data.json'), join(dated, 'data.json'))
}
console.log(`生成最终漏斗页：${join(OUT_DIR, 'index.html')}（final=${rows.length} / flow=${flow.scored ?? 0}）`)

function render(data, list, flow) {
  const flowScored = flow.scored ?? list.filter((row) => row.flow?.available).length
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>最终 15（135独立确认）${esc(dateOf(data))}</title>
<style>
  :root { --bg:#fbfbfa; --surface:#fff; --ink:#1b1b1b; --muted:#6b6b6b; --line:#e2e2df; --accent:#0e7558; --warn:#b3261e; --orange:#9a6200; --chip:#f2f2ef; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.55 "Segoe UI","Microsoft YaHei",system-ui,sans-serif; }
  header.page { padding:18px 20px 12px; border-bottom:1px solid var(--line); background:var(--surface); }
  h1 { margin:0 0 5px; font-size:1.16rem; }
  h2 { margin:24px 20px 8px; font-size:1rem; }
  h3 { margin:14px 0 6px; font-size:.86rem; color:var(--muted); }
  .meta { color:var(--muted); font-size:.76rem; display:flex; flex-wrap:wrap; gap:6px 16px; }
  .banner { margin:10px 20px 0; padding:9px 12px; border-left:3px solid var(--accent); background:var(--chip); font-size:.78rem; border-radius:0 6px 6px 0; }
  .banner.warn { border-left-color:var(--warn); }
  .funnel { display:flex; align-items:center; gap:8px; margin:14px 20px 0; flex-wrap:wrap; }
  .funnel-step { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:8px 12px; min-width:120px; }
  .funnel-step b { display:block; font-size:.64rem; color:var(--muted); }
  .funnel-step span { font-size:1.1rem; font-weight:900; }
  .funnel-arrow { color:var(--muted); font-weight:700; }
  .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; margin:12px 20px 0; }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:6px; padding:8px 10px; }
  .card b { display:block; font-size:.62rem; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; }
  .card span { font-size:1.02rem; font-weight:800; font-variant-numeric:tabular-nums; }
  .scroll-x { overflow:auto; max-height:calc(100vh - 280px); margin:10px 20px 0; border:1px solid var(--line); border-radius:6px; background:var(--surface); }
  table.grid { border-collapse:separate; border-spacing:0; font-size:.72rem; width:max-content; }
  table.grid th, table.grid td { padding:5px 8px; border-bottom:1px solid var(--line); border-right:1px solid var(--line); white-space:nowrap; text-align:left; }
  table.grid th { position:sticky; top:0; background:var(--surface); z-index:3; color:var(--muted); font-size:.64rem; }
  table.grid td.freeze, table.grid th.freeze { position:sticky; z-index:2; background:var(--surface); }
  table.grid th.freeze { z-index:4; }
  table.grid td.f-sym, table.grid th.f-sym { left:0; width:70px; min-width:70px; max-width:70px; }
  table.grid td.f-name, table.grid th.f-name { left:70px; width:108px; min-width:108px; max-width:108px; }
  table.grid td.freeze > span { display:inline-block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom; }
  table.grid td.f-sym > span { max-width:54px; }
  table.grid td.f-name > span { max-width:92px; }
  table.grid tbody tr:nth-child(4n+1) td { background:#f6f6f4; }
  table.grid tbody tr:hover > td { background:#eef5f1; }
  tr.detail > td { background:#fbfbfa !important; padding:10px 12px; white-space:normal; }
  .tier-focus { background:#e6f4ee; color:var(--accent); border-radius:4px; padding:1px 6px; font-weight:700; }
  .tier-wait { background:#fff4e5; color:var(--orange); border-radius:4px; padding:1px 6px; font-weight:700; }
  .score { font-weight:900; font-variant-numeric:tabular-nums; }
  .score.ok { color:var(--accent); } .score.missing { color:var(--muted); font-size:.74rem; }
  .pos { color:var(--accent); } .neg { color:var(--warn); } .muted { color:var(--muted); }
  .nb-ref { color:#b45309; font-weight:900; }
  .flow-score { font-weight:800; }
  .flow-score.strong { color:var(--accent); } .flow-score.positive { color:#2f7d5c; } .flow-score.neutral { color:var(--muted); } .flow-score.weak { color:var(--warn); }
  .detail-btn { font:inherit; font-size:.68rem; padding:2px 7px; border:1px solid var(--line); border-radius:4px; background:var(--surface); color:var(--ink); cursor:pointer; }
  .breakdown { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:6px 10px; margin:0 0 10px; }
  .breakdown div { background:var(--surface); border:1px solid var(--line); border-radius:5px; padding:5px 8px; font-size:.72rem; }
  .breakdown b { display:block; font-size:.68rem; color:var(--muted); }
  table.inner { border-collapse:collapse; width:100%; font-size:.7rem; background:var(--surface); }
  table.inner th, table.inner td { border:1px solid var(--line); padding:4px 6px; text-align:left; white-space:nowrap; }
  table.inner th { background:var(--chip); color:var(--muted); }
  .hint { color:var(--muted); font-size:.74rem; margin:8px 20px; }
  table.plain { border-collapse:collapse; margin:0 20px; font-size:.76rem; }
  table.plain th, table.plain td { border:1px solid var(--line); padding:5px 8px; text-align:left; vertical-align:top; background:var(--surface); }
  table.plain th { background:var(--chip); }
  a { color:#1f5fbf; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16171a; --surface:#1d1f23; --ink:#e9e9e6; --muted:#9a9a95; --line:#2e3136; --chip:#24262b; }
    table.grid tbody tr:nth-child(4n+1) td { background:#1a1c20; }
    table.grid tbody tr:hover > td { background:#22302b; }
    tr.detail > td { background:#17191d !important; }
    .tier-focus { background:#17332a; } .tier-wait { background:#3a2c12; }
    a { color:#7fb0ff; }
  }
</style>
</head>
<body>
<header class="page">
  <h1>最终 15 · 样本外折 + 10bps（135 独立确认）</h1>
  <div class="meta">
    <span>生成 ${esc(data.generatedAt ?? '—')}</span>
    <span>第二段快照 ${esc(data.sourceAnalogGeneratedAt ?? '—')}</span>
    <span>135 资金流 ${esc(flow.generatedAt ?? '尚未生成')}</span>
    <span>数据日 ${esc(flow.dataThrough ?? '—')}</span>
  </div>
</header>
<div class="banner">
  <b>第三段漏斗：</b>50 只价量候选 → 第二段同股路径前 30（仅 A 股）→ 80% 样本外路径 + 10bps 成本前 15。
  135 资金流是独立模块，手工执行后只更新这 15 只的确认分；不参与前四步。最终分 = 70% 第三段路径 + 30% 135 资金流。
</div>
<div class="banner ${flowScored === list.length ? '' : 'warn'}">
  <b>135 资金流（独立模块）：</b>${flowScored}/${list.length} 只有效。${flowScored === list.length ? '最终排名已应用资金流。' : '资金流未覆盖全部 15 只，缺失股票只按第三段路径分展示；请在控制台独立模块手工运行 135 后重算。'}
</div>
<div class="funnel">
  <div class="funnel-step"><b>第一步</b><span>50</span></div><span class="funnel-arrow">→</span>
  <div class="funnel-step"><b>第二段回放</b><span>30</span></div><span class="funnel-arrow">→</span>
  <div class="funnel-step"><b>样本外+10bps</b><span>15</span></div><span class="funnel-arrow">→</span>
  <div class="funnel-step"><b>135独立确认</b><span>${flowScored}/${list.length}</span></div>
</div>
<div class="cards">
  <div class="card"><b>最终样本</b><span>${list.length}</span></div>
  <div class="card"><b>资金流覆盖</b><span>${flowScored}/${list.length}</span></div>
  <div class="card"><b>第三段平均分</b><span>${avg(list.map((row) => row.stage3Score))}</span></div>
  <div class="card"><b>最终平均分</b><span>${avg(list.map((row) => row.finalScore))}</span></div>
</div>
<div class="scroll-x">
<table class="grid"><thead><tr>
  <th>最终#</th><th class="freeze f-sym">symbol</th><th class="freeze f-name">name</th><th>北向</th><th>第一段档位</th>
  <th>第二段#</th><th>第二段分</th><th>第三段#</th><th>第三段分</th><th>OOS路径</th><th>10bps路径</th>
  <th>135资金流</th><th>最终分</th><th>置信</th><th>详情</th>
</tr></thead><tbody>
${list.map((row, index) => renderRows(row, index)).join('\n')}
</tbody></table>
</div>
<h2>方法与边界</h2>
<table class="plain"><tbody>
  <tr><th>第二段</th><td>50 只只用价量；同股路径分（目标先于止损 10 / MAE 40 / 10日 10）取前 30 只 A 股；港股不进入 A 股 135 漏斗。不读取资金流。</td></tr>
  <tr><th>第三段</th><td>对 30 只计算 80% 截止点之前的相似节点路径分（样本外折），以及当前相似节点在 10bps 单边成本下的路径分；按 60% OOS + 40% 10bps 取前 15。</td></tr>
  <tr><th>135 资金流</th><td>独立模块手工拉全局 A 股同花顺全单净额（5日 40% / 3日 35% / 今日 25%）；只把最终 15 的确认分并入最终分。北向仅作参考，不参与评分。</td></tr>
  <tr><th>边界</th><td>这是历史样本研究，不是胜率承诺，也不产生可执行订单；当前池存在幸存者偏差。</td></tr>
</tbody></table>
<p class="hint">返回 <a href="/recommendation/">第一步 50 候选</a> · <a href="/analog-audit/">第二段 50→30</a> · <a href="/replay/">策略历史回放</a></p>
<script>
  function toggleDetail(id) {
    const row = document.getElementById(id)
    if (row) row.hidden = !row.hidden
  }
</script>
</body>
</html>
`
}

function renderRows(row, index) {
  const tierClass = row.tier === 'focus' ? 'tier-focus' : 'tier-wait'
  const tierLabel = row.tier === 'focus' ? '观察' : '等待'
  const detailId = `detail-${index}`
  return `  <tr>
    <td>${row.finalRank ?? index + 1}</td>
    <td class="freeze f-sym"><span>${esc(row.symbol ?? '')}</span></td>
    <td class="freeze f-name"><span>${esc(row.label ?? '')}</span></td>
    <td>${northboundCell(row.northbound)}</td>
    <td><span class="${tierClass}">${tierLabel}</span></td>
    <td>${esc(num(row.stage2Rank))}</td>
    <td>${scoreText(row.stage2Score)}</td>
    <td>${esc(num(row.stage3Rank))}</td>
    <td>${scoreText(row.stage3Score)}</td>
    <td>${scoreText(row.oos?.pathScore)}</td>
    <td>${scoreText(row.cost10bps?.pathScore)}</td>
    <td>${flowScoreCell(row.flow)}</td>
    <td>${scoreText(row.finalScore)}</td>
    <td>${pct((row.sampleConfidence ?? 0) * 100)}</td>
    <td><button class="detail-btn" type="button" onclick="toggleDetail('${detailId}')">展开</button></td>
  </tr>
  <tr class="detail" id="${detailId}" hidden><td colspan="15">${renderDetail(row)}</td></tr>`
}

function renderDetail(row) {
  return `<h3>第三段路径拆解</h3>
    <div class="breakdown">
      <div><b>OOS 路径分</b><strong>${scoreText(row.oos?.pathScore)}</strong><br><span class="muted">截止 ${esc(row.oos?.cutoffDate ?? '—')}</span></div>
      <div><b>10bps 路径分</b><strong>${scoreText(row.cost10bps?.pathScore)}</strong><br><span class="muted">买卖合计约 20bps</span></div>
      <div><b>第三段分</b><strong>${scoreText(row.stage3Score)}</strong><br><span class="muted">60% OOS + 40% 10bps</span></div>
      <div><b>最终分</b><strong>${scoreText(row.finalScore)}</strong><br><span class="muted">70% 第三段 + 30% 135</span></div>
    </div>
    <h3>路径统计</h3>
    ${renderStatsTable(row)}
    <h3>135 资金流</h3>
    ${renderFlowDetail(row.flow)}`
}

function renderStatsTable(row) {
  const stages = [
    ['当前', row.current],
    ['80% OOS', row.oos],
    ['10bps', row.cost10bps],
  ]
  const rows = stages.map(([label, item]) => {
    const s = item?.stats ?? {}
    return `<tr><td>${esc(label)}</td><td>${esc(num(s.count))}</td><td>${pct(s.targetFirstRate)}</td><td>${signedPct(s.fwd10MedianPct)}</td><td>${signedPct(s.mae20MedianPct)}</td><td>${pct(s.winRate20Pct)}</td><td>${esc(scoreText(item?.pathScore))}</td></tr>`
  }).join('')
  return `<table class="inner"><thead><tr><th>口径</th><th>节点</th><th>目标率先</th><th>10日中位</th><th>MAE中位</th><th>20日胜率</th><th>路径分</th></tr></thead><tbody>${rows}</tbody></table>`
}

function renderFlowDetail(flow) {
  if (!flow?.available) return '<p class="muted">135 资金流尚未覆盖，最终分暂按第三段路径分展示。</p>'
  return `<div class="breakdown">
    <div><b>135 确认分</b><strong>${scoreText(flow.score)}</strong><br><span class="muted">${esc(flow.band?.label ?? '')}</span></div>
    <div><b>5日净额</b><strong>${amount(flow.d5)}</strong><br><span class="muted">P${fmt(flow.d5Pct, 0)}</span></div>
    <div><b>3日净额</b><strong>${amount(flow.d3)}</strong><br><span class="muted">P${fmt(flow.d3Pct, 0)}</span></div>
    <div><b>今日净额</b><strong>${amount(flow.today)}</strong><br><span class="muted">P${fmt(flow.todayPct, 0)}</span></div>
  </div>`
}

function northboundCell(northbound) {
  if (!northbound?.present) return '<span class="muted">—</span>'
  return `<span class="nb-ref" title="+ = 北向持仓；* = 当期净买入">${esc(northbound.mark || '+')}</span>`
}

function flowScoreCell(flow) {
  if (!Number.isFinite(flow?.score)) return '<span class="muted">待刷新</span>'
  return `<span class="flow-score ${esc(flow.band?.key ?? 'neutral')}">${flow.score.toFixed(1)}</span> <small>${esc(flow.band?.label ?? '')}</small>`
}

function scoreText(value) {
  return Number.isFinite(value) ? `<span class="score ok">${value.toFixed(1)}</span>` : '<span class="score missing">—</span>'
}

function avg(values) {
  const usable = values.filter(Number.isFinite)
  return usable.length ? (usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(1) : '—'
}

function signedPct(value) {
  return Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '—'
}

function pct(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—'
}

function amount(value) {
  if (!Number.isFinite(value)) return '—'
  return Math.abs(value) >= 1e8 ? `${(value / 1e8).toFixed(2)}亿` : Math.abs(value) >= 1e4 ? `${(value / 1e4).toFixed(2)}万` : value.toFixed(0)
}

function num(value) {
  return Number.isFinite(value) ? String(value) : '—'
}

function fmt(value, digits) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '—'
}

function dateOf(data) {
  return String(data.generatedAt ?? '').slice(0, 10) || 'report'
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
