#!/usr/bin/env node
// 把 replay-latest.json 渲染成单文件静态报告页。
//
// 设计：
//   - 成交明细表横向滚动（sticky 表头 + sticky 前四列），列可一键隐藏全空列
//   - 页面底部按分组列出每个输出字段的备注；数据里出现但没备注的字段会被单独点名
//   - 数据内嵌进 HTML（小于 8MB 时），否则回退到同目录 data.json

import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SECTION_NOTES, TOP_LEVEL_NOTES, TRADE_FIELD_NOTES } from './replay-field-glossary.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC_JSON = join(ROOT, 'src', 'data', 'replay-latest.json')
const PUBLIC_DIR = join(ROOT, 'public', 'replay')
const INLINE_LIMIT = 8 * 1024 * 1024

const LEADING_COLUMNS = [
  'symbol',
  'name',
  'market',
  'profile',
  'signalDate',
  'entryDate',
  'exitDate',
  'reason',
  'actualHoldSessions',
  'grossReturnPct',
  'netReturnPct',
  'holdingGateVerdict',
  'holdingGateEnforced',
  'dynamicPhase',
]

const raw = await readFile(SRC_JSON, 'utf8')
const payload = JSON.parse(raw)
const trades = Array.isArray(payload.trades) ? payload.trades : []
const signals = Array.isArray(payload.signals) ? payload.signals : []
const rows = trades.length ? trades : signals
const rowKey = trades.length ? 'trades' : 'signals'

const columns = buildColumns(rows, LEADING_COLUMNS)
const bodyJson = `${JSON.stringify(payload, null, 2)}\n`
const inline = bodyJson.length <= INLINE_LIMIT
const generatedDate = String(payload.generatedAt ?? '').slice(0, 10)
const html = renderPage({ payload, rows, rowKey, columns })

await mkdir(PUBLIC_DIR, { recursive: true })
await writeFile(join(PUBLIC_DIR, 'index.html'), html, 'utf8')
await writeFile(join(PUBLIC_DIR, 'data.json'), bodyJson, 'utf8')
if (generatedDate) {
  const datedDir = join(PUBLIC_DIR, generatedDate)
  await mkdir(datedDir, { recursive: true })
  await writeFile(join(datedDir, 'index.html'), html, 'utf8')
  await copyFile(join(PUBLIC_DIR, 'data.json'), join(datedDir, 'data.json'))
}

console.log(`生成 replay 报告页：${join(PUBLIC_DIR, 'index.html')}（${rowKey}=${rows.length} / 列=${columns.length} / 内嵌=${inline}）`)
if (collectUndocumented(rows, columns).length) {
  console.warn(`  [warn] 以下字段出现在数据里但没有备注：${collectUndocumented(rows, columns).join(', ')}`)
}

function buildColumns(list, leading) {
  const seen = new Set()
  for (const row of list) for (const key of Object.keys(row ?? {})) seen.add(key)
  const head = leading.filter((key) => seen.has(key))
  const tail = [...seen].filter((key) => !head.includes(key)).sort((a, b) => a.localeCompare(b))
  return [...head, ...tail]
}

