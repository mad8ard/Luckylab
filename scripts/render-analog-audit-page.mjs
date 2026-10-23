#!/usr/bin/env node
// 渲染「候选审核 · 历史相似节点」页面。

import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src', 'data', 'analog-audit-latest.json')
const OUT_DIR = join(ROOT, 'public', 'analog-audit')

const payload = JSON.parse(await readFile(SRC, 'utf8'))
const rows = Array.isArray(payload.rows) ? payload.rows : []
const counts = payload.counts ?? {}
const validation = payload.validation ?? null
const variantValidation = payload.variantValidation ?? {}
const primaryVariant = payload.primaryVariant ?? 'sameStock'
const html = render(payload, rows, counts, validation, variantValidation, primaryVariant)
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
console.log(`生成历史相似节点审核页：${join(OUT_DIR, 'index.html')}（rows=${rows.length} / scored=${counts.scored ?? '—'}）`)

function render(data, list, stats, validation, variantValidation, primaryVariant) {
  const scored = stats.scored ?? list.filter((row) => row.audit?.status === 'ok').length
  const insufficient = stats.insufficient ?? list.length - scored
  const avgAnalogs = list.length
    ? (list.reduce((sum, row) => sum + (row.stats?.count ?? 0), 0) / list.length).toFixed(1)
    : '—'
  const primaryTest = variantValidation[primaryVariant]?.test ?? validation
  const primaryDesign = variantValidation[primaryVariant]?.design ?? null
  const validationText = primaryTest?.status === 'ok'
    ? `80% 验证：目标秩相关 ${fmt(primaryTest.targetRankCorrelation, 3)} · MAE ${fmt(primaryTest.maeRankCorrelation, 3)}`
    : primaryTest?.status === 'insufficient'
      ? `样本不足（${primaryTest.samples ?? 0}）`
      : '未运行'
  const weakTargetSignal = primaryTest?.status === 'ok' && Math.abs(primaryTest.targetRankCorrelation ?? 0) < 0.1
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>第二段回放 50→30 ${esc(dateOf(data))}</title>
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
  .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; margin:12px 20px 0; }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:6px; padding:8px 10px; }
  .card b { display:block; font-size:.62rem; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; }
  .card span { font-size:1.02rem; font-weight:800; font-variant-numeric:tabular-nums; }
  .scroll-x { overflow:auto; max-height:calc(100vh - 260px); margin:10px 20px 0; border:1px solid var(--line); border-radius:6px; background:var(--surface); }
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
  .audit-score { font-size:1.05rem; font-weight:900; font-variant-numeric:tabular-nums; }
  .audit-score.ok { color:var(--accent); }
  .audit-score.missing { color:var(--muted); font-size:.76rem; }
  table.plain tr.variant-primary td, table.inner tr.variant-primary td { background:#eef5f1; font-weight:700; }
  .flow-score { font-weight:800; }
  .flow-score.strong { color:var(--accent); } .flow-score.positive { color:#2f7d5c; } .flow-score.neutral { color:var(--muted); } .flow-score.weak { color:var(--warn); }
  .pos { color:var(--accent); } .neg { color:var(--warn); } .muted { color:var(--muted); }
  .nb-ref { color:#b45309; font-weight:900; }
  .selected-badge { color:var(--accent); font-weight:800; }
  .breakdown { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:6px 10px; margin:0 0 10px; }
  .breakdown div { background:var(--surface); border:1px solid var(--line); border-radius:5px; padding:5px 8px; font-size:.72rem; }
  .breakdown b { display:block; font-size:.68rem; color:var(--muted); }
  table.inner { border-collapse:collapse; width:100%; font-size:.7rem; background:var(--surface); }
  table.inner th, table.inner td { border:1px solid var(--line); padding:4px 6px; text-align:left; white-space:nowrap; }
  table.inner th { background:var(--chip); color:var(--muted); }
  .detail-btn { font:inherit; font-size:.68rem; padding:2px 7px; border:1px solid var(--line); border-radius:4px; background:var(--surface); color:var(--ink); cursor:pointer; }
  .detail-btn:hover { border-color:var(--accent); color:var(--accent); }
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
  <h1>第二段回放审核 · 50 → 30（仅价量）</h1>
  <div class="meta">
    <span>生成 ${esc(data.generatedAt ?? '—')}</span>
    <span>候选快照 ${esc(data.sourceCandidatesGeneratedAt ?? '—')}</span>
    <span>价量截止 ${esc(data.sourceDataThrough ?? '—')}</span>
    <span>候选 ${esc(String(stats.candidates ?? list.length))} 只</span>
    <span>可评分 ${esc(String(scored))} 只</span>
    <span>样本不足 ${esc(String(insufficient))} 只</span>
    <span>${esc(validationText)}</span>
  </div>
</header>
<div class="banner">
  <b>第二段只做价量路径：</b>同股路径 90（目标先于止损 10 · MAE 40 · 10 日收益 10，
  归一化到 100）+ 样本置信 10。按路径分从 50 取前 30；本段不读取 135 资金流，
  135 资金流只对第三段最终 15 只执行。80% 截止点只做独立验证。
</div>
<div class="banner ${primaryTest?.status === 'ok' ? '' : 'warn'}">
  <b>样本外验证：</b>${renderValidationText(primaryTest, primaryVariant)}
</div>
${weakTargetSignal ? `<div class="banner warn"><b>80% 验证：</b>同股路径分的设计/验证路径秩相关为 ${fmt(primaryDesign?.pathRankCorrelation, 3)} / ${fmt(primaryTest?.pathRankCorrelation, 3)}，具备路径区分度。目标先于止损 ${fmt(primaryTest?.targetRankCorrelation, 3)} 单独仍不稳定，贡献主要来自 MAE ${fmt(primaryTest?.maeRankCorrelation, 3)}；这是风险优先的路径分。本页按该分取前 30 进入第三段。</div>` : ''}
<div class="cards">
  <div class="card"><b>候选</b><span>${stats.candidates ?? list.length}</span></div>
  <div class="card"><b>入选第二段</b><span>${stats.stage2Selected ?? Math.min(30, list.length)}</span></div>
  <div class="card"><b>平均相似节点</b><span>${avgAnalogs}</span></div>
  <div class="card"><b>主路径分</b><span>${esc(variantLabel(primaryVariant))}</span></div>
  <div class="card"><b>设计 / 验证路径IC</b><span>${primaryDesign?.status === 'ok' && primaryTest?.status === 'ok' ? `${fmt(primaryDesign.pathRankCorrelation, 3)} / ${fmt(primaryTest.pathRankCorrelation, 3)}` : '—'}</span></div>
  <div class="card"><b>80% MAE</b><span>${primaryTest?.status === 'ok' ? fmt(primaryTest.maeRankCorrelation, 3) : '—'}</span></div>
</div>
<div class="scroll-x">
<table class="grid"><thead><tr>
  <th>#</th><th class="freeze f-sym">symbol</th><th class="freeze f-name">name</th><th>北向</th><th>第一段档位</th><th>推荐分</th>
  <th>相似节点</th><th>有效样本</th><th>10日中位</th><th>20日胜率</th><th>MAE中位</th><th>目标先于止损</th>
  <th>入选</th><th>主路径分</th><th>同股+regime</th><th>全池+regime</th><th>置信</th><th>详情</th>
</tr></thead><tbody>
${list.map((row, index) => renderRows(row, index)).join('\n')}
</tbody></table>
</div>
<h2>变体验证</h2>
${renderVariantValidation(variantValidation, primaryVariant)}
<h2>方法与边界</h2>
<table class="plain"><tbody>
  <tr><th>相似节点</th><td>同股历史或全池横截面；按距成本锚、z 偏离、1 年合成几何百分位、成本锚斜率、年化波动计算距离，同源节点之间至少间隔 20 个交易日。主表按同股 MAE 优先路径取前 30；同股+regime、全池+regime 作为变体对照。</td></tr>
  <tr><th>后续路径</th><td>T+1 开盘入场，统计 5 / 10 / 20 / 60 日收盘收益；主评分用 10 日中位收益、20 日 MAE 和目标先于止损。MAE 为入场后最低价相对入场价的不利波动。</td></tr>
  <tr><th>目标先于止损</th><td>沿用 3% 目标 / 1.5% 止损；同一根 K 线同时触及目标与止损时按止损优先，保守处理。</td></tr>
  <tr><th>防未来函数</th><td>特征使用前缀因果成本路径；相似节点必须在其 20 日结果结束后才可用于评估，当前候选只使用最新一天特征。</td></tr>
  <tr><th>135 资金流</th><td>本段不读取资金流；只在第三段对最终 15 只执行今日/3日/5日净流入评分。</td></tr>
  <tr><th>变体</th><td>同股、同股+市场 regime、全池+regime 三个版本并行对照；主路径按同股 10/40/10 权重计算，60%/70% 设计集和 80% 验证用于对照。</td></tr>
  <tr><th>北向参考</th><td><b>+</b> 表示股东名单含香港中央结算（有北向持仓），<b>*</b> 表示当期净买入；只作参考，不进入资金流或路径评分。</td></tr>
  <tr><th>边界</th><td>这是历史样本研究，不是胜率承诺，也不产生可执行订单；当前池存在幸存者偏差。</td></tr>
</tbody></table>
<p class="hint">返回 <a href="/recommendation/">第一步候选页</a> · 查看 <a href="/replay/">策略历史回放</a></p>
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
  const stats = row.stats ?? {}
  const audit = row.audit ?? {}
  const tierClass = row.tier === 'focus' ? 'tier-focus' : 'tier-wait'
  const tierLabel = row.tier === 'focus' ? '观察' : '等待'
  const detailId = `detail-${index}`
  return `  <tr>
    <td>${row.auditRank ?? index + 1}</td>
    <td class="freeze f-sym"><span>${esc(row.symbol ?? '')}</span></td>
    <td class="freeze f-name"><span>${esc(row.label ?? '')}</span></td>
    <td>${northboundCell(row.northbound)}</td>
    <td><span class="${tierClass}">${tierLabel}</span></td>
    <td>${esc(num(row.poolScore))} / ${esc(num(row.poolMaxScore))}</td>
    <td>${esc(analogCountText(stats))}</td>
    <td>${esc(fmt(stats.effectiveCount, 1))}</td>
    <td class="${pnlClass(stats.fwd10MedianPct)}">${signedPct(stats.fwd10MedianPct)}</td>
    <td>${pct(stats.winRate20Pct)}</td>
    <td class="${pnlClass(stats.mae20MedianPct)}">${signedPct(stats.mae20MedianPct)}</td>
    <td>${pct(stats.targetFirstRate)}</td>
    <td>${row.stage2Selected ? '<span class="selected-badge">入选 30</span>' : '<span class="muted">—</span>'}</td>
    <td>${auditScoreCell(audit)}</td>
    <td>${variantScoreCell(row.variants?.sameStockRegime?.audit)}</td>
    <td>${variantScoreCell(row.variants?.crossSectional?.audit)}</td>
    <td>${pct((stats.sampleConfidence ?? 0) * 100)}</td>
    <td><button class="detail-btn" type="button" onclick="toggleDetail('${detailId}')">展开</button></td>
  </tr>
  <tr class="detail" id="${detailId}" hidden><td colspan="19">${renderDetail(row)}</td></tr>`
}

function renderDetail(row) {
  const audit = row.audit ?? {}
  const stats = row.stats ?? {}
  const components = audit.components ?? {}
  const breakdown = audit.status === 'ok'
    ? `<div class="breakdown">
        ${breakdownItem('同股路径分（归一化）', components.path, fmt(components.path?.raw, 1), 90)}
        ${breakdownItem('样本置信', components.confidence, fmt((components.confidence?.raw ?? 0) * 100, 1) + '%', 10)}
      </div>`
    : `<p class="muted">相似节点有效样本 ${stats.count ?? 0} 个，少于 8 个，暂不生成路径分。</p>`
  const variantTable = renderVariantRow(row)
  const targetAnalogs = Array.isArray(row.targetAnalogs)
    ? row.targetAnalogs
    : Array.isArray(row.topAnalogs) ? row.topAnalogs : []
  return `<h3>变体对比</h3>${variantTable}
    <h3>同股路径评分拆解</h3>${breakdown}
    <h3>同股相似节点</h3>${renderAnalogTable(targetAnalogs, row)}`
}

function renderAnalogTable(analogs, row) {
  const rows = (Array.isArray(analogs) ? analogs : []).map((item) => `<tr>
    <td>${esc(item.date ?? '')}</td>
    <td>${esc(item.sourceSymbol ?? row.symbol ?? '')}</td>
    <td>${esc(fmt(item.distance, 3))}</td>
    <td>${esc(fmt(item.similarity, 3))}</td>
    <td class="${pnlClass(item.fwd5Pct)}">${signedPct(item.fwd5Pct)}</td>
    <td class="${pnlClass(item.fwd10Pct)}">${signedPct(item.fwd10Pct)}</td>
    <td class="${pnlClass(item.fwd20Pct)}">${signedPct(item.fwd20Pct)}</td>
    <td class="${pnlClass(item.fwd60Pct)}">${signedPct(item.fwd60Pct)}</td>
    <td class="${pnlClass(item.mae20Pct)}">${signedPct(item.mae20Pct)}</td>
    <td>${outcomeLabel(item.outcome)}</td>
  </tr>`).join('')
  return `<table class="inner"><thead><tr><th>特征日</th><th>来源</th><th>距离</th><th>相似度</th><th>5日</th><th>10日</th><th>20日</th><th>60日</th><th>20日MAE</th><th>结果</th></tr></thead><tbody>${rows || '<tr><td colspan="10" class="muted">没有足够的历史节点。</td></tr>'}</tbody></table>`
}

function breakdownItem(label, component, rawText, max) {
  const points = component?.points
  return `<div><b>${esc(label)}</b><strong>${esc(fmt(points, 1))} / ${max}</strong><br><span class="muted">${esc(rawText)}</span></div>`
}

function renderVariantValidation(variantValidation, primaryVariant) {
  const names = ['sameStock', 'sameStockRegime', 'crossSectional']
  const rows = names.map((name) => {
    const design = variantValidation?.[name]?.design
    const test = variantValidation?.[name]?.test
    const active = name === primaryVariant
    return `<tr class="${active ? 'variant-primary' : ''}">
      <td>${esc(variantLabel(name))}${active ? '（主）' : ''}</td>
      <td>${esc(String(design?.samples ?? '—'))}</td>
      <td>${esc(fmt(design?.targetRankCorrelation, 3))}</td>
      <td>${esc(fmt(design?.maeRankCorrelation, 3))}</td>
      <td>${esc(fmt(design?.fwd10RankCorrelation, 3))}</td>
      <td>${esc(fmt(design?.pathRankCorrelation, 3))}</td>
      <td>${esc(fmt(test?.targetRankCorrelation, 3))}</td>
      <td>${esc(fmt(test?.maeRankCorrelation, 3))}</td>
      <td>${esc(fmt(test?.fwd10RankCorrelation, 3))}</td>
      <td>${esc(fmt(test?.pathRankCorrelation, 3))}</td>
      <td>${pct(test?.topQuartileTargetRatePct)} / ${pct(test?.bottomQuartileTargetRatePct)}</td>
    </tr>`
  }).join('')
  return `<p class="hint">60%/70% 截止点用于比较变体；路径级验证后，主评分切到同股 MAE 优先路径（目标10/MAE40/10日10）。80% 截止点只做独立验证，秩相关越接近 1 越好。</p>
  <table class="plain"><thead><tr>
    <th>变体</th><th>设计样本</th><th>设计目标</th><th>设计MAE</th><th>设计10日</th><th>设计路径</th>
    <th>验证目标</th><th>验证MAE</th><th>验证10日</th><th>验证路径</th><th>验证目标率 Top / Bottom</th>
  </tr></thead><tbody>${rows}</tbody></table>`
}

function renderValidationText(validation, primaryVariant) {
  if (!validation) return '未运行。'
  if (validation.status === 'ok') {
    return `主变体 ${variantLabel(primaryVariant)}；80% 验证 ${validation.samples} 个配对：目标先于止损秩相关 ${fmt(validation.targetRankCorrelation, 3)}、MAE ${fmt(validation.maeRankCorrelation, 3)}、10 日收益 ${fmt(validation.fwd10RankCorrelation, 3)}。该验证不含当前资金流。`
  }
  return validation.note ?? '样本不足，暂不给出结论。'
}

function variantLabel(name) {
  if (name === 'sameStockRegime') return '同股 + regime'
  if (name === 'crossSectional') return '全池 + regime'
  return '同股'
}

function northboundCell(northbound) {
  if (!northbound?.present) return '<span class="muted">—</span>'
  return `<span class="nb-ref" title="+ = 北向持仓；* = 当期净买入">${esc(northbound.mark || '+')}</span>`
}

function analogCountText(stats) {
  const same = stats?.count
  const cross = stats?.crossCount
  if (Number.isFinite(same) && Number.isFinite(cross)) return `${same}/${cross}`
  return String(same ?? 0)
}

function variantScoreCell(audit) {
  if (!audit || audit.status !== 'ok' || !Number.isFinite(audit.auditScore)) return '<span class="muted">—</span>'
  return `<span class="audit-score ok">${audit.auditScore.toFixed(1)}</span>`
}

function renderVariantRow(row) {
  const names = ['sameStock', 'sameStockRegime', 'crossSectional']
  const rows = names.map((name) => {
    const variant = row.variants?.[name]
    const stats = variant?.stats ?? {}
    const audit = variant?.audit ?? {}
    return `<tr class="${name === row.primaryVariant ? 'variant-primary' : ''}">
      <td>${esc(variantLabel(name))}${name === row.primaryVariant ? '（主）' : ''}</td>
      <td>${esc(String(stats.count ?? 0))}</td>
      <td>${signedPct(stats.fwd10MedianPct)}</td>
      <td>${pct(stats.targetFirstRate)}</td>
      <td>${signedPct(stats.mae20MedianPct)}</td>
      <td>${auditScoreCell(audit)}</td>
    </tr>`
  }).join('')
  return `<table class="inner"><thead><tr><th>变体</th><th>节点</th><th>10日中位</th><th>目标率先</th><th>MAE中位</th><th>审核分</th></tr></thead><tbody>${rows}</tbody></table>`
}

function auditScoreCell(audit) {
  if (audit.status !== 'ok' || !Number.isFinite(audit.auditScore)) {
    return '<span class="audit-score missing">样本不足</span>'
  }
  return `<span class="audit-score ok">${audit.auditScore.toFixed(1)}</span>`
}

function outcomeLabel(outcome) {
  if (outcome === 'target') return '目标'
  if (outcome === 'stop') return '止损'
  return '到期'
}

function pnlClass(value) {
  if (!Number.isFinite(value)) return 'muted'
  return value >= 0 ? 'pos' : 'neg'
}

function signedPct(value) {
  return Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}%` : '—'
}

function pct(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—'
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
