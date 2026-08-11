import { formatFormulaInputList, formatFormulaReasonList } from './formulaInputLabels.js'

const STATUS_LABELS = Object.freeze({
  viewable: '可查看',
  'missing-input': '待输入',
  'not-applicable': '当前结构不适用',
  'model-gate-failed': '门禁未通过',
})

export function resolveDisplayedDeltaBand({
  isHovering = false,
  hoverFormulaRow = null,
  currentFormulaRow = null,
  graph = null,
} = {}) {
  if (isHovering) {
    const low = hoverFormulaRow?.deltaLower
    const high = hoverFormulaRow?.deltaUpper
    const cost = hoverFormulaRow?.deltaCost ?? hoverFormulaRow?.costAnchor
    if ([low, high].every(finite)) {
      return available({ low, high, cost: finite(cost) ? cost : null }, 'hover-formula-row')
    }
    return unavailableFromRow(hoverFormulaRow, 'hover-formula-row')
  }

  const rowResult = unavailableFromRow(currentFormulaRow, 'current-formula-row', false)
  if (rowResult) return rowResult

  const long = graph?.deltaBands?.long
  if (long && [long.low, long.high].every(finite)) return available(long, 'current-graph')

  const currentLow = currentFormulaRow?.deltaLower
  const currentHigh = currentFormulaRow?.deltaUpper
  const currentCost = currentFormulaRow?.deltaCost ?? currentFormulaRow?.costAnchor
  if ([currentLow, currentHigh].every(finite)) {
    return available(
      { low: currentLow, high: currentHigh, cost: finite(currentCost) ? currentCost : null },
      'current-formula-row',
    )
  }
  return unavailable({
    state: 'missing-input',
    missingInputs: unique([...(graph?.decision?.missingInputs ?? []), 'getdelta-band']),
    blockedReasons: [],
    source: 'current-graph',
  })
}

function available(long, source) {
  return {
    long,
    state: 'viewable',
    label: STATUS_LABELS.viewable,
    missingInputs: [],
    missingText: '无',
    blockedReasons: [],
    reasonText: '无',
    source,
  }
}

function unavailableFromRow(row, source, alwaysFallback = true) {
  const fieldState = row?.fieldStates?.deltaUpper ?? row?.fieldStates?.deltaLower
  const recognizedStatus = ['missing-input', 'not-applicable', 'model-gate-failed'].includes(fieldState?.status)
  if (!alwaysFallback && !recognizedStatus) return null
  const state = ['not-applicable', 'model-gate-failed'].includes(fieldState?.status)
    ? fieldState.status
    : 'missing-input'
  return unavailable({
    state,
    missingInputs: unique([
      ...(fieldState?.missingInputs ?? []),
      ...(state === 'missing-input' ? ['getdelta-band'] : []),
    ]),
    blockedReasons: unique(fieldState?.blockedReasons ?? []),
    source,
  })
}

function unavailable({ state, missingInputs, blockedReasons, source }) {
  return {
    long: null,
    state,
    label: STATUS_LABELS[state],
    missingInputs,
    missingText: formatFormulaInputList(missingInputs),
    blockedReasons,
    reasonText: formatFormulaReasonList(blockedReasons),
    source,
  }
}

function finite(value) {
  return Number.isFinite(value)
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length))]
}
