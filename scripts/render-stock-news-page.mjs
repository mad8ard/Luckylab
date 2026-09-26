#!/usr/bin/env node
// 把 stock-news-latest.json 渲染成单文件静态报告页。
//
// 与 replay 报告页同一套约定：表格横向滚动 + 底部字段注释 + 自包含 HTML。

import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DERIVED_NOTES,
  SOURCE_NOTES,
  SYMBOL_NOTES,
  TOP_LEVEL_NOTES,
  noteForColumn,
} from './stock-news-field-glossary.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC_JSON = join(ROOT, 'src', 'data', 'stock-news-latest.json')
const PUBLIC_DIR = join(ROOT, 'public', 'stock-news')

const payload = JSON.parse(await readFile(SRC_JSON, 'utf8'))
const symbols = Array.isArray(payload.symbols) ? payload.symbols : []
const generatedDate = String(payload.generatedAt ?? '').slice(0, 10)
const html = renderPage({ payload, symbols })

await mkdir(PUBLIC_DIR, { recursive: true })
await writeFile(join(PUBLIC_DIR, 'index.html'), html, 'utf8')
await writeFile(join(PUBLIC_DIR, 'data.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
if (generatedDate) {
  const datedDir = join(PUBLIC_DIR, generatedDate)
  await mkdir(datedDir, { recursive: true })
  await writeFile(join(datedDir, 'index.html'), html, 'utf8')
  await copyFile(join(PUBLIC_DIR, 'data.json'), join(datedDir, 'data.json'))
}

const undocumented = collectUndocumentedColumns(symbols)
console.log(`生成消息面报告页：${join(PUBLIC_DIR, 'index.html')}（标的=${symbols.length}）`)
if (undocumented.length) console.warn(`  [warn] 以下列名还没有备注：${undocumented.join(', ')}`)

function renderPage({ payload, symbols }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>消息面报告 ${esc(generatedDate)}</title>
<style>
  :root { --bg:#fbfbfa; --surface:#fff; --ink:#1b1b1b; --muted:#6b6b6b; --line:#e2e2df; --accent:#0e7558; --warn:#b3261e; --chip:#f2f2ef; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.55 "Segoe UI","Microsoft YaHei",system-ui,sans-serif; }
  header.page { padding:18px 20px 12px; border-bottom:1px solid var(--line); background:var(--surface); }
  h1 { margin:0 0 6px; font-size:1.16rem; }
  h2 { margin:26px 20px 8px; font-size:1.02rem; padding-top:10px; border-top:2px solid var(--line); }
  h3 { margin:14px 20px 6px; font-size:.86rem; color:var(--muted); }
  .meta { color:var(--muted); font-size:.76rem; display:flex; flex-wrap:wrap; gap:6px 16px; }
  code { background:var(--chip); padding:1px 5px; border-radius:4px; font-size:.76rem; }
  .notice { margin:10px 20px 0; padding:9px 11px; border-left:3px solid var(--accent); background:var(--chip); font-size:.78rem; }
  .notice.bad { border-left-color:var(--warn); }
  .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(158px,1fr)); gap:8px; margin:12px 20px 0; }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:6px; padding:8px 10px; }
  .card b { display:block; font-size:.62rem; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; }
  .card span { font-size:1.02rem; font-weight:800; font-variant-numeric:tabular-nums; }
  .card em { display:block; font-style:normal; font-size:.66rem; color:var(--muted); }
  details { margin:10px 20px; background:var(--surface); border:1px solid var(--line); border-radius:6px; }
  details > summary { cursor:pointer; padding:8px 11px; font-size:.8rem; display:flex; gap:10px; flex-wrap:wrap; align-items:baseline; }
  details > summary b { font-size:.84rem; }
  details > summary span { color:var(--muted); font-size:.72rem; }
  .body { padding:0 11px 11px; }
  table.grid { border-collapse:separate; border-spacing:0; font-size:.7rem; }
  table.grid th, table.grid td { padding:5px 8px; border-bottom:1px solid var(--line); border-right:1px solid var(--line); white-space:nowrap; text-align:left; vertical-align:top; }
  table.grid th { position:sticky; top:0; background:var(--surface); z-index:3; font-size:.64rem; color:var(--muted); }
  table.grid td.wrap { white-space:normal; min-width:320px; max-width:520px; }
  .scroll-x { overflow-x:auto; border:1px solid var(--line); border-radius:6px; background:var(--surface); }
  table.plain { border-collapse:collapse; margin:0 20px; font-size:.76rem; }
  table.plain th, table.plain td { border:1px solid var(--line); padding:5px 8px; text-align:left; vertical-align:top; background:var(--surface); }
  table.plain th { background:var(--chip); }
  .glossary td.k { width:250px; font-family:Consolas,monospace; font-size:.72rem; }
  ul.tight { margin:6px 0 0; padding-left:20px; }
  ul.tight li { margin:2px 0; }
  .hint { color:var(--muted); font-size:.72rem; margin:6px 20px; }
  .ok { color:var(--accent); }
  .bad { color:var(--warn); }
  a { color:#1f5fbf; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16171a; --surface:#1d1f23; --ink:#e9e9e6; --muted:#9a9a95; --line:#2e3136; --chip:#24262b; }
    a { color:#7fb0ff; }
  }
</style>
</head>
<body>
<header class="page">
  <h1>A 股消息面按需报告</h1>
  <div class="meta">
    <span>抓取 ${esc(payload.generatedAt ?? '')}</span>
    <span>标的 ${symbols.length} 只</span>
    <span>市场 ${esc((payload.markets ?? []).join(' / ') || '—')}</span>
    <span>AkShare ${esc(payload.akshareVersion ?? '—')}</span>
    <span>每源保留 ${esc(String(payload.recentRowsPerSource ?? '—'))} 行</span>
  </div>
  <div class="notice">
    <b>这份报告不参与评分。</b>${esc(payload.researchBoundary?.reasons?.join('；') ?? '')}
    量价评分仍只由 OHLCV 决定；这里的内容是给你人工复核用的外部证据，抓取时间即事实边界。
  </div>
</header>
${symbols.map((entry) => renderSymbol(entry)).join('\n')}
${renderGlossary(symbols)}
</body>
</html>
`
}

function renderSymbol(entry) {
  const derived = entry.derived ?? {}
  const failed = derived.failedSources ?? []
  return `<h2>${esc(entry.symbol)} · ${esc(entry.market)} <span class="hint">抓取于 ${esc(entry.fetchedAt ?? '')}</span></h2>
  ${failed.length ? `<div class="notice bad">本次未取到：<code>${failed.map((id) => esc(id)).join('</code> <code>')}</code></div>` : ''}
  ${renderCards(derived)}
  ${renderHeadlines(derived)}
  ${(entry.sources ?? []).map((source) => renderSource(source)).join('\n')}`
}

function renderCards(derived) {
  const cards = []
  const push = (label, value, extra = '') => {
    if (value === null || value === undefined || value === '') return
    cards.push({ label, value, extra })
  }
  push('近 7 天新闻', derived.news?.last7d, derived.news?.latestDate ? `最新 ${derived.news.latestDate}` : '')
  push('近 30 天新闻', derived.news?.last30d, `累计 ${derived.news?.total ?? 0} 条`)
  push('最新评级', derived.research?.latestRating, derived.research?.latestInstitution ?? '')
  push('研报总数', derived.research?.total, `近期样本 ${derived.research?.recentWindowSamples ?? 0}`)
  push('公告总数', derived.notice?.total, derived.notice?.latestDate ? `最新 ${derived.notice.latestDate}` : '')
  push('股东户数', fmtNumber(derived.gdhs?.latestHolders), derived.gdhs?.latestDate ?? '')
  push('户数环比', derived.gdhs?.changePct === undefined ? undefined : `${fmtNumber(derived.gdhs.changePct)}%`, '正=分散 · 负=集中')
  push('北向持股占比', derived.hsgt?.latestHoldPct === undefined ? undefined : `${fmtNumber(derived.hsgt.latestHoldPct)}%`, derived.hsgt?.latestDate ?? '')
  push('机构参与度', fmtNumber(derived.institution?.latest), `5 日均 ${fmtNumber(derived.institution?.mean5)}`)
  push('用户关注指数', fmtNumber(derived.focus?.latest), `5 日均 ${fmtNumber(derived.focus?.mean5)}`)
  push('综合评分', fmtNumber(derived.score?.latest), `5 日均 ${fmtNumber(derived.score?.mean5)}`)
  push('参与意愿', fmtNumber(derived.desire?.latest), `5 日均 ${fmtNumber(derived.desire?.mean5)}`)
  push('主力净流入 5 日', fmtNumber(derived.fundflow?.mainNetLast5), '单位：元')
  if (!cards.length) return ''
  return `<div class="cards">${cards
    .map((card) => `<div class="card"><b>${esc(card.label)}</b><span>${esc(String(card.value))}</span>${card.extra ? `<em>${esc(card.extra)}</em>` : ''}</div>`)
    .join('')}</div>`
}

function renderHeadlines(derived) {
  const blocks = []
  if (derived.notice?.latestTitles?.length) {
    blocks.push(`<h3>最新公告</h3><ul class="tight">${derived.notice.latestTitles
      .slice(0, 6)
      .map((item) => `<li>${esc(item.date ?? '')} — <a href="${esc(item.url ?? '#')}" target="_blank" rel="noreferrer">${esc(item.title ?? '')}</a></li>`)
      .join('')}</ul>`)
  }
  if (derived.research?.latestTitles?.length) {
    blocks.push(`<h3>最新研报标题</h3><ul class="tight">${derived.research.latestTitles
      .slice(0, 5)
      .map((title) => `<li>${esc(title ?? '')}</li>`)
      .join('')}</ul>`)
  }
  if (derived.news?.latestTitles?.length) {
    blocks.push(`<h3>最新新闻标题</h3><ul class="tight">${derived.news.latestTitles
      .slice(0, 5)
      .map((title) => `<li>${esc(title ?? '')}</li>`)
      .join('')}</ul>`)
  }
  return blocks.join('')
}

function renderSource(source) {
  const isOk = source.status === 'ok'
  const summary = `<summary><b>${esc(source.label)}</b><span>${esc(source.endpoint)}</span><span>${isOk ? `共 ${source.totalRows} 行 · 显示最近 ${source.shownRows} 行` : `<span class="bad">本次未取到</span>`}</span><span>${esc(source.elapsedMs ? `${source.elapsedMs} ms` : '')}</span></summary>`
  if (!isOk) {
    return `<details>${summary}<div class="body"><p class="hint">${esc(source.error ?? '')}</p><p class="hint">${esc(source.why ?? '')}</p></div></details>`
  }
  if (!source.recent?.length) {
    return `<details>${summary}<div class="body"><p class="hint">上游返回 0 行。</p></div></details>`
  }
  const columns = source.columns ?? []
  const head = columns.map((column) => `<th title="${esc(noteForColumn(column) ?? '')}">${esc(column)}</th>`).join('')
  const body = source.recent
    .map(
      (row) =>
        `<tr>${columns
          .map((column) => {
            const wide = /标题|内容|名称|报告/.test(column)
            return `<td class="${wide ? 'wrap' : ''}" title="${esc(noteForColumn(column) ?? '')}">${cellText(row[column], column)}</td>`
          })
          .join('')}</tr>`,
    )
    .join('')
  const notes = Object.entries(source.numericSummary ?? {})
    .map(([column, stat]) => `<tr><td class="k"><code>${esc(column)}</code></td><td>latest ${stat.latest} · mean5 ${stat.mean5} · min ${stat.min} · max ${stat.max} · 样本 ${stat.samples}</td></tr>`)
    .join('')
  return `<details>${summary}<div class="body">
    <p class="hint">${esc(source.why ?? '')} · 排序：<code>${esc(source.order ?? '')}</code></p>
    <div class="scroll-x"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    ${notes ? `<h3>数值列概览</h3><table class="plain"><tbody>${notes}</tbody></table>` : ''}
  </div></details>`
}

function renderGlossary(symbols) {
  const columns = new Set()
  for (const entry of symbols) for (const source of entry.sources ?? []) for (const column of source.columns ?? []) columns.add(column)
  const columnRows = [...columns]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((column) => `<tr><td class="k"><code>${esc(column)}</code></td><td>${esc(noteForColumn(column) ?? '未注明')}</td></tr>`)
    .join('')
  const topRows = Object.entries(TOP_LEVEL_NOTES).map(([key, note]) => row(key, note)).join('')
  const symbolRows = Object.entries(SYMBOL_NOTES).map(([key, note]) => row(key, note)).join('')
  const sourceRows = Object.entries(SOURCE_NOTES).map(([key, note]) => row(key, note)).join('')
  const derivedRows = Object.entries(DERIVED_NOTES)
    .flatMap(([section, value]) => {
      if (typeof value === 'string') return [`<tr><td class="k"><code>${esc(section)}</code></td><td>${esc(value)}</td></tr>`]
      return [`<tr><th colspan="2">${esc(section)}</th></tr>`].concat(Object.entries(value).map(([key, note]) => row(`${section}.${key}`, note)))
    })
    .join('')
  return `<h2>参数注释</h2>
  <h3>顶层块</h3><table class="plain glossary"><tbody>${topRows}</tbody></table>
  <h3>每只标的</h3><table class="plain glossary"><tbody>${symbolRows}</tbody></table>
  <h3>数据源字段</h3><table class="plain glossary"><tbody>${sourceRows}</tbody></table>
  <h3>派生指标</h3><table class="plain glossary"><tbody>${derivedRows}</tbody></table>
  <h3>上游列名</h3><table class="plain glossary"><tbody>${columnRows}</tbody></table>`
}

function row(key, note) {
  return `<tr><td class="k"><code>${esc(key)}</code></td><td>${esc(note)}</td></tr>`
}

function collectUndocumentedColumns(symbols) {
  const seen = new Set()
  for (const entry of symbols) for (const source of entry.sources ?? []) for (const column of source.columns ?? []) if (!noteForColumn(column)) seen.add(column)
  return [...seen].sort()
}

function cellText(value, column) {
  if (value === null || value === undefined) return '—'
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/链接|网址|PDF/.test(column) && /^https?:/.test(text)) return `<a href="${esc(text)}" target="_blank" rel="noreferrer">打开</a>`
  if (text.length > 160) return `${esc(text.slice(0, 157))}…`
  return esc(text)
}

function fmtNumber(value) {
  if (value === null || value === undefined || value === '') return undefined
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  if (Math.abs(number) >= 1e8) return `${(number / 1e8).toFixed(2)} 亿`
  if (Math.abs(number) >= 1e4) return `${(number / 1e4).toFixed(2)} 万`
  return String(Math.round(number * 100) / 100)
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}