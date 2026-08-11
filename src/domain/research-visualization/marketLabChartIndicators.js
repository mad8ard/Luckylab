import { computeKDJ } from '../indicators/kdj.js'
import { computeRSI } from '../indicators/rsi.js'
import { resolveChartOverlayPlan } from './chartPaneLayout.js'
import { buildMarketLabChartControls } from './marketLabChartControls.js'
import { buildMarketLabChartGuides } from './marketLabChartGuides.js'
import { getMarketLabSeriesStyle } from './marketLabSeriesStyles.js'

export const MARKET_LAB_CHART_INDICATOR_GROUPS = Object.freeze([
  group('price', '价格层', 'main', 'priceBands'),
  group('greeks', 'Greeks', 'greeks', 'greeksPane'),
  group('lp', 'LP 情景 / 链上', 'lp', 'lpPane'),
  group('carry', 'Funding / Carry', 'carry', 'carryPane'),
  group('equity', '回放权益', 'equity', 'equityPane'),
  group('kdj', 'Lab KDJ', 'kdj', 'kdjPane'),
  group('rsi', 'Lab RSI', 'rsi', 'rsiPane'),
])

const DEFINITIONS = Object.freeze([
  pathIndicator('cost', '成本锚', 'price', 'price', '#0e7558', 'main', 'price.costBand', 'costAnchor', {
    fallback: ['costPath', 'anchor'],
    controls: ['priceBands', 'costBand'],
  }),
  pathIndicator('costUpper', '成本上沿', 'price', 'price', '#8b5a16', 'main', 'price.costBand', 'costUpper', {
    fallback: ['costPath', 'upper'],
    controls: ['priceBands', 'costBand'],
  }),
  pathIndicator('costLower', '成本下沿', 'price', 'price', '#274f9f', 'main', 'price.costBand', 'costLower', {
    fallback: ['costPath', 'lower'],
    controls: ['priceBands', 'costBand'],
  }),
  pathIndicator(
    'deltaUpper',
    '动态周期 GetDelta 上沿',
    'price',
    'price',
    '#9a4f00',
    'main',
    'price.deltaBand',
    'deltaUpper',
    {
      controls: ['priceBands', 'volBand'],
    },
  ),
  pathIndicator(
    'deltaLower',
    '动态周期 GetDelta 下沿',
    'price',
    'price',
    '#1f5fbf',
    'main',
    'price.deltaBand',
    'deltaLower',
    {
      controls: ['priceBands', 'volBand'],
    },
  ),
  pathIndicator('lpLower', 'LP 动态研究区间下沿', 'price', 'price', '#7a5cff', 'main', 'price.lpBand', 'lpLowerPrice', {
    controls: ['priceBands', 'lpBand'],
  }),
  pathIndicator('lpUpper', 'LP 动态研究区间上沿', 'price', 'price', '#7a5cff', 'main', 'price.lpBand', 'lpUpperPrice', {
    controls: ['priceBands', 'lpBand'],
  }),
  pathIndicator('lpRealPrice', '链上池价', 'price', 'price', '#8b5a16', 'main', 'price.lpRealPrice', 'lpRealPrice', {
    controls: ['priceBands', 'lpBand'],
  }),
  constantIndicator('entry', '入场价', 'price', 'price', '#b3261e', 'main', 'price.entryLine', 'input', 'entryPrice', {
    controls: ['entryLine'],
    state: 'ready',
  }),
  constantIndicator('mark', '现价', 'price', 'price', '#202020', 'main', 'price.currentLine', 'rows', 'close', {
    state: 'ready',
  }),
  constantIndicator(
    'target',
    '模拟目标',
    'price',
    'price',
    '#0e7558',
    'main',
    'markers.execution',
    'position',
    'targetPrice',
    { controls: ['executionMarkers'] },
  ),
  constantIndicator(
    'stop',
    '失效线',
    'price',
    'price',
    '#a93226',
    'main',
    'markers.execution',
    'position',
    'stopPrice',
    { controls: ['executionMarkers'] },
  ),

  pathIndicator('bsDelta', '期权 Delta', 'num', 'greeks', '#a93226', 'greeks', 'paneOn.greeks', 'optionDelta', {
    controls: ['greeksPane'],
  }),
  pathIndicator('bsGamma', '期权 Gamma', 'num', 'greeks', '#8b5a16', 'greeks', 'paneOn.greeks', 'optionGamma', {
    controls: ['greeksPane'],
  }),
  pathIndicator(
    'bsTheta',
    '期权 Theta/交易会话',
    'num',
    'greeks',
    '#274f9f',
    'greeks',
    'paneOn.greeks',
    'optionThetaPerSession',
    { controls: ['greeksPane'] },
  ),

  pathIndicator('lpDelta', 'LP 情景库存暴露', 'ratio', 'lp', '#0e7558', 'lp', 'paneOn.lp', 'lpNormalizedDelta', {
    controls: ['lpPane'],
  }),
  pathIndicator('lpValue', 'LP 情景库存价值', 'price', 'lp', '#7a5cff', 'lp', 'paneOn.lp', 'lpValue', {
    controls: ['lpPane'],
  }),
  pathIndicator('lpRealDiv', '链上池价偏离', 'pct', 'lp', '#8b5a16', 'lp', 'paneOn.lp', 'lpRealDivergence', {
    controls: ['lpPane'],
  }),
  pathIndicator(
    'lpPoolTurnover',
    '真实池24h换手',
    'pct',
    'lp',
    '#b3261e',
    'lp',
    'paneOn.lpPoolCoverage',
    'lpPoolTurnover24h',
    {
      controls: ['lpPane'],
      pointMode: 'latest',
    },
  ),
  pathIndicator(
    'lpPoolConcentration',
    '主池资金占比',
    'ratio',
    'lp',
    '#274f9f',
    'lp',
    'paneOn.lpPoolCoverage',
    'lpPoolTopReserveShare',
    { controls: ['lpPane'], pointMode: 'latest' },
  ),
  pathIndicator('lpCe', 'CK 几何资本效率（情景）', 'num', 'lp', '#8b5a16', 'lp', 'paneOn.lp', 'capitalEfficiency', {
    controls: ['lpPane'],
  }),

  pathIndicator(
    'cumulativeFundingProxy',
    '累计 Funding 代理',
    'pct',
    'carry',
    '#a93226',
    'carry',
    'paneOn.carry',
    'cumulativeFundingProxy',
    { controls: ['carryPane'] },
  ),
  pathIndicator('netCarry', '持仓归因代理', 'pct', 'carry', '#0e7558', 'carry', 'paneOn.carry', 'netCarry', {
    controls: ['carryPane'],
  }),

  derivedIndicator(
    'equity',
    '回放权益',
    'price',
    'equity',
    '#1f5fbf',
    'equity',
    'paneOn.equity',
    'replay',
    'equityCurve.equity',
    {
      controls: ['equityPane'],
      state: 'ready',
    },
  ),
  derivedIndicator('kdjK', 'Lab KDJ K/D 均', 'num', 'kdj', '#cc8400', 'kdj', 'paneOn.kdj', 'computedKDJ', 'meanKD', {
    controls: ['kdjPane'],
  }),
  derivedIndicator('kdjJ', 'Lab KDJ J', 'num', 'kdj', '#4e4e4e', 'kdj', 'paneOn.kdj', 'computedKDJ', 'j', {
    controls: ['kdjPane'],
  }),
  derivedIndicator('rsi', 'Lab RSI', 'num', 'rsi', '#2e2e2e', 'rsi', 'paneOn.rsi', 'computedRSI', 'custom', {
    controls: ['rsiPane'],
  }),
])

export const MARKET_LAB_CHART_INDICATOR_CATALOG = Object.freeze(
  DEFINITIONS.map((definition) => Object.freeze(publicMeta(definition, definition.sources[0]))),
)

/**
 * 构建可供 Lightweight Charts、HQChart 或其它视图适配器消费的稳定查询结果。
 * points 只包含带日期的有限数值；关闭的 overlay 仍保留组和 availability，
 * 但不会出现在组的 active series 中。
 */
export function queryMarketLabChartSeries({
  rows = [],
  formulaPath = [],
  costPath = [],
  overlays = {},
  entryPrice = null,
  position = null,
  replay = null,
} = {}) {
  const context = buildContext({ rows, formulaPath, costPath, entryPrice, position, replay })
  const plan = resolveChartOverlayPlan({ overlays, formulaPath: context.formulaPath })
  const candidates = DEFINITIONS.map((definition) => materialize(definition, context, plan))
  const groups = MARKET_LAB_CHART_INDICATOR_GROUPS.map((meta) => buildGroup(meta, candidates, context.rows)).map(
    (item) => ({
      ...item,
      series: item.series.filter((series) => series.active).map(({ active: _active, ...series }) => series),
    }),
  )
  const controls = buildMarketLabChartControls({ candidates, context, overlays, plan })
  const availableSeriesCount = candidates.filter((candidate) => candidate.points.length).length
  const activeSeriesCount = candidates.filter((candidate) => candidate.active && candidate.points.length).length

  return {
    dates: context.rows.map((row) => row?.date).filter(validTime),
    groups,
    controls,
    availability: controls,
    activeSeriesCount,
    availableSeriesCount,
  }
}

function buildContext({ rows, formulaPath, costPath, entryPrice, position, replay }) {
  const safeRows = Array.isArray(rows) ? rows : []
  return {
    rows: safeRows,
    formulaPath: Array.isArray(formulaPath) ? formulaPath : [],
    costPath: Array.isArray(costPath) ? costPath : [],
    entryPrice,
    position: position && typeof position === 'object' ? position : {},
    replay: replay && typeof replay === 'object' ? replay : {},
    kdj: safeCompute(() => computeKDJ(safeRows)),
    rsi: safeCompute(() => computeRSI(safeRows)),
  }
}

function materialize(definition, context, plan) {
  const selected = selectSource(definition, context)
  const points = buildPoints(definition, selected, context)
  return {
    ...publicMeta(definition, selected),
    state: definition.state,
    reason: definition.state === 'estimated' ? 'research-estimate' : 'finite-output-available',
    active: readGate(plan, definition.gate),
    controls: definition.controls,
    missingSource: missingSource(definition),
    points,
  }
}

function buildGroup(meta, candidates, rows) {
  const allSeries = candidates.filter((candidate) => candidate.group === meta.id)
  const available = allSeries.filter((candidate) => candidate.points.length)
  const active = available.filter((candidate) => candidate.active)
  const state = aggregateState(available)
  const groupActive = allSeries.some((candidate) => candidate.active)
  return {
    ...meta,
    active: groupActive,
    state,
    reason: groupReason({ state, groupActive }),
    activeSeriesCount: active.length,
    availableSeriesCount: available.length,
    guides: active.length ? buildMarketLabChartGuides(meta.id, rows) : [],
    series: active,
  }
}

function buildPoints(definition, selected, context) {
  if (definition.kind === 'constant') return constantPoints(context.rows, selected.value)
  if (definition.kind === 'equity') return equityPoints(context.rows, context.replay?.equityCurve)
  if (definition.kind === 'kdj-mean')
    return derivedPoints(context.kdj, (row) =>
      Number.isFinite(row?.k) && Number.isFinite(row?.d) ? (row.k + row.d) / 2 : null,
    )
  if (definition.kind === 'kdj-j') return derivedPoints(context.kdj, (row) => row?.j)
  if (definition.kind === 'rsi') return derivedPoints(context.rsi, (row) => row?.custom)

  const path = selected.source === 'costPath' ? context.costPath : context.formulaPath
  if (definition.pointMode === 'latest') {
    const index = path.length - 1
    return pathPoint(index, selected.field, path)
  }
  return path.flatMap((_, index) => pathPoint(index, selected.field, path))
}

function selectSource(definition, context) {
  if (definition.kind === 'constant') {
    const source = definition.sources[0]
    const value =
      source.source === 'position'
        ? context.position[source.field]
        : source.source === 'rows'
          ? context.rows.at(-1)?.[source.field]
          : context.entryPrice
    return { ...definition.sources[0], value }
  }
  if (definition.kind !== 'path') return definition.sources[0]
  for (const source of definition.sources) {
    const path = source.source === 'costPath' ? context.costPath : context.formulaPath
    if (path.some((row) => Number.isFinite(row?.[source.field]))) return source
  }
  return definition.sources[0]
}

function pathPoint(index, field, path) {
  const value = path[index]?.[field]
  const time = path[index]?.date
  return Number.isFinite(value) && validTime(time) ? [{ time, value }] : []
}

function constantPoints(rows, value) {
  if (!Number.isFinite(value)) return []
  return rows.filter((row) => validTime(row?.date)).map((row) => ({ time: row.date, value }))
}

function equityPoints(rows, curve) {
  if (!Array.isArray(curve)) return []
  const values = new Map(curve.filter((point) => validTime(point?.date)).map((point) => [point.date, point.equity]))
  return rows.flatMap((row) => {
    const value = values.get(row?.date)
    return validTime(row?.date) && Number.isFinite(value) ? [{ time: row.date, value }] : []
  })
}

function derivedPoints(path, valueAt) {
  return path.flatMap((row) => {
    const value = valueAt(row)
    return validTime(row?.date) && Number.isFinite(value) ? [{ time: row.date, value }] : []
  })
}

function pathIndicator(id, label, unit, groupId, color, pane, gate, field, options = {}) {
  const sources = [{ source: 'formulaPath', field }]
  if (options.fallback) sources.push({ source: options.fallback[0], field: options.fallback[1] })
  return definition({ id, label, unit, groupId, color, pane, gate, sources, ...options, kind: 'path' })
}

function constantIndicator(id, label, unit, groupId, color, pane, gate, source, field, options = {}) {
  return definition({
    id,
    label,
    unit,
    groupId,
    color,
    pane,
    gate,
    sources: [{ source, field }],
    ...options,
    kind: 'constant',
  })
}

function derivedIndicator(id, label, unit, groupId, color, pane, gate, source, field, options = {}) {
  const kind = id === 'equity' ? 'equity' : id === 'kdjK' ? 'kdj-mean' : id === 'kdjJ' ? 'kdj-j' : 'rsi'
  return definition({ id, label, unit, groupId, color, pane, gate, sources: [{ source, field }], ...options, kind })
}

function definition({
  id,
  label,
  unit,
  groupId,
  color,
  pane,
  gate,
  sources,
  controls = [],
  state = 'estimated',
  pointMode = 'path',
  kind,
}) {
  const sharedStyle = getMarketLabSeriesStyle(id) ?? { label, unit, color, lineWidth: 1, lineStyle: 'solid' }
  return Object.freeze({
    id,
    label: sharedStyle.label,
    unit: sharedStyle.unit,
    group: groupId,
    color: sharedStyle.color,
    lineWidth: sharedStyle.lineWidth,
    lineStyle: sharedStyle.lineStyle,
    pane,
    gate,
    sources,
    controls,
    state,
    pointMode,
    kind,
    render: pointMode === 'latest' ? 'point' : 'line',
  })
}

function publicMeta(definition, source) {
  return {
    id: definition.id,
    label: definition.label,
    color: definition.color,
    unit: definition.unit,
    lineWidth: definition.lineWidth,
    lineStyle: definition.lineStyle,
    render: definition.render,
    group: definition.group,
    pane: definition.pane,
    source: source.source,
    field: source.field,
    sourceField: `${source.source}.${source.field}`,
  }
}

function missingSource(definition) {
  return definition.sources.map((source) => `${source.source}.${source.field}`).join('|')
}

function aggregateState(candidates) {
  return aggregateStates(candidates.map((candidate) => candidate.state))
}

function aggregateStates(states) {
  if (!states.length) return 'missing-input'
  return states.includes('estimated') ? 'estimated' : 'ready'
}

function groupReason({ state, groupActive }) {
  if (state === 'missing-input') return 'no-finite-output'
  if (!groupActive) return 'overlay-disabled'
  return stateReason(state)
}

function stateReason(state) {
  return state === 'estimated' ? 'research-estimate' : 'finite-output-available'
}

function readGate(plan, gate) {
  return gate.split('.').reduce((value, key) => value?.[key], plan) === true
}

function safeCompute(compute) {
  try {
    return compute()
  } catch {
    return []
  }
}

function validTime(value) {
  return value !== null && value !== undefined && value !== ''
}
function group(id, label, pane, overlayKey) {
  return Object.freeze({ id, label, pane, overlayKey })
}
