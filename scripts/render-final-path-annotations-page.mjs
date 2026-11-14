#!/usr/bin/env node
// 渲染第四步结论的历史路径旁注，不改变最终排序。

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const LATEST_PATH = join(ROOT, 'src', 'data', 'final-path-annotations-latest.json')
const PUBLIC_DIR = join(ROOT, 'public', 'final-path-annotations')

const data = JSON.parse(await readFile(LATEST_PATH, 'utf8'))
const html = renderPage(data)
await mkdir(PUBLIC_DIR, { recursive: true })
await writeFile(join(PUBLIC_DIR, 'index.html'), html, 'utf8')
console.log(`最终路径旁注页生成：${join(PUBLIC_DIR, 'index.html')}（${data.items.length}行）`)

function renderPage(payload) {
  const rows = payload.items.map(renderRow).join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>第四步结论 · 历史路径旁注</title>
<style>
  :root { --bg:#f7f8f7; --surface:#fff; --ink:#18201d; --muted:#6a736f; --line:#dfe5e2; --chip:#edf3f0; --accent:#0e7558; --warn:#a46a00; --bad:#b3342b; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.55 "Segoe UI","Microsoft YaHei",system-ui,sans-serif; }
  header { padding:18px 22px 14px; background:var(--surface); border-bottom:1px solid var(--line); }
  h1 { margin:0 0 4px; font-size:1.2rem; }
  .meta { color:var(--muted); font-size:.76rem; display:flex; gap:8px 16px; flex-wrap:wrap; }
  main { padding:18px 20px 36px; }
  .banner { max-width:1280px; margin:0 auto 14px; padding:10px 13px; border-left:3px solid var(--accent); background:var(--chip); border-radius:0 7px 7px 0; font-size:.8rem; }
  .summary { max-width:1280px; margin:0 auto 12px; display:flex; gap:8px; flex-wrap:wrap; }
  .pill { background:var(--surface); border:1px solid var(--line); border-radius:999px; padding:3px 9px; font-size:.72rem; color:var(--muted); }
  .table-wrap { max-width:1280px; margin:auto; overflow:auto; border:1px solid var(--line); border-radius:9px; background:var(--surface); }
  table { width:100%; border-collapse:collapse; font-size:.78rem; }
  th,td { padding:8px 10px; border-bottom:1px solid var(--line); text-align:left; white-space:nowrap; }
  th { position:sticky; top:0; background:var(--chip); color:var(--muted); font-size:.7rem; z-index:1; }
  tr:last-child td { border-bottom:0; }
  .num { text-align:right; font-family:Consolas,monospace; }
  .high { color:var(--bad); font-weight:700; }
  .watch { color:var(--warn); font-weight:600; }
  .normal { color:var(--accent); }
  .mark { display:inline-block; margin-left:5px; padding:1px 5px; border-radius:4px; background:var(--chip); font-size:.62rem; }
  .hint { max-width:1280px; margin:10px auto 0; color:var(--muted); font-size:.74rem; }
  a { color:#1f5fbf; }
  @media (prefers-color-scheme:dark) {
    :root { --bg:#151816; --surface:#1d211f; --ink:#e8ece9; --muted:#9da6a1; --line:#303733; --chip:#232b27; --accent:#58b996; --warn:#e0b160; --bad:#ff8c83; }
    a { color:#82b2ff; }
  }
</style>
</head>
<body>
<header>
  <h1>第四步结论 · 历史路径旁注</h1>
  <div class="meta">
    <span>最终名单生成 ${esc(payload.sourceFinalGeneratedAt ?? '—')}</span>
    <span>旁注生成 ${esc(payload.generatedAt)}</span>
    <span>最终名单与排序未修改</span>
  </div>
</header>
<main>
  <div class="banner">
    本页在第四步完成之后单独计算：整段历史成本锚下侧比例、整段年化对数斜率、整段收盘最大回撤。
    三项仅作标注，不参与最终排名、最终分数或资金流权重。
  </div>
  <div class="summary">
    <span class="pill">最终结论 ${payload.counts.final}</span>
    <span class="pill">成功旁注 ${payload.counts.annotated}</span>
    <span class="pill">锚下高 ${payload.counts.markCounts.belowAnchorRatio.high}</span>
    <span class="pill">斜率高风险 ${payload.counts.markCounts.annualizedLogSlope.high}</span>
    <span class="pill">深回撤高 ${payload.counts.markCounts.maxCloseDrawdown.high}</span>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th>最终#</th><th>代码</th><th>名称</th><th>最终分</th>
        <th>成本锚下侧比例</th><th>整段年化对数斜率</th><th>历史最大回撤</th>
        <th>历史区间</th><th>样本行</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="9">暂无第四步结论。</td></tr>'}</tbody>
    </table>
  </div>
  <p class="hint">
    标记规则：锚下比例 ≥65% 为高、≥55% 为关注；年化斜率 ≤-20% 为高、≤-10% 为关注；
    最大回撤 ≤-70% 为高、≤-50% 为关注。
    返回 <a href="/final-funnel/">第四步最终结论</a> 或 <a href="/control/">控制台</a>。
  </p>
</main>
</body>
</html>`
}

function renderRow(item) {
  const a = item.annotation
  if (a.status !== 'ok') {
    return `<tr><td>${esc(item.finalRank)}</td><td>${esc(item.symbol)}</td><td>${esc(item.label)}</td><td class="num">${fmt(item.finalScore)}</td><td colspan="5">历史不足：${esc(a.rows ?? 0)} 行</td></tr>`
  }
  return `<tr>
    <td>${esc(item.finalRank)}</td>
    <td>${esc(item.symbol)}</td>
    <td>${esc(item.label)}</td>
    <td class="num">${fmt(item.finalScore)}</td>
    <td class="num ${a.marks.belowAnchorRatio}">${pct(a.belowAnchorRatio)}${mark(a.marks.belowAnchorRatio)}</td>
    <td class="num ${a.marks.annualizedLogSlope}">${signedPct(a.annualizedLogSlope)}${mark(a.marks.annualizedLogSlope)}</td>
    <td class="num ${a.marks.maxCloseDrawdown}">${signedPct(a.maxCloseDrawdown)}${mark(a.marks.maxCloseDrawdown)}</td>
    <td>${esc(a.dataFrom)} ~ ${esc(a.dataThrough)}</td>
    <td class="num">${a.rows}</td>
  </tr>`
}

function mark(value) {
  return value === 'high' ? '<span class="mark">高</span>' : value === 'watch' ? '<span class="mark">关注</span>' : ''
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
}

function signedPct(value) {
  if (!Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
}

function fmt(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '—'
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
