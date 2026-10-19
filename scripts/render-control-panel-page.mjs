#!/usr/bin/env node
// 渲染 Market Lab 控制台：四个功能卡 + 折叠的维护区。
//
// 静态自包含：「打开结果页」「复制命令」在任何环境都能用；
// 「运行」只在 pnpm dev 下可用（页面会探测 /api/lab/*）。

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { COMMANDS, FUNCTIONS, REPORT_PAGES } from './control-commands.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PUBLIC_DIR = join(ROOT, 'public', 'control')

const html = renderPage()
await mkdir(PUBLIC_DIR, { recursive: true })
await writeFile(join(PUBLIC_DIR, 'index.html'), html, 'utf8')
console.log(`生成控制台页面：${join(PUBLIC_DIR, 'index.html')}（功能 ${FUNCTIONS.length} / 命令 ${COMMANDS.length}）`)

function renderPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Market Lab 控制台</title>
<style>
  :root { --bg:#fbfbfa; --surface:#fff; --ink:#1b1b1b; --muted:#6b6b6b; --line:#e2e2df; --accent:#0e7558; --warn:#b3261e; --chip:#f2f2ef; --mono:Consolas,"SF Mono",Menlo,monospace; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.55 "Segoe UI","Microsoft YaHei",system-ui,sans-serif; }
  header.page { padding:20px 22px 14px; border-bottom:1px solid var(--line); background:var(--surface); }
  h1 { margin:0 0 4px; font-size:1.2rem; }
  .meta { color:var(--muted); font-size:.76rem; display:flex; flex-wrap:wrap; gap:6px 16px; align-items:center; }
  .pill { padding:2px 9px; border-radius:999px; background:var(--chip); font-size:.72rem; }
  .pill.live { background:#e6f4ee; color:var(--accent); }
  .pill.static { background:#fdeceb; color:var(--warn); }
  code, pre { font-family:var(--mono); }
  .functions { display:grid; grid-template-columns:repeat(auto-fit,minmax(330px,1fr)); gap:12px; margin:16px 22px 0; }
  .func { position:relative; background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:15px 16px 14px 58px; display:grid; gap:8px; }
  .func .num { position:absolute; left:14px; top:13px; width:30px; height:30px; border-radius:50%; background:var(--accent); color:#fff; display:grid; place-items:center; font-weight:800; font-size:.86rem; }
  .func h2 { margin:0; font-size:.98rem; }
  .func p { margin:0; color:var(--muted); font-size:.78rem; min-height:2.6em; }
  .actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .secondary { display:flex; gap:6px; flex-wrap:wrap; }
  a.btn, button { font:inherit; font-size:.78rem; padding:5px 12px; border-radius:6px; border:1px solid var(--line); background:var(--surface); color:var(--ink); cursor:pointer; text-decoration:none; }
  a.btn:hover, button:hover { border-color:var(--accent); color:var(--accent); }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button.primary:hover { color:#fff; opacity:.9; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  button.small, a.small { font-size:.72rem; padding:3px 9px; }
  .when { color:var(--muted); font-size:.7rem; }
  details.maintenance { margin:22px 22px 0; background:var(--surface); border:1px solid var(--line); border-radius:8px; }
  details.maintenance > summary { cursor:pointer; padding:10px 13px; font-size:.84rem; }
  details.maintenance > summary span { color:var(--muted); font-size:.74rem; margin-left:8px; }
  table.cmds { width:100%; border-collapse:collapse; }
  table.cmds th, table.cmds td { padding:7px 10px; border-top:1px solid var(--line); text-align:left; font-size:.76rem; vertical-align:middle; }
  table.cmds th { color:var(--muted); font-size:.66rem; text-transform:uppercase; letter-spacing:.03em; background:var(--chip); }
  table.cmds td.cmd { font-family:var(--mono); font-size:.7rem; color:var(--muted); word-break:break-all; }
  table.cmds td.act { white-space:nowrap; text-align:right; }
  table.cmds input { font:inherit; font-family:var(--mono); font-size:.72rem; padding:4px 7px; border:1px solid var(--line); border-radius:5px; width:150px; background:var(--bg); color:var(--ink); }
  .tag { display:inline-block; padding:1px 6px; border-radius:4px; background:var(--chip); color:var(--muted); font-size:.66rem; margin-left:6px; }
  .tag.long { background:#fff4e5; color:#9a6200; }
  #log { margin:18px 22px 40px; }
  #log pre { background:#1c1f23; color:#e6e6e3; padding:12px 14px; border-radius:8px; max-height:420px; overflow:auto; font-size:.72rem; line-height:1.5; white-space:pre-wrap; word-break:break-all; }
  .hidden { display:none; }
  .hint { color:var(--muted); font-size:.74rem; margin:8px 22px; }
  .banner { margin:10px 22px 0; padding:9px 12px; border-left:3px solid var(--accent); background:var(--chip); font-size:.78rem; border-radius:0 6px 6px 0; }
  .banner.bad { border-left-color:var(--warn); }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16171a; --surface:#1d1f23; --ink:#e9e9e6; --muted:#9a9a95; --line:#2e3136; --chip:#24262b; }
    .pill.live { background:#17332a; } .pill.static { background:#3a1f1e; }
    .tag.long { background:#3a2c12; color:#e0b160; }
  }
</style>
</head>
<body>
<header class="page">
  <h1>Market Lab 控制台</h1>
  <div class="meta">
    <span id="api-status" class="pill">检测运行环境中…</span>
    <span>四个功能：更新仓库 / 推荐 / 回测验证 / 大盘信息</span>
  </div>
</header>
<div id="banner" class="banner hidden"></div>
<section class="functions">
${FUNCTIONS.map((fn, index) => renderFunction(fn, index)).join('\n')}
</section>
${renderMaintenance()}
<div id="log" class="hidden">
  <p class="hint" id="log-head"></p>
  <pre id="log-body"></pre>
</div>
<script>
  const COMMANDS = ${JSON.stringify(COMMANDS.map((item) => ({ id: item.id, label: item.label, display: item.display, hasArgs: Boolean(item.acceptsArgs) })))}
  const state = { live: false, jobId: null, timer: null }

  function setStatus() {
    const el = document.getElementById('api-status')
    const banner = document.getElementById('banner')
    if (state.live) {
      el.className = 'pill live'
      el.textContent = '可执行（dev 接口在线）'
      banner.className = 'banner hidden'
      return
    }
    el.className = 'pill static'
    el.textContent = '只读模式'
    banner.className = 'banner bad'
    banner.textContent =
      '当前是只读模式：可以复制命令、打开已有报告，但不能直接运行。要拿到「运行」按钮，请在项目目录执行 pnpm dev 后访问 http://localhost:5173/control/。'
  }

  async function probe() {
    try {
      const res = await fetch('/api/lab/reports', { cache: 'no-store' })
      if (!res.ok) throw new Error('bad status')
      const data = await res.json()
      state.live = Boolean(data.ok)
      for (const report of data.reports ?? []) {
        const el = document.getElementById('when-' + report.id)
        if (!el) continue
        el.textContent = report.exists
          ? formatWhen(report.updatedAt) + ' · ' + formatSize(report.sizeBytes)
          : '尚未生成'
      }
    } catch {
      state.live = false
    }
    setStatus()
    syncButtons()
  }

  function formatWhen(iso) {
    if (!iso) return '—'
    const d = new Date(iso)
    const pad = (n) => String(n).padStart(2, '0')
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return ''
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB'
    return bytes + ' B'
  }

  function syncButtons() {
    for (const item of COMMANDS) {
      const button = document.getElementById('run-' + item.id)
      if (button) button.disabled = !state.live || Boolean(state.jobId)
    }
  }

  function copyCommand(id) {
    const item = COMMANDS.find((c) => c.id === id)
    if (!item) return
    const input = document.getElementById('args-' + id)
    const text = input && input.value.trim() ? item.display + ' ' + input.value.trim() : item.display
    navigator.clipboard?.writeText(text.replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim())
    const button = event.target
    const original = button.textContent
    button.textContent = '已复制'
    setTimeout(() => { button.textContent = original }, 1200)
  }

  async function runCommand(id) {
    const input = document.getElementById('args-' + id)
    const args = input ? input.value.trim() : ''
    try {
      const res = await fetch('/api/lab/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, args }),
      })
      const data = await res.json()
      if (!data.ok) {
        showLog('启动失败', data.error === 'busy' ? '已有任务在运行：' + data.runningJobId : String(data.error), '')
        return
      }
      state.jobId = data.jobId
      syncButtons()
      showLog('运行中', COMMANDS.find((c) => c.id === id)?.display ?? id, '')
      pollJob()
    } catch (error) {
      showLog('无法连接 dev 接口', String(error), '')
    }
  }

  async function pollJob() {
    if (!state.jobId) return
    clearTimeout(state.timer)
    try {
      const res = await fetch('/api/lab/job?id=' + encodeURIComponent(state.jobId), { cache: 'no-store' })
      const data = await res.json()
      if (!data.ok) throw new Error('job lost')
      const job = data.job
      const body = document.getElementById('log-body')
      body.textContent = job.output || '(暂无输出)'
      body.scrollTop = body.scrollHeight
      document.getElementById('log-head').textContent =
        job.label + ' · ' + (job.status === 'running' ? '运行中' : job.status === 'done' ? '已完成' : '失败') +
        (job.exitCode === null ? '' : ' · 退出码 ' + job.exitCode)
      if (job.status === 'running') {
        state.timer = setTimeout(pollJob, 800)
      } else {
        state.jobId = null
        syncButtons()
        probe()
      }
    } catch (error) {
      state.jobId = null
      syncButtons()
      showLog('任务状态丢失', String(error), '')
    }
  }

  function showLog(title, head, body) {
    document.getElementById('log').classList.remove('hidden')
    document.getElementById('log-head').textContent = title + ' · ' + head
    document.getElementById('log-body').textContent = body || ''
  }

  probe()
</script>
</body>
</html>
`
}

function renderFunction(fn, index) {
  const primary = COMMANDS.find((item) => item.id === fn.primary)
  const report = REPORT_PAGES.find((page) => page.url === fn.resultUrl)
  const secondary = (fn.secondary ?? []).map((id) => COMMANDS.find((item) => item.id === id)).filter(Boolean)
  return `  <article class="func">
    <div class="num">${index + 1}</div>
    <h2>${esc(fn.title)}</h2>
    <p>${esc(fn.description)}</p>
    <div class="actions">
      ${primary ? `<button class="primary" id="run-${primary.id}" onclick="runCommand('${primary.id}')">运行${primary.long ? '（长任务）' : ''}</button>` : ''}
      ${fn.resultUrl ? `<a class="btn" href="${esc(fn.resultUrl)}" target="_blank" rel="noreferrer">打开结果</a>` : ''}
      ${report ? `<span class="when" id="when-${report.id}">—</span>` : ''}
    </div>
    ${secondary.length ? `<div class="secondary">${secondary.map((item) => `<button class="small" id="run-${item.id}" onclick="runCommand('${item.id}')">${esc(item.label)}</button>`).join('')}</div>` : ''}
    ${primary ? `<div class="secondary"><button class="small" onclick="copyCommand('${primary.id}')">复制命令</button><code class="hint" style="margin:0">${esc(primary.display)}</code></div>` : ''}
  </article>`
}

function renderMaintenance() {
  const items = COMMANDS.filter((item) => item.section === 'maintenance')
  const rows = items
    .map((item) => {
      const argCell = item.acceptsArgs
        ? `<input id="args-${item.id}" placeholder="${esc(item.acceptsArgs.placeholder)}" title="${esc(item.acceptsArgs.hint)}" />`
        : ''
      return `      <tr>
        <td>${esc(item.label)}${item.long ? '<span class="tag long">长任务</span>' : ''}</td>
        <td>${esc(item.description)}</td>
        <td class="cmd">${esc(item.display)}</td>
        <td>${argCell}</td>
        <td class="act">${item.resultUrl ? `<a class="btn small" href="${esc(item.resultUrl)}" target="_blank" rel="noreferrer">结果</a> ` : ''}<button class="small" onclick="copyCommand('${item.id}')">复制</button> <button class="small" id="run-${item.id}" onclick="runCommand('${item.id}')">运行</button></td>
      </tr>`
    })
    .join('\n')
  return `  <details class="maintenance">
    <summary>维护命令<span>开发/排查用，平时不用展开（${items.length} 条）</span></summary>
    <table class="cmds">
      <thead><tr><th>操作</th><th>说明</th><th>命令</th><th>参数</th><th></th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </details>`
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}