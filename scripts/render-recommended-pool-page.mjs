#!/usr/bin/env node
// 把 recommended-pool-latest.json 渲染为「带交互权重控件」的静态 HTML（v3）
//
// 关键设计：
//   - 服务器端把所有候选 + 维度库 + 默认配置嵌入到 HTML 内
//   - 浏览器端用一份纯 JS 评分函数（与 domain 同算法）按勾选/滑块重算
//   - 状态用 localStorage 持久化，URL 的 ?weights=... / ?enabled=... 也支持
//   - 不靠 SPA：DOM 仍包含「初始默认配置」下的全部 focus/wait 内容，OpenClaw 抓取仍能读取

import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC_JSON = join(ROOT, 'src', 'data', 'recommended-pool-latest.json')
const PUBLIC_DIR = join(ROOT, 'public', 'recommended-pool')

const raw = await readFile(SRC_JSON, 'utf8')
const pool = JSON.parse(raw)

const focusItems = Array.isArray(pool.focusItems) ? pool.focusItems : []
const waitItems = Array.isArray(pool.waitItems) ? pool.waitItems : []
const candidatesAll = Array.isArray(pool.candidatesAll) ? pool.candidatesAll : []
const dimensionsMeta = Array.isArray(pool.dimensions) ? pool.dimensions : []
const generatedAt = formatTimestamp(pool.generatedAt)
const generatedDate = pool.generatedDate || (pool.generatedAt ? String(pool.generatedAt).slice(0, 10) : '')

const html = renderPage({
  pool,
  focusItems,
  waitItems,
  candidatesAll,
  dimensionsMeta,
  generatedAt,
  generatedDate,
})

await mkdir(PUBLIC_DIR, { recursive: true })
await writeFile(join(PUBLIC_DIR, 'index.html'), html, 'utf8')
await writeFile(join(PUBLIC_DIR, 'data.json'), `${JSON.stringify(pool, null, 2)}\n`, 'utf8')

if (generatedDate) {
  const datedDir = join(PUBLIC_DIR, generatedDate)
  await mkdir(datedDir, { recursive: true })
  await writeFile(join(datedDir, 'index.html'), html, 'utf8')
  await copyFile(join(PUBLIC_DIR, 'data.json'), join(datedDir, 'data.json'))
}

console.log(`生成静态推荐页：${join(PUBLIC_DIR, 'index.html')}（focus=${focusItems.length} / wait=${waitItems.length} / total=${candidatesAll.length}）`)