function renderPage({ payload, rows, rowKey, columns }) {
  const summary = payload.summary ?? {}
  const statistics = payload.statistics ?? null
  const benchmarks = payload.benchmarks ?? null
  const risk = payload.riskMetrics ?? null
  const walkForward = payload.walkForward ?? null
  const sensitivity = payload.sensitivity ?? null
  const audit = payload.executionAudit ?? null
  const decay = Array.isArray(payload.signalDecay) ? payload.signalDecay : null
  const config = payload.config ?? {}
  const undocumented = collectUndocumented(rows, columns)

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>REPLAY 报告 ${esc(generatedDateOf(payload))}</title>
<style>
  :root {
    --bg: #fbfbfa; --surface: #fff; --ink: #1b1b1b; --muted: #6b6b6b;
    --line: #e2e2df; --accent: #0e7558; --warn: #b3261e; --chip: #f2f2ef;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.55 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
  header.page { padding: 18px 20px 10px; border-bottom: 1px solid var(--line); background: var(--surface); }
  h1 { margin: 0 0 4px; font-size: 1.16rem; }
  h2 { margin: 26px 20px 8px; font-size: 1rem; }
  h3 { margin: 16px 20px 6px; font-size: .86rem; color: var(--muted); font-weight: 700; }
  .meta { color: var(--muted); font-size: .76rem; display: flex; flex-wrap: wrap; gap: 6px 16px; }
  code { background: var(--chip); padding: 1px 5px; border-radius: 4px; font-size: .76rem; }
  .cmd { display: block; margin-top: 8px; padding: 8px 10px; background: var(--chip); border-radius: 6px; word-break: break-all; }
  .wrap { padding: 0 20px 40px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin: 12px 0 0; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; }
  .card b { display: block; font-size: .62rem; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; }
  .card span { font-size: 1.02rem; font-weight: 800; font-variant-numeric: tabular-nums; }
  table.grid { border-collapse: separate; border-spacing: 0; font-size: .7rem; }
  table.grid th, table.grid td { padding: 5px 8px; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); white-space: nowrap; text-align: left; }
  table.grid th { position: sticky; top: 0; background: var(--surface); z-index: 3; font-size: .64rem; color: var(--muted); }
  table.grid td.sticky, table.grid th.sticky { position: sticky; background: var(--bg); z-index: 2; }
  table.grid th.sticky { z-index: 4; background: var(--surface); }
  table.grid tbody tr:nth-child(even) td { background: #f6f6f4; }
  table.grid tbody tr:hover td { background: #eef5f1; }
  .scroll-x { overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
  .hint { color: var(--muted); font-size: .72rem; margin: 6px 0 0; }
  table.plain { border-collapse: collapse; margin: 0 20px; font-size: .76rem; }
  table.plain th, table.plain td { border: 1px solid var(--line); padding: 5px 8px; text-align: left; vertical-align: top; background: var(--surface); }
  table.plain th { background: var(--chip); }
  .glossary td.k { width: 240px; font-family: Consolas, monospace; font-size: .72rem; }
  .ok { color: var(--accent); }
  .bad { color: var(--warn); }
  .toolbar { display: flex; align-items: center; gap: 12px; margin: 10px 0 0; font-size: .76rem; color: var(--muted); }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #16171a; --surface: #1d1f23; --ink: #e9e9e6; --muted: #9a9a95; --line: #2e3136; --chip: #24262b; }
    table.grid tbody tr:nth-child(even) td { background: #1a1c20; }
    table.grid tbody tr:hover td { background: #22302b; }
  }
</style>
</head>
<body>
<header class="page">
  <h1>T+1 Short-Hold Replay 报告</h1>
  <div class="meta">
    <span>生成 ${esc(payload.generatedAt ?? '')}</span>
    <span>市场 ${esc((payload.filters?.markets ?? config.markets ?? []).join(' / ') || '—')}</span>
    <span>档位 ${esc(config.profile ?? '—')}</span>
    <span>模式 ${esc(config.mode ?? '—')}</span>
    <span>费率 ${esc(pctText(config.feeRate))}</span>
    <span>持有门 ${esc(config.holdingGate ?? '—')}</span>
    <span>滑点 ${esc(config.execution?.slippageModel ?? '—')}</span>
    <span>数据日 ${esc(payload.freshness?.newestDataThrough ?? '—')}</span>
    <span>证据模式 ${esc(payload.evidenceMode ?? '—')}</span>
  </div>
  ${payload.reportCommand ? `<code class="cmd">${esc(payload.reportCommand)}</code>` : ''}
</header>
<div class="wrap">
  ${renderCards({ summary, statistics, risk, walkForward, sensitivity })}
  ${renderExecutionAudit(audit)}
  ${renderStatistics(statistics)}
  ${renderBenchmarks(benchmarks)}
  ${renderWalkForward(walkForward)}
  ${renderDecay(decay, payload)}
  ${renderSensitivity(sensitivity)}
  ${renderSkipped(payload.skipped)}
  <h2>成交明细（${rowKey} = ${rows.length}）</h2>
  <div class="toolbar">
    <label><input type="checkbox" id="hide-empty" /> 隐藏全空列</label>
    <span>表格可以横向滚动；左侧 4 列固定。</span>
  </div>
  <div class="scroll-x" id="trade-scroll">${renderTradeTable(rows, columns)}</div>
  ${renderGlossary({ columns, undocumented, sectionNotes: SECTION_NOTES })}
</div>
<script>
  const box = document.getElementById('hide-empty');
  const table = document.querySelector('#trade-scroll table.grid');
  if (box && table) {
    const emptyColumns = ${JSON.stringify(findEmptyColumns(rows, columns))};
    const headers = [...table.tHead.rows[0].cells];
    const stickyCount = headers.filter((cell) => cell.classList.contains('sticky')).length;
    box.addEventListener('change', () => {
      for (const index of emptyColumns) {
        if (index < stickyCount) continue;
        for (const row of table.rows) {
          const cell = row.cells[index];
          if (cell) cell.style.display = box.checked ? 'none' : '';
        }
      }
    });
  }
</script>
</body>
</html>
`
}

function renderCards({ summary, statistics, risk, walkForward, sensitivity }) {
  const cards = [
    ['成交笔数', summary.trades ?? 0],
    ['胜率', pctText(summary.winRatePct, true)],
    ['均值', pctText(summary.avgNetPct, true)],
    ['中位', pctText(summary.medianNetPct, true)],
    ['p10 / p90', `${num(summary.p10NetPct)} / ${num(summary.p90NetPct)}`],
    ['最大回撤', risk ? pctText(risk.maxDrawdownPct, true) : '—'],
    ['年化夏普', risk ? num(risk.annualizedSharpe) : '—'],
    ['样本外折', walkForward?.aggregate?.folds ?? '—'],
    ['样本外一致性', walkForward?.aggregate?.consistency ?? '—'],
    ['敏感性稳定性', sensitivity?.enabled ? String(sensitivity.stabilityScore ?? '—') : '未开启'],
    ['t / p', statistics ? `${num(statistics.tStat)} / ${num(statistics.pValue)}` : '—'],
  ]
  return `<div class="cards">${cards
    .map(([label, value]) => `<div class="card"><b>${esc(label)}</b><span>${esc(String(value))}</span></div>`)
    .join('')}</div>`
}

function renderExecutionAudit(audit) {
  if (!audit) return ''
  const keys = Object.keys(audit)
  const balanced = (audit.signals ?? 0) === (audit.accepted ?? 0) + keys.filter((k) => k !== 'signals' && k !== 'accepted').reduce((sum, k) => sum + (audit[k] ?? 0), 0)
  return `<h2>执行现实审计</h2>
  <table class="plain">
    <thead><tr><th>字段</th><th>数量</th><th>备注</th></tr></thead>
    <tbody>
      ${keys
        .map(
          (key) => `<tr><td class="k"><code>${esc(key)}</code></td><td>${esc(String(audit[key]))}</td><td>${esc(SECTION_NOTES.executionAudit[key] ?? '')}</td></tr>`,
        )
        .join('')}
      <tr><td>账目平衡</td><td class="${balanced ? 'ok' : 'bad'}">${balanced ? 'signals = accepted + 各项阻断' : '对不上，有信号被静默丢弃'}</td><td>这一行是判断审计是否可信的关键。</td></tr>
    </tbody>
  </table>`
}

function renderStatistics(statistics) {
  if (!statistics) return '<h2>统计</h2><p class="hint">本次没有收益样本（latest 模式或零成交）。</p>'
  const scalarKeys = ['n', 'meanPct', 'medianPct', 'stdPct', 'tStat', 'pValue', 'sampleWarning']
  const rows = scalarKeys.map((key) => `<tr><td class="k"><code>${esc(key)}</code></td><td>${esc(valueText(statistics[key]))}</td><td>${esc(SECTION_NOTES.statistics[key] ?? '')}</td></tr>`)
  if (statistics.bootstrapCI95Pct) {
    rows.push(
      `<tr><td class="k"><code>bootstrapCI95Pct</code></td><td>${esc(`[${num(statistics.bootstrapCI95Pct.lowPct)}, ${num(statistics.bootstrapCI95Pct.highPct)}]`)}</td><td>${esc(SECTION_NOTES.statistics.bootstrapCI95Pct)}</td></tr>`,
    )
  }
  const groups = []
  for (const [groupKey, note] of Object.entries(SECTION_NOTES.statistics)) {
    const value = statistics[groupKey]
    if (!Array.isArray(value) || !value.length) continue
    groups.push(`<h3>${esc(groupKey)} — ${esc(note)}</h3>${renderObjectTable(value)}`)
  }
  return `<h2>统计量</h2>
  <table class="plain glossary"><thead><tr><th>字段</th><th>值</th><th>备注</th></tr></thead><tbody>${rows.join('')}</tbody></table>
  ${groups.join('')}`
}

function renderBenchmarks(benchmarks) {
  if (!benchmarks) return ''
  const blocks = Object.entries(benchmarks)
    .filter(([, value]) => value && typeof value === 'object')
    .map(([key, value]) => `<h3>${esc(key)} — ${esc(SECTION_NOTES.benchmarks[key] ?? '')}</h3>${renderObjectTable([value])}`)
  return `<h2>对照基准</h2>${blocks.join('')}`
}

function renderWalkForward(walkForward) {
  if (!walkForward) return ''
  if (!walkForward.enabled) {
    return `<h2>样本外折（walk-forward）</h2><p class="hint">${
      walkForward.note ?? '未开启。加 --validate walk-forward 才会切分样本内外。'
    }</p>`
  }
  const parts = [`<p class="hint">${esc(walkForward.note ?? '')}</p>`]
  if (walkForward.aggregate) parts.push(`<h3>aggregate</h3>${renderObjectTable([walkForward.aggregate])}`)
  if (walkForward.folds?.length) parts.push(`<h3>folds — ${esc(SECTION_NOTES.walkForward.folds)}</h3>${renderObjectTable(walkForward.folds)}`)
  if (walkForward.outOfSampleStatistics) {
    parts.push(`<h3>outOfSampleStatistics — ${esc(SECTION_NOTES.walkForward.outOfSampleStatistics)}</h3>${renderObjectTable([walkForward.outOfSampleStatistics])}`)
  }
  if (walkForward.warnings?.length) parts.push(`<h3>warnings</h3><ul>${walkForward.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`)
  return `<h2>样本外折（walk-forward）</h2>${parts.join('')}`
}

function renderDecay(decay, payload) {
  if (!decay) return ''
  return `<h2>信号衰减</h2><p class="hint">${esc(payload.signalDecaySemantics ?? '')}（来源：${esc(payload.signalDecayHorizonSource ?? '—')}）</p>${renderObjectTable(decay)}`
}

function renderSensitivity(sensitivity) {
  if (!sensitivity) return ''
  if (!sensitivity.enabled) {
    return `<h2>参数敏感性</h2><p class="hint">${esc(sensitivity.note ?? '未开启。加 --sensitivity thresholds 才会扰动阈值重跑。')}</p>`
  }
  const parts = [
    `<p class="hint">stabilityScore = ${esc(String(sensitivity.stabilityScore))}（可解释：${esc(String(sensitivity.stabilityScoreInterpretable))}）— ${esc(sensitivity.stabilityScoreFormula ?? '')}</p>`,
  ]
  if (sensitivity.byParameter?.length) parts.push(`<h3>byParameter — ${esc(SECTION_NOTES.sensitivity.byParameter)}</h3>${renderObjectTable(sensitivity.byParameter)}`)
  if (sensitivity.variants?.length) parts.push(`<h3>variants</h3>${renderObjectTable(sensitivity.variants)}`)
  if (sensitivity.warnings?.length) parts.push(`<h3>warnings</h3><ul>${sensitivity.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`)
  return `<h2>参数敏感性</h2>${parts.join('')}`
}

function renderSkipped(skipped) {
  if (!Array.isArray(skipped) || !skipped.length) return ''
  const sample = skipped.slice(0, 50)
  return `<h2>被跳过的标的（${skipped.length}，最多显示 50）</h2>${renderObjectTable(sample)}`
}

function renderTradeTable(rows, columns) {
  if (!rows.length) return '<p class="hint" style="padding:12px">本次没有成交行。</p>'
  const head = columns
    .map((key, index) => `<th class="${index < 4 ? 'sticky' : ''}" title="${esc(TRADE_FIELD_NOTES[key] ?? '')}">${esc(key)}</th>`)
    .join('')
  const body = rows
    .map(
      (row) =>
        `<tr>${columns
          .map((key, index) => `<td class="${index < 4 ? 'sticky' : ''}" title="${esc(TRADE_FIELD_NOTES[key] ?? '')}">${esc(valueText(row[key]))}</td>`)
          .join('')}</tr>`,
    )
    .join('')
  return `<table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

function renderGlossary({ columns, undocumented, sectionNotes }) {
  const tradeRows = columns
    .map((key) => `<tr><td class="k"><code>${esc(key)}</code></td><td>${esc(TRADE_FIELD_NOTES[key] ?? '未注明')}</td></tr>`)
    .join('')
  const topRows = Object.entries(TOP_LEVEL_NOTES)
    .map(([key, note]) => `<tr><td class="k"><code>${esc(key)}</code></td><td>${esc(note)}</td></tr>`)
    .join('')
  const sectionRows = Object.entries(sectionNotes)
    .flatMap(([section, entries]) => {
      const head = `<tr><th colspan="2">${esc(section)}</th></tr>`
      return head + Object.entries(entries).map(([key, note]) => `<tr><td class="k"><code>${esc(key)}</code></td><td>${esc(note)}</td></tr>`)
    })
    .join('')
  const missing = undocumented.length
    ? `<p class="hint">以下字段出现在数据里但还没有备注：<code>${undocumented.map((key) => esc(key)).join('</code> <code>')}</code></p>`
    : '<p class="hint ok">成交行的每一个字段都有备注。</p>'
  return `<h2>参数注释</h2>
  ${missing}
  <h3>成交行字段</h3>
  <table class="plain glossary"><tbody>${tradeRows}</tbody></table>
  <h3>顶层输出块</h3>
  <table class="plain glossary"><tbody>${topRows}</tbody></table>
  <h3>统计 / 基准 / 折 / 执行 / 敏感性字段</h3>
  <table class="plain glossary"><tbody>${sectionRows}</tbody></table>`
}

function renderObjectTable(list) {
  if (!Array.isArray(list) || !list.length) return ''
  const keys = []
  for (const item of list) for (const key of Object.keys(item ?? {})) if (!keys.includes(key)) keys.push(key)
  const head = keys.map((key) => `<th>${esc(key)}</th>`).join('')
  const body = list
    .map((item) => `<tr>${keys.map((key) => `<td>${esc(valueText(item?.[key]))}</td>`).join('')}</tr>`)
    .join('')
  return `<table class="plain"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

function findEmptyColumns(rows, columns) {
  return columns.reduce((acc, key, index) => {
    const allEmpty = rows.every((row) => row?.[key] === null || row?.[key] === undefined || row?.[key] === '')
    if (allEmpty) acc.push(index)
    return acc
  }, [])
}

function collectUndocumented(rows, columns) {
  const missing = new Set()
  for (const key of columns) if (!TRADE_FIELD_NOTES[key]) missing.add(key)
  for (const row of rows.slice(0, 200)) {
    for (const [key, value] of Object.entries(row ?? {})) {
      if (TRADE_FIELD_NOTES[key]) continue
      missing.add(key)
      void value
    }
  }
  return [...missing].sort()
}

function generatedDateOf(payload) {
  return String(payload.generatedAt ?? '').slice(0, 10) || 'report'
}

function valueText(value) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.length > 12 ? `[${value.length} 项]` : JSON.stringify(value)
  const json = JSON.stringify(value)
  return json && json.length > 120 ? `${json.slice(0, 117)}…` : (json ?? '—')
}

function num(value) {
  return Number.isFinite(value) ? String(value) : '—'
}

function pctText(value, alreadyPercent = false) {
  if (!Number.isFinite(value)) return '—'
  return alreadyPercent ? `${value}%` : `${(value * 100).toFixed(2)}%`
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}