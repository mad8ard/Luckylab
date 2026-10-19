#!/usr/bin/env node
// 渲染「集合推荐」页面：默认 5 只观察档 + 5 只等待档。

import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src', 'data', 'recommendation-latest.json')
const OUT_DIR = join(ROOT, 'public', 'recommendation')

const payload = JSON.parse(await readFile(SRC, 'utf8'))
const rows = Array.isArray(payload.rows) ? payload.rows : []
const counts = payload.counts ?? {}
const gate = payload.gate ?? {}
const html = render(payload, rows, counts, gate)
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

console.log(
  `生成集合推荐页：${join(OUT_DIR, 'index.html')}（selected=${rows.length} / 观察档 ${counts.byTierSelected?.observe ?? 0} / 等待档 ${counts.byTierSelected?.wait ?? 0}）`,
)

function render(data, list, stats, gate) {
  const observe = stats.byTierSelected?.observe ?? list.filter((row) => row.tier === 'focus').length
  const wait = stats.byTierSelected?.wait ?? list.filter((row) => row.tier === 'wait').length
  const focusPct = Math.round((gate.focusThreshold ?? 0.75) * 100)
  const waitPct = Math.round((gate.waitThreshold ?? 0.55) * 100)
  const minScore = gate.screenMinScore ?? 50
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>集合推荐 ${esc(dateOf(data))}</title>
<style>
  :root { --bg:#fbfbfa; --surface:#fff; --ink:#1b1b1b; --muted:#6b6b6b; --line:#e2e2df; --accent:#0e7558; --warn:#b3261e; --chip:#f2f2ef; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.55 "Segoe UI","Microsoft YaHei",system-ui,sans-serif; }
  header.page { padding:18px 20px 12px; border-bottom:1px solid var(--line); background:var(--surface); }
  h1 { margin:0 0 5px; font-size:1.16rem; }
  h2 { margin:24px 20px 8px; font-size:1rem; }
  .meta { color:var(--muted); font-size:.76rem; display:flex; flex-wrap:wrap; gap:6px 16px; }
  .banner { margin:10px 20px 0; padding:9px 12px; border-left:3px solid var(--accent); background:var(--chip); font-size:.78rem; border-radius:0 6px 6px 0; }
  .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; margin:12px 20px 0; }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:6px; padding:8px 10px; }
  .card b { display:block; font-size:.62rem; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; }
  .card span { font-size:1.02rem; font-weight:800; font-variant-numeric:tabular-nums; }
  .scroll-x { overflow:auto; margin:10px 20px 0; border:1px solid var(--line); border-radius:6px; background:var(--surface); }
  table.grid { border-collapse:separate; border-spacing:0; font-size:.74rem; width:max-content; }
  table.grid th, table.grid td { padding:6px 9px; border-bottom:1px solid var(--line); border-right:1px solid var(--line); white-space:nowrap; text-align:left; }
  table.grid th { position:sticky; top:0; background:var(--surface); z-index:3; color:var(--muted); font-size:.64rem; }
  table.grid td.freeze, table.grid th.freeze { position:sticky; z-index:2; background:var(--surface); }
  table.grid th.freeze { z-index:4; }
  table.grid td.f-sym, table.grid th.f-sym { left:0; width:72px; min-width:72px; max-width:72px; }
  table.grid td.f-name, table.grid th.f-name { left:72px; width:112px; min-width:112px; max-width:112px; }
  table.grid td.freeze > span { display:inline-block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom; }
  table.grid td.f-sym > span { max-width:56px; }
  table.grid td.f-name > span { max-width:96px; }
  table.grid tbody tr:nth-child(even) td { background:#f6f6f4; }
  table.grid tbody tr:hover td { background:#eef5f1; }
  .s-观察 { color:var(--accent); font-weight:700; }
  .s-等待 { color:#9a6200; font-weight:700; }
  .s-剔除 { color:var(--warn); font-weight:700; }
  .tier-focus { background:#e6f4ee; color:var(--accent); border-radius:4px; padding:2px 8px; font-weight:700; }
  .tier-wait { background:#fff4e5; color:#9a6200; border-radius:4px; padding:2px 8px; font-weight:700; }
  .hint { color:var(--muted); font-size:.74rem; margin:8px 20px; }
  .glossary td.k { width:180px; font-family:Consolas,monospace; font-size:.72rem; }
  table.plain { border-collapse:collapse; margin:0 20px; font-size:.76rem; }
  table.plain th, table.plain td { border:1px solid var(--line); padding:5px 8px; text-align:left; background:var(--surface); vertical-align:top; }
  table.plain th { background:var(--chip); }
  a { color:#1f5fbf; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16171a; --surface:#1d1f23; --ink:#e9e9e6; --muted:#9a9a95; --line:#2e3136; --chip:#24262b; }
    table.grid tbody tr:nth-child(even) td { background:#1a1c20; }
    table.grid tbody tr:hover td { background:#22302b; }
    .tier-focus { background:#17332a; } .tier-wait { background:#3a2c12; }
    a { color:#7fb0ff; }
  }
</style>
</head>
<body>
<header class="page">
  <h1>集合推荐 · ${observe} 观察 + ${wait} 等待</h1>
  <div class="meta">
    <span>生成 ${esc(data.generatedAt ?? '—')}</span>
    <span>推荐池快照 ${esc(data.sourcePoolGeneratedAt ?? '—')}</span>
    <span>候选 ${esc(String(stats.total ?? '—'))} 只</span>
    <span>通过门禁 ${esc(String(stats.eligible ?? '—'))} 只</span>
  </div>
</header>
<div class="banner">
  <b>入选规则：</b>推荐分占满分 ≥${focusPct}% 为观察档，${waitPct}%~${focusPct}% 为等待档；
  同时筛选状态必须是「观察」或「等待」，且筛选分 ≥ ${minScore}。
  默认只保留 ${gate.perTier ?? 5} 只观察档 + ${gate.perTier ?? 5} 只等待档。
  推荐分可在 <a href="/recommended-pool/" target="_blank" rel="noreferrer">推荐池页</a> 调权重。
</div>
<div class="cards">
  <div class="card"><b>观察档</b><span class="s-观察">${observe}</span></div>
  <div class="card"><b>等待档</b><span class="s-等待">${wait}</span></div>
  <div class="card"><b>候选总数</b><span>${stats.total ?? '—'}</span></div>
  <div class="card"><b>通过门禁</b><span>${stats.eligible ?? '—'}</span></div>
  <div class="card"><b>筛选分下限</b><span>${minScore}</span></div>
</div>
<div class="scroll-x">
<table class="grid"><thead><tr>
  <th>#</th><th class="freeze f-sym">symbol</th><th class="freeze f-name">name</th><th>market</th>
  <th>入选档</th><th>推荐分 / 满分</th><th>筛选分</th><th>命中维度</th>
</tr></thead><tbody>
${list.map((row, index) => renderRow(row, index)).join('\n')}
</tbody></table>
</div>
<h2>字段解释</h2>
<table class="plain glossary"><tbody>
  <tr><td class="k">入选档</td><td><b>观察档</b>=推荐分占满分 ≥${focusPct}%；<b>等待档</b>=${waitPct}%~${focusPct}%。两档各取前 ${gate.perTier ?? 5} 只。</td></tr>
  <tr><td class="k">推荐分</td><td>7 个维度的加权和（合成几何百分位 / z / CK 区间位置 / 成本锚斜率 / 3 年几何比等）。可在推荐池页调权重。</td></tr>
  <tr><td class="k">筛选分</td><td>成本锚 30 + 合成 CK 几何 35 + 偏离 25 + 数据完整 10，满分 100；本页只接受 ≥${minScore}。</td></tr>
  <tr><td class="k">筛选门禁</td><td>只接受筛选状态为「观察」或「等待」、且筛选分 ≥${minScore} 的标的；「剔除」和「需刷新数据」不会进入本页。</td></tr>
  <tr><td class="k">命中维度</td><td>该维度得分达到满分的 80% 以上时列出，用于快速看「为什么排前面」。</td></tr>
  <tr><td class="k">边界</td><td>本页只做研究排序与门禁展示，不产生可执行订单，也不预测收益。</td></tr>
</tbody></table>
</body>
</html>
`
}

function renderRow(row, index) {
  const hits = Array.isArray(row.hits) ? row.hits.join(' · ') : ''
  const tierClass = row.tier === 'focus' ? 'tier-focus' : 'tier-wait'
  const tierLabel = row.tier === 'focus' ? '观察' : '等待'
  return `  <tr>
    <td>${index + 1}</td>
    <td class="freeze f-sym"><span>${esc(row.symbol ?? '')}</span></td>
    <td class="freeze f-name"><span>${esc(row.label ?? '')}</span></td>
    <td>${esc(row.market ?? '')}</td>
    <td><span class="${tierClass}">${tierLabel}</span></td>
    <td>${esc(num(row.poolScore))} / ${esc(num(row.poolMaxScore))}</td>
    <td>${esc(num(row.screenScore))}</td>
    <td title="${esc(hits)}">${esc(hits.length > 64 ? `${hits.slice(0, 61)}…` : hits)}</td>
  </tr>`
}

function dateOf(data) {
  return String(data.generatedAt ?? '').slice(0, 10) || 'report'
}

function num(value) {
  return Number.isFinite(value) ? String(value) : '—'
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