function renderPage({ pool, focusItems, waitItems, candidatesAll, dimensionsMeta, generatedAt, generatedDate }) {
  const total = Number(pool.totalCandidates ?? 0)
  const logic = escapeHtml(pool.logic ?? '')
  const riskNote = escapeHtml(pool.riskNote ?? '左侧买入不代表立即反转，仍需注意继续下跌和趋势延续风险。')
  const tiers = pool.tiers ?? { focus: 0.65, wait: 0.40 }
  const allowCatchKnife = pool.options?.allowCatchKnife !== false

  const defaultMaxScore = dimensionsMeta.filter((d) => d.enabled).reduce((s, d) => s + (d.weight || 0), 0)
  const focusCutoff = Math.round(defaultMaxScore * tiers.focus)
  const waitCutoff = Math.round(defaultMaxScore * tiers.wait)

  const focusBlock = renderTierBlock('focus', '重点关注', `≥ ${focusCutoff} 分（${(tiers.focus * 100).toFixed(0)}% 满分）`, focusItems, dimensionsMeta)
  const waitBlock = renderTierBlock('wait', '等待', `${waitCutoff} ~ ${focusCutoff - 1} 分（${(tiers.wait * 100).toFixed(0)}% ~ ${(tiers.focus * 100).toFixed(0)}%）`, waitItems, dimensionsMeta)

  const dimensionRows = dimensionsMeta.map((d) => `
    <tr data-dim="${escapeHtml(d.id)}">
      <td><label><input type="checkbox" data-dim-enabled="${escapeHtml(d.id)}" ${d.enabled ? 'checked' : ''}/> ${escapeHtml(d.label)}</label></td>
      <td><input type="range" min="0" max="50" step="1" value="${d.weight}" data-dim-weight="${escapeHtml(d.id)}"/></td>
      <td><input type="number" min="0" max="100" step="1" value="${d.weight}" data-dim-weight-num="${escapeHtml(d.id)}" class="w-num"/></td>
    </tr>
  `).join('')

  // 嵌入数据 + 维度元信息 + 默认 tiers + 接飞刀
  const embed = {
    candidates: candidatesAll,
    dimensions: dimensionsMeta,
    tiers,
    options: { allowCatchKnife },
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>今日推荐股票池 ${escapeHtml(generatedDate)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; color: #111827; font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  main { max-width: 1080px; margin: 0 auto; padding: 24px 20px 64px; }
  header.page-head { border-bottom: 1px solid #e5e7eb; padding-bottom: 12px; margin-bottom: 16px; }
  header.page-head h1 { margin: 0 0 6px; font-size: 1.4rem; }
  header.page-head .meta { color: #6b7280; font-size: 0.86rem; }
  header.page-head .meta strong { color: #111827; }
  .logic { background: #f3f4f6; border-radius: 8px; padding: 10px 14px; margin: 12px 0 18px; }

  details.config { margin: 14px 0 22px; border: 1px solid #e5e7eb; border-radius: 10px; background: #fafafa; }
  details.config summary { padding: 10px 14px; cursor: pointer; font-weight: 700; }
  details.config[open] summary { border-bottom: 1px solid #e5e7eb; }
  .config-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 12px; }
  .config-body table { width: 100%; border-collapse: collapse; }
  .config-body td { padding: 4px 6px; vertical-align: middle; font-size: 0.84rem; }
  .config-body td:first-child { width: 40%; }
  .config-body td:nth-child(2) { width: 40%; }
  .config-body input[type=range] { width: 100%; }
  .config-body input.w-num { width: 64px; padding: 2px 6px; border: 1px solid #d1d5db; border-radius: 4px; text-align: right; }
  .config-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .config-actions button { padding: 4px 12px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; cursor: pointer; font-size: 0.84rem; }
  .config-actions button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
  .config-actions label { font-size: 0.84rem; }
  .config-summary { font-size: 0.78rem; color: #6b7280; }

  .empty { padding: 24px; border: 1px dashed #e5e7eb; border-radius: 8px; color: #6b7280; text-align: center; }

  section.tier { margin: 18px 0 28px; }
  section.tier > h2 { font-size: 1.05rem; margin: 0 0 10px; color: #111827; }
  .tier-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 0.78rem; font-weight: 800; margin-right: 8px; color: #fff; }
  .tier-badge-focus { background: #16a34a; }
  .tier-badge-wait  { background: #b45309; }

  ol.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  li.item { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; }
  .item-head { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; }
  .rank { font-weight: 800; color: #16a34a; }
  .name { font-weight: 800; }
  .symbol { color: #6b7280; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .market { padding: 1px 8px; border-radius: 999px; background: #f3f4f6; color: #6b7280; font-size: 0.72rem; }
  .score { margin-left: auto; }
  .score strong { color: #16a34a; font-size: 1.1rem; }

  dl.metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px 14px; margin: 10px 0 6px; }
  dl.metrics dt { color: #6b7280; font-size: 0.7rem; }
  dl.metrics dd { margin: 0; font-weight: 800; font-variant-numeric: tabular-nums; font-size: 0.86rem; }

  .dim-bars { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px 12px; margin: 4px 0 8px; }
  .dim-bar { display: flex; flex-direction: column; gap: 2px; }
  .dim-bar .label { font-size: 0.7rem; color: #6b7280; display: flex; justify-content: space-between; gap: 4px; }
  .dim-bar .label strong { color: #111827; font-weight: 700; }
  .dim-bar .track { height: 5px; background: #f3f4f6; border-radius: 3px; overflow: hidden; }
  .dim-bar .fill { height: 100%; background: #16a34a; }
  .dim-bar.miss .fill, .dim-bar.disabled .fill { background: #d1d5db; }
  .dim-bar.low .fill { background: #b45309; }

  .hits { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; margin: 6px 0; }
  .hits .tag-list { display: flex; flex-wrap: wrap; gap: 4px 8px; list-style: none; padding: 0; margin: 0; }
  .hits .tag-list li { padding: 2px 10px; border-radius: 999px; background: rgba(22,163,74,0.10); color: #16a34a; font-size: 0.72rem; font-weight: 700; }
  .hits .tag-list li.knife { background: rgba(220,38,38,0.10); color: #b91c1c; }

  .narrative { margin: 8px 0 0; padding: 10px 12px; background: #fafaf9; border-left: 3px solid #2563eb; border-radius: 4px; }
  .risk { margin: 24px 0 0; padding: 10px 14px; border-radius: 8px; background: #fef3c7; color: #92400e; }
  .label { display: inline-block; padding: 1px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; margin-right: 8px; vertical-align: 2px; color: #fff; background: #111827; }
  .label.reason { background: #2563eb; }
  .label.risk { background: #b45309; }
  .links { margin-top: 16px; font-size: 0.78rem; color: #6b7280; }
  .links a { color: #2563eb; }
  .pool-mobile-tabs { display: none; }
  @media (max-width: 720px) {
    main { padding: 14px 12px 56px; }
    dl.metrics, .dim-bars { grid-template-columns: repeat(2, 1fr); }
    .pool-mobile-tabs { display: flex; gap: 8px; margin: 12px 0 16px; }
    .pool-mobile-tabs button {
      flex: 1; min-height: 38px; border: 1px solid #d1d5db; border-radius: 8px;
      background: #fff; color: #111827; font-weight: 800; cursor: pointer;
    }
    main[data-pool-tab="focus"] [data-pool-tab-button="focus"],
    main[data-pool-tab="wait"] [data-pool-tab-button="wait"] {
      border-color: #16a34a; color: #15803d; background: rgba(22,163,74,0.08);
    }
    main[data-pool-tab="focus"] section.tier[data-tier="wait"],
    main[data-pool-tab="wait"] section.tier[data-tier="focus"] {
      display: none;
    }
  }
</style>
</head>
<body>
<main data-pool-tab="focus">
  <header class="page-head">
    <h1>今日推荐股票池</h1>
    <p class="meta">
      更新时间：<time datetime="${escapeHtml(pool.generatedAt ?? '')}"><strong>${escapeHtml(generatedAt)}</strong></time>
      ${generatedDate ? `· 日期：<strong>${escapeHtml(generatedDate)}</strong>` : ''}
      · 重点关注：<strong id="focus-count">${focusItems.length}</strong> 只
      · 等待：<strong id="wait-count">${waitItems.length}</strong> 只
      ${total ? `· 候选池：<strong>${total}</strong> 只` : ''}
    </p>
  </header>

  <p class="logic"><span class="label">推荐逻辑</span>${logic}</p>

  <details class="config" id="config-panel">
    <summary>权重调整（勾选维度 / 拖动滑块 / 修改阈值，结果实时刷新）</summary>
    <div class="config-body">
      <table>
        <thead>
          <tr><th style="text-align:left">维度</th><th style="text-align:left">权重滑块</th><th style="text-align:left">权重值</th></tr>
        </thead>
        <tbody>${dimensionRows}</tbody>
      </table>
      <div class="config-actions">
        <label>focus 阈值 <input type="number" id="threshold-focus" min="0" max="100" step="1" value="${Math.round(tiers.focus * 100)}" style="width:60px;padding:2px 6px;border:1px solid #d1d5db;border-radius:4px"/>% 满分</label>
        <label>wait 阈值 <input type="number" id="threshold-wait" min="0" max="100" step="1" value="${Math.round(tiers.wait * 100)}" style="width:60px;padding:2px 6px;border:1px solid #d1d5db;border-radius:4px"/>% 满分</label>
        <label><input type="checkbox" id="catch-knife" ${allowCatchKnife ? 'checked' : ''}/> 接飞刀豁免（z ≤ -1.5σ 且回归 ≥ 85% 时锚↓不硬扣）</label>
        <button id="reset-config">重置默认</button>
        <span class="config-summary" id="config-summary"></span>
      </div>
    </div>
  </details>

  <div class="pool-mobile-tabs" role="tablist" aria-label="股票池分组">
    <button type="button" role="tab" data-pool-tab-button="focus" aria-selected="true">重点关注</button>
    <button type="button" role="tab" data-pool-tab-button="wait" aria-selected="false">等待观察</button>
  </div>

  ${focusBlock}
  ${waitBlock}

  <p class="risk"><span class="label risk">风险提示</span>${riskNote}</p>

  <p class="links">
    数据 JSON：<a href="./data.json">data.json</a>
    ${generatedDate ? ` · 历史快照：<a href="./${escapeHtml(generatedDate)}/">${escapeHtml(generatedDate)}</a>` : ''}
  </p>
</main>

<script>
window.__POOL_DATA__ = ${serializeForScript(embed)};
</script>
<script>
${browserScript()}
</script>
</body>
</html>
`
}

function renderTierBlock(tier, title, range, items, dimensionsMeta) {
  if (!items.length) {
    return `<section class="tier" data-tier="${tier}">
      <h2><span class="tier-badge tier-badge-${tier}">${escapeHtml(title)}</span> ${escapeHtml(range)}</h2>
      <p class="empty">暂无标的</p>
    </section>`
  }
  return `<section class="tier" data-tier="${tier}">
    <h2><span class="tier-badge tier-badge-${tier}">${escapeHtml(title)}</span> ${escapeHtml(range)}（<span data-tier-count="${tier}">${items.length}</span> 只）</h2>
    <ol class="list" data-list="${tier}">${items.map((it, idx) => renderItem(it, idx, dimensionsMeta)).join('\n')}</ol>
  </section>`
}

function renderItem(item, idx, dimensionsMeta) {
  const symbol = escapeHtml(item.symbol ?? '')
  const label = escapeHtml(item.label ?? symbol)
  const market = item.market ? `<span class="market">${escapeHtml(item.market)}</span>` : ''
  return `<li class="item" data-symbol="${symbol}">
    <div class="item-head">
      <span class="rank" data-rank>#${idx + 1}</span>
      <span class="name">${label}</span>
      <span class="symbol">${symbol}</span>
      ${market}
      <span class="score">综合评分：<strong data-score>${escapeHtml(scoreLabel(item))}</strong></span>
    </div>
    <dl class="metrics" data-metrics>${renderMetrics(item.metrics ?? {})}</dl>
    <div class="dim-bars" data-dim-bars>${renderDimBars(item, dimensionsMeta)}</div>
    <div class="hits" data-hits><span class="label">命中维度</span><span class="hit-list">${renderHits(item.hits ?? [])}</span></div>
    <p class="narrative" data-narrative><span class="label reason">人话解读</span>${escapeHtml(item.narrative ?? '')}</p>
  </li>`
}

function scoreLabel(item) {
  const score = Number(item.buyScore ?? item.score)
  const maxScore = Number(item.maxScore)
  const ratio = Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0 ? score / maxScore : 0
  return `${Number.isFinite(score) ? score.toFixed(1) : '0.0'} / ${Number.isFinite(maxScore) ? maxScore.toFixed(0) : '0'}（${(ratio * 100).toFixed(0)}%）`
}

function renderMetrics(m) {
  return [
    ['当前价格', fmtPrice(m.price)],
    ['距锚', fmtPct(m.costDistance)],
    ['z 偏离', Number.isFinite(m.zScore) ? `${m.zScore.toFixed(2)}σ` : '—'],
    ['回归概率', Number.isFinite(m.regressionProbability) ? `${(m.regressionProbability * 100).toFixed(1)}%` : '—'],
    ['lpValue P', Number.isFinite(m.lpValuePercentile) ? `${(m.lpValuePercentile * 100).toFixed(1)}%` : '—'],
    ['3 年 ratio', Number.isFinite(m.lpValueRatio3y) ? `${m.lpValueRatio3y.toFixed(2)}×` : '—'],
  ].map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')
}

function renderDimBars(item, dimensionsMeta) {
  const dimensions = item.dimensions ?? {}
  return dimensionsMeta.map((d) => {
    const dim = dimensions[d.id]
    if (!dim) return ''
    const rawText = dim.disabled ? '关' : dim.missing ? '—' : `${(dim.ratio * 100).toFixed(0)}%`
    const cls = dim.disabled ? 'disabled' : dim.missing ? 'miss' : (dim.ratio < 0.3 ? 'low' : '')
    const width = dim.disabled || dim.missing ? 0 : clampPercent(dim.ratio * 100)
    return `<div class="dim-bar ${cls}"><span class="label">${escapeHtml(d.label)} <strong>${escapeHtml(rawText)}</strong></span><div class="track"><div class="fill" style="width:${width}%"></div></div></div>`
  }).join('')
}

function renderHits(hits) {
  if (!hits.length) return '<span style="color:#6b7280">未达拉满阈值</span>'
  return `<ul class="tag-list">${hits.map((h) => `<li class="${String(h).includes('接飞刀') ? 'knife' : ''}">${escapeHtml(h)}</li>`).join('')}</ul>`
}

function fmtPrice(v) {
  if (!Number.isFinite(v)) return '—'
  if (v >= 10) return v.toFixed(2)
  if (v >= 1) return v.toFixed(3)
  return v.toFixed(4)
}

function fmtPct(v) {
  if (!Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
}

function clampPercent(v) {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, v))
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function serializeForScript(value) {
  return JSON.stringify(value)
    .replaceAll('</', '<\\/')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

function formatTimestamp(value) {
  if (!value) return '尚未生成'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (v) => String(v).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// ── 浏览器端脚本（独立 JS，运行时重算 buyScore） ──────────────────────────

function browserScript() {
  return `
(function () {
  var data = window.__POOL_DATA__ || {};
  var candidates = data.candidates || [];
  var defaultDims = (data.dimensions || []).map(function (d) { return Object.assign({}, d); });
  var defaultTiers = data.tiers || { focus: 0.65, wait: 0.40 };
  var defaultAllowKnife = data.options && data.options.allowCatchKnife !== false;

  // localStorage 持久化
  var STORAGE_KEY = 'recommendedPool.config.v1';
  function loadConfig() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }
  function saveConfig(cfg) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (_) {}
  }

  // URL 参数覆盖
  var url = new URL(window.location.href);
  var urlEnabled = url.searchParams.get('enabled');
  var urlWeights = url.searchParams.get('weights');
  var urlFocus = url.searchParams.get('focus');
  var urlWait = url.searchParams.get('wait');
  var urlKnife = url.searchParams.get('knife');

  function buildInitialConfig() {
    var saved = loadConfig() || {};
    var dims = defaultDims.map(function (d) {
      var sd = (saved.dimensions || []).find(function (x) { return x.id === d.id; }) || {};
      return {
        id: d.id, label: d.label, optional: d.optional,
        enabled: typeof sd.enabled === 'boolean' ? sd.enabled : d.enabled,
        weight: typeof sd.weight === 'number' ? sd.weight : d.weight,
      };
    });
    var tiers = saved.tiers || defaultTiers;
    var allowKnife = typeof saved.allowCatchKnife === 'boolean' ? saved.allowCatchKnife : defaultAllowKnife;

    if (urlEnabled !== null) {
      var enabledIds = new Set(urlEnabled.split(',').map(function (s) { return s.trim(); }).filter(Boolean));
      dims.forEach(function (d) { d.enabled = enabledIds.has(d.id); });
    }
    if (urlWeights !== null) {
      urlWeights.split(',').forEach(function (chunk) {
        var parts = chunk.split(':');
        if (parts.length !== 2) return;
        var id = parts[0].trim();
        var w = Number(parts[1]);
        if (!isFinite(w) || w < 0) return;
        var d = dims.find(function (x) { return x.id === id; });
        if (d) d.weight = w;
      });
    }
    if (urlFocus !== null) { var fv = Number(urlFocus); if (isFinite(fv)) tiers = Object.assign({}, tiers, { focus: fv > 1 ? fv / 100 : fv }); }
    if (urlWait !== null) { var wv = Number(urlWait); if (isFinite(wv)) tiers = Object.assign({}, tiers, { wait: wv > 1 ? wv / 100 : wv }); }
    if (urlKnife !== null) allowKnife = urlKnife === '1' || urlKnife === 'true';

    return { dimensions: dims, tiers: tiers, allowCatchKnife: allowKnife };
  }

  // ── 评分（与 domain 保持一致） ───────────────────────────────────────
  function clamp01(v) { v = Number(v); if (!isFinite(v)) return 0; if (v < 0) return 0; if (v > 1) return 1; return v; }
  function inverseLinear(v, full, zero) { v = Number(v); if (!isFinite(v)) return null; if (zero === full) return 0; return clamp01((v - zero) / (full - zero)); }
  function forwardLinear(v, low, high) { v = Number(v); if (!isFinite(v)) return null; if (high === low) return 0; return clamp01((v - low) / (high - low)); }
  function zoneScore(z) { return z === 'token0' ? 1 : z === 'range' ? 0.45 : z === 'token1' ? 0 : null; }

  var SCORERS = {
    lpValuePercentile: function (m) { return inverseLinear(m.lpValuePercentile, 0.05, 0.50); },
    zScore:            function (m) { return inverseLinear(m.zScore, -3.0, 0); },
    lpZone:            function (m) { return zoneScore(m.lpZone); },
    costSlope: function (m, ctx) {
      var linear = forwardLinear(m.costSlope5, -0.025, 0.005);
      if (ctx.allowCatchKnife && isFinite(m.zScore) && m.zScore <= -1.5
        && isFinite(m.regressionProbability) && m.regressionProbability >= 0.85) {
        return Math.max(linear, 0.5);
      }
      return linear;
    },
    jValue:    function (m) { return inverseLinear(m.j, 0, 20); },
    rsi:       function (m) { return inverseLinear(m.rsi, 0, 35); },
    lpRatio3y: function (m) { return forwardLinear(m.lpValueRatio3y, 1.2, 2.5); },
    halfLife:  function (m) { return isFinite(m.halfLifeDays) && m.halfLifeDays > 0 ? inverseLinear(m.halfLifeDays, 30, 120) : 0; },
    volConfidence: function (m) { return clamp01(m.volConfidenceScore); },
    socialSecurityWhitelist: function (m) { return m.socialSecurityWhitelisted ? 1 : null; },
  };
  var REQUIRES = {
    lpValuePercentile: ['lpValuePercentile'],
    zScore: ['zScore'],
    lpZone: ['lpZone'],
    costSlope: ['costSlope5'],
    jValue: ['j'],
    rsi: ['rsi'],
    lpRatio3y: ['lpValueRatio3y'],
    halfLife: ['halfLifeDays'],
    volConfidence: ['volConfidenceScore'],
    socialSecurityWhitelist: ['socialSecurityWhitelisted'],
  };

  function scoreOne(m, dims, ctx) {
    var dimsResult = {};
    var totalScore = 0;
    var activeWeight = 0;
    var hits = [];
    dims.forEach(function (d) {
      if (!d.enabled || d.weight <= 0) {
        dimsResult[d.id] = { ratio: 0, score: 0, weight: d.weight, label: d.label, disabled: true };
        return;
      }
      var req = REQUIRES[d.id] || [];
      var ready = req.every(function (k) { return m[k] !== null && m[k] !== undefined && (typeof m[k] !== 'number' || isFinite(m[k])); });
      if (!ready) {
        dimsResult[d.id] = { ratio: 0, score: 0, weight: d.weight, label: d.label, missing: true };
        return;
      }
      var r = (SCORERS[d.id] || function () { return null; })(m, ctx);
      if (r === null) {
        // optional 维度未命中 / 评分函数返回 null → 当作 missing，不进总分上限
        dimsResult[d.id] = { ratio: 0, score: 0, weight: d.weight, label: d.label, missing: true };
        return;
      }
      var ratio = clamp01(r);
      var score = ratio * d.weight;
      dimsResult[d.id] = { ratio: ratio, score: Math.round(score * 100) / 100, weight: d.weight, label: d.label };
      totalScore += score;
      activeWeight += d.weight;
    });
    var catchKnife = ctx.allowCatchKnife && isFinite(m.zScore) && m.zScore <= -1.5
      && isFinite(m.regressionProbability) && m.regressionProbability >= 0.85;
    var finalScore = Math.round(totalScore * 10) / 10;
    var maxScore = Math.round(activeWeight * 10) / 10;
    Object.keys(dimsResult).forEach(function (id) {
      var r = dimsResult[id];
      if (!r || r.disabled || r.missing) return;
      if (r.ratio >= 0.8) hits.push(formatHit(id, m));
    });
    if (catchKnife) hits.push('接飞刀豁免（强回归）');
    return { score: finalScore, maxScore: maxScore, dimensions: dimsResult, hits: hits, catchKnife: catchKnife };
  }

  function formatHit(id, m) {
    switch (id) {
      case 'lpValuePercentile': return 'lpValue P' + (m.lpValuePercentile * 100).toFixed(1) + '%';
      case 'zScore':            return 'z=' + m.zScore.toFixed(2) + 'σ';
      case 'lpZone':            return 'token0 折价囤货';
      case 'costSlope':         return '成本锚↑';
      case 'jValue':            return 'J=' + m.j.toFixed(2);
      case 'rsi':               return 'RSI=' + m.rsi.toFixed(2);
      case 'lpRatio3y':         return 'LP 3 年 ' + m.lpValueRatio3y.toFixed(2) + '×';
      case 'halfLife':          return 'HL=' + Math.round(m.halfLifeDays) + '天';
      case 'volConfidence':     return '半衰期可信';
      case 'socialSecurityWhitelist': return '社保 Q1 白名单';
      default: return id;
    }
  }

  // ── 渲染 ──────────────────────────────────────────────────────────
  function fmtPrice(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (v >= 10) return v.toFixed(2);
    if (v >= 1) return v.toFixed(3);
    return v.toFixed(4);
  }
  function fmtPct(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
  }
  function fmt(v, n) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return Number(v).toFixed(n);
  }

  function buildNarrative(item, ctx) {
    var m = item.metrics; var lines = [];
    var ratio = item.maxScore > 0 ? item.score / item.maxScore : 0;
    var scoreStr = item.score.toFixed(1) + '/' + item.maxScore.toFixed(0) + ' 分（' + (ratio * 100).toFixed(0) + '%）';
    if (ratio >= 0.85) lines.push(item.label + ' 综合 ' + scoreStr + '。做市商模型告诉你：你在历史最低价囤满了货。');
    else if (ratio >= 0.65) lines.push(item.label + ' 综合 ' + scoreStr + '。多个维度对齐，左侧关注价值高。');
    else if (ratio >= 0.40) lines.push(item.label + ' 综合 ' + scoreStr + '。有亮点但缺关键确认，等一等。');
    else lines.push(item.label + ' 综合 ' + scoreStr + '。维度未对齐，暂不入选。');

    if (isFinite(m.lpValuePercentile)) {
      var p = m.lpValuePercentile, pPct = (p * 100).toFixed(1);
      if (p <= 0.05) lines.push('lpValue 近一年 P' + pPct + '%——历史最便宜区间。');
      else if (p <= 0.30) lines.push('lpValue P' + pPct + '%，处于近一年低位。');
      else if (p <= 0.70) lines.push('lpValue P' + pPct + '%，位置中性。');
      else lines.push('lpValue P' + pPct + '%——现在进货不划算。');
    }
    if (isFinite(m.lpValueRatio3y)) {
      var r = m.lpValueRatio3y;
      lines.push('3 年 max/min=' + r.toFixed(2) + '×' + (r >= 2 ? '（翻过倍，真周期低点）' : '（未翻倍，可能是价值陷阱）') + '。');
    }
    if (isFinite(m.zScore) && isFinite(m.regressionProbability)) {
      var z = m.zScore, prob = (m.regressionProbability * 100).toFixed(1);
      if (z <= -2.5) lines.push('z=' + z.toFixed(2) + 'σ，回归概率 ' + prob + '%，统计学回归力道极强。');
      else if (z <= -1.5) lines.push('z=' + z.toFixed(2) + 'σ，回归概率 ' + prob + '%，信号不错。');
      else if (z <= 0.5) lines.push('z=' + z.toFixed(2) + 'σ，价格贴在锚附近。');
      else lines.push('z=' + z.toFixed(2) + 'σ，已偏离到锚之上。');
    }
    if (m.lpZone === 'token0') lines.push('LP 仓位 100% ' + item.label + '（zone=token0），打折囤货。');
    else if (m.lpZone === 'token1') lines.push('LP 仓位已卖成现金（zone=token1）。');
    else if (m.lpZone === 'range') lines.push('LP 在 range 区间内做市。');

    if (isFinite(m.costSlope5)) {
      var dir = m.anchorDirection;
      if (dir === 'up') lines.push('成本锚 ' + fmtPct(m.costSlope5) + '（↑），趋势已掉头。');
      else if (dir === 'flat') lines.push('成本锚 ' + fmtPct(m.costSlope5) + '（→），底部已焊住。');
      else if (dir === 'down') {
        if (item.catchKnife) lines.push('成本锚 ' + fmtPct(m.costSlope5) + '（↓），但触发"接飞刀豁免"。');
        else lines.push('成本锚 ' + fmtPct(m.costSlope5) + '（↓），等锚走平再加码。');
      }
    }
    if (isFinite(m.halfLifeDays)) {
      lines.push('半衰期 ' + Math.round(m.halfLifeDays) + ' 天（' + (m.halfLifeSpeed || '—') + '），持仓 ≈ ' + (m.holdingDays || '—') + ' 天，回到锚 ≈ ' + (m.recoveryDays || '—') + ' 天。');
    }
    if (isFinite(m.entryTargetPrice) || isFinite(m.takeProfitPrice)) {
      var buy = isFinite(m.entryTargetPrice) ? '买点 ≈ Delta 上沿 ' + m.entryTargetPrice : '';
      var sell = isFinite(m.takeProfitPrice) ? '卖点 ≈ 成本带下沿 ' + m.takeProfitPrice : '';
      lines.push([buy, sell].filter(Boolean).join('，') + '。');
    }
    if (m.socialSecurityWhitelisted) lines.push('社保 Q1 重仓名单中。');
    return lines.join(' ');
  }

  function renderItem(li, item, idx, ctx) {
    li.querySelector('[data-rank]').textContent = '#' + (idx + 1);
    var ratio = item.maxScore > 0 ? item.score / item.maxScore : 0;
    li.querySelector('[data-score]').textContent = item.score.toFixed(1) + ' / ' + item.maxScore.toFixed(0) + '（' + (ratio * 100).toFixed(0) + '%）';
    var m = item.metrics;
    li.querySelector('[data-metrics]').innerHTML =
      '<div><dt>当前价格</dt><dd>' + fmtPrice(m.price) + '</dd></div>' +
      '<div><dt>距锚</dt><dd>' + fmtPct(m.costDistance) + '</dd></div>' +
      '<div><dt>z 偏离</dt><dd>' + (isFinite(m.zScore) ? m.zScore.toFixed(2) + 'σ' : '—') + '</dd></div>' +
      '<div><dt>回归概率</dt><dd>' + (isFinite(m.regressionProbability) ? (m.regressionProbability * 100).toFixed(1) + '%' : '—') + '</dd></div>' +
      '<div><dt>lpValue P</dt><dd>' + (isFinite(m.lpValuePercentile) ? (m.lpValuePercentile * 100).toFixed(1) + '%' : '—') + '</dd></div>' +
      '<div><dt>3 年 ratio</dt><dd>' + (isFinite(m.lpValueRatio3y) ? m.lpValueRatio3y.toFixed(2) + '×' : '—') + '</dd></div>';

    var bars = '';
    ctx.dimensions.forEach(function (d) {
      var dim = item.dimensions[d.id];
      if (!dim) return;
      var rawText = dim.disabled ? '关' : dim.missing ? '—' : (dim.ratio * 100).toFixed(0) + '%';
      var cls = dim.disabled ? 'disabled' : dim.missing ? 'miss' : (dim.ratio < 0.3 ? 'low' : '');
      var width = dim.disabled || dim.missing ? 0 : dim.ratio * 100;
      bars += '<div class="dim-bar ' + cls + '"><span class="label">' + d.label + ' <strong>' + rawText + '</strong></span><div class="track"><div class="fill" style="width:' + width + '%"></div></div></div>';
    });
    li.querySelector('[data-dim-bars]').innerHTML = bars;

    var hitHtml = item.hits.length
      ? '<ul class="tag-list">' + item.hits.map(function (h) {
          return '<li class="' + (h.indexOf('接飞刀') >= 0 ? 'knife' : '') + '">' + escapeJs(h) + '</li>';
        }).join('') + '</ul>'
      : '<span style="color:#6b7280">未达拉满阈值</span>';
    li.querySelector('[data-hits] .hit-list').innerHTML = hitHtml;

    li.querySelector('[data-narrative]').innerHTML = '<span class="label reason">人话解读</span>' + escapeJs(buildNarrative(item, ctx));
  }

  function escapeJs(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function recomputeAndRender(cfg) {
    var ctx = { allowCatchKnife: cfg.allowCatchKnife, dimensions: cfg.dimensions };
    var scored = candidates.map(function (c) {
      var r = scoreOne(c.metrics, cfg.dimensions, ctx);
      return {
        symbol: c.symbol, label: c.label || c.symbol, market: c.market,
        score: r.score, maxScore: r.maxScore, dimensions: r.dimensions, hits: r.hits, catchKnife: r.catchKnife,
        metrics: c.metrics,
      };
    });
    scored.sort(function (a, b) { return (b.score / Math.max(b.maxScore, 1e-9)) - (a.score / Math.max(a.maxScore, 1e-9)); });

    function ratioOf(s) { return s.maxScore > 0 ? s.score / s.maxScore : 0; }
    var focus = scored.filter(function (s) { return ratioOf(s) >= cfg.tiers.focus; }).slice(0, 10);
    var wait = scored.filter(function (s) {
      var r = ratioOf(s); return r >= cfg.tiers.wait && r < cfg.tiers.focus;
    }).slice(0, 10);

    renderTier('focus', focus, ctx);
    renderTier('wait', wait, ctx);

    document.getElementById('focus-count').textContent = focus.length;
    document.getElementById('wait-count').textContent = wait.length;
    document.querySelectorAll('[data-tier-count="focus"]').forEach(function (el) { el.textContent = focus.length; });
    document.querySelectorAll('[data-tier-count="wait"]').forEach(function (el) { el.textContent = wait.length; });

    var totalW = cfg.dimensions.filter(function (d) { return d.enabled; }).reduce(function (s, d) { return s + d.weight; }, 0);
    var enabledN = cfg.dimensions.filter(function (d) { return d.enabled; }).length;
    document.getElementById('config-summary').textContent =
      '启用 ' + enabledN + ' 个维度，满分上限 ' + totalW +
      '（focus ≥ ' + Math.round(totalW * cfg.tiers.focus) + ' / wait ≥ ' + Math.round(totalW * cfg.tiers.wait) + '）';
    // 更新两档的副标题
    var focusSec = document.querySelector('[data-tier="focus"] h2');
    var waitSec = document.querySelector('[data-tier="wait"] h2');
    if (focusSec) focusSec.innerHTML = '<span class="tier-badge tier-badge-focus">重点关注</span> ≥ ' + Math.round(totalW * cfg.tiers.focus) + ' 分（' + (cfg.tiers.focus * 100).toFixed(0) + '% 满分）（<span data-tier-count="focus">' + focus.length + '</span> 只）';
    if (waitSec) waitSec.innerHTML = '<span class="tier-badge tier-badge-wait">等待</span> ' + Math.round(totalW * cfg.tiers.wait) + '~' + (Math.round(totalW * cfg.tiers.focus) - 1) + ' 分（' + (cfg.tiers.wait * 100).toFixed(0) + '%~' + (cfg.tiers.focus * 100).toFixed(0) + '%）（<span data-tier-count="wait">' + wait.length + '</span> 只）';
  }

  function renderTier(tier, items, ctx) {
    var ol = document.querySelector('[data-list="' + tier + '"]');
    var section = document.querySelector('[data-tier="' + tier + '"]');
    if (!section) return;
    if (!items.length) {
      if (ol) ol.outerHTML = '<p class="empty">暂无标的</p>';
      else if (!section.querySelector('p.empty')) section.insertAdjacentHTML('beforeend', '<p class="empty">暂无标的</p>');
      return;
    }
    var existingEmpty = section.querySelector('p.empty');
    if (existingEmpty) existingEmpty.remove();
    if (!ol) {
      section.insertAdjacentHTML('beforeend', '<ol class="list" data-list="' + tier + '"></ol>');
      ol = section.querySelector('[data-list="' + tier + '"]');
    }
    // 复用现有 li 数量；不足则补，多余则删
    while (ol.children.length < items.length) {
      ol.insertAdjacentHTML('beforeend',
        '<li class="item"><div class="item-head"><span class="rank" data-rank></span><span class="name"></span><span class="symbol"></span><span class="score">综合评分：<strong data-score>—</strong></span></div>' +
        '<dl class="metrics" data-metrics></dl><div class="dim-bars" data-dim-bars></div>' +
        '<div class="hits" data-hits><span class="label">命中维度</span><span class="hit-list"></span></div>' +
        '<p class="narrative" data-narrative><span class="label reason">人话解读</span></p></li>');
    }
    while (ol.children.length > items.length) ol.removeChild(ol.lastElementChild);

    items.forEach(function (item, idx) {
      var li = ol.children[idx];
      li.setAttribute('data-symbol', item.symbol);
      li.querySelector('.name').textContent = item.label;
      li.querySelector('.symbol').textContent = item.symbol;
      var head = li.querySelector('.item-head');
      var existingMarket = head.querySelector('.market');
      if (item.market) {
        if (!existingMarket) {
          var mk = document.createElement('span');
          mk.className = 'market'; mk.textContent = item.market;
          head.insertBefore(mk, head.querySelector('.score'));
        } else {
          existingMarket.textContent = item.market;
        }
      } else if (existingMarket) existingMarket.remove();
      renderItem(li, item, idx, ctx);
    });
  }

  // ── UI 绑定 ───────────────────────────────────────────────────────
  var state = buildInitialConfig();

  function bindControls() {
    state.dimensions.forEach(function (d) {
      var enabledEl = document.querySelector('[data-dim-enabled="' + d.id + '"]');
      var rangeEl = document.querySelector('[data-dim-weight="' + d.id + '"]');
      var numEl = document.querySelector('[data-dim-weight-num="' + d.id + '"]');
      if (enabledEl) {
        enabledEl.checked = d.enabled;
        enabledEl.addEventListener('change', function () { d.enabled = enabledEl.checked; persist(); });
      }
      if (rangeEl) {
        rangeEl.value = d.weight;
        rangeEl.addEventListener('input', function () {
          d.weight = Number(rangeEl.value); if (numEl) numEl.value = d.weight; persist();
        });
      }
      if (numEl) {
        numEl.value = d.weight;
        numEl.addEventListener('input', function () {
          var v = Number(numEl.value); if (!isFinite(v) || v < 0) return;
          d.weight = v; if (rangeEl) rangeEl.value = Math.min(50, v); persist();
        });
      }
    });
    var fEl = document.getElementById('threshold-focus');
    var wEl = document.getElementById('threshold-wait');
    var kEl = document.getElementById('catch-knife');
    var rEl = document.getElementById('reset-config');
    fEl.addEventListener('input', function () { var v = Number(fEl.value); if (isFinite(v) && v >= 0 && v <= 100) state.tiers.focus = v / 100; persist(); });
    wEl.addEventListener('input', function () { var v = Number(wEl.value); if (isFinite(v) && v >= 0 && v <= 100) state.tiers.wait = v / 100; persist(); });
    kEl.addEventListener('change', function () { state.allowCatchKnife = kEl.checked; persist(); });
    rEl.addEventListener('click', function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      window.location.replace(window.location.pathname);
    });
  }

  function bindMobileTabs() {
    var main = document.querySelector('main[data-pool-tab]');
    var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-pool-tab-button]'));
    if (!main || !buttons.length) return;
    function setTab(tab) {
      main.setAttribute('data-pool-tab', tab);
      buttons.forEach(function (button) {
        button.setAttribute('aria-selected', button.getAttribute('data-pool-tab-button') === tab ? 'true' : 'false');
      });
    }
    buttons.forEach(function (button) {
      button.addEventListener('click', function () { setTab(button.getAttribute('data-pool-tab-button') || 'focus'); });
    });
    setTab(main.getAttribute('data-pool-tab') || 'focus');
  }

  function persist() {
    saveConfig({ dimensions: state.dimensions, tiers: state.tiers, allowCatchKnife: state.allowCatchKnife });
    recomputeAndRender(state);
  }

  bindControls();
  bindMobileTabs();
  recomputeAndRender(state);

  // 自动展开权重面板（首次访问）
  if (urlEnabled !== null || urlWeights !== null) {
    document.getElementById('config-panel').open = true;
  }
})();
`
}
