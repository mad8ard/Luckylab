import { deriveRecoveryHorizon, meanReversionHalfLife } from '../formulas/core.js'

/**
 * Resolve a research horizon from information available at `index` only.
 *
 * Extra caller fields (including `input`) are intentionally ignored. In
 * particular, user-entered holding-day and formula-horizon values cannot
 * override this prefix-derived path.
 */
export function resolveFormulaPathHorizon({ rows, index, costPath, costDistancePath, tdpy } = {}) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(costPath) || !Array.isArray(costDistancePath)) {
    return unavailablePrefix('missing-formula-path-prefix')
  }

  const pointIndex = resolvePointIndex(index, rows.length)
  const row = rows[pointIndex]
  const costPoint = costPath[pointIndex]
  const anchorPrice = positive(costPoint?.anchor)
  const close = positive(row?.close)
  const side = close !== null && anchorPrice !== null && close > anchorPrice ? 'short' : 'long'
  const targetPrice = positive(side === 'long' ? costPoint?.lower : costPoint?.upper)
  const targetSource = side === 'long' ? 'adaptive-cost-lower' : 'adaptive-cost-upper'
  const meanReversion = meanReversionHalfLife({
    costDistanceSeries: costDistancePath.slice(0, pointIndex + 1),
    tradingDaysPerYear: tdpy,
  })
  const monotonic = isPositiveMonotonicMeanReversion(meanReversion)
  const cycleStart = resolveCycleStart({ rows, costPath, pointIndex, costPoint, side, targetPrice, anchorPrice })
  const availableAt = `${row?.date ?? pointIndex}:close`
  const recovery = deriveRecoveryHorizon({
    cycleStartPrice: cycleStart?.price ?? null,
    anchorPrice,
    targetPrice,
    halfLifeSessions: monotonic ? meanReversion.halfLifeSessions : null,
    side,
    availableAt,
  })
  const context = {
    ...recovery,
    mode: 'formula-derived',
    side,
    cycleStartSource: cycleStart?.source ?? null,
    cycleStartDate: cycleStart?.date ?? null,
    cycleStartIndex: cycleStart?.index ?? null,
    cycleStartLookbackSessions: cycleStart ? pointIndex - cycleStart.index : null,
    targetSource,
    claimClass: recovery.resultClaimClass ?? null,
    meanReversionClaimClass: meanReversion ? 'sample-estimate' : null,
    executionAuthority: 'none',
    meanReversion,
  }

  if (monotonic) return context
  return {
    ...context,
    status: 'model-gate-failed',
    eligible: false,
    reason: 'non-monotonic-or-insufficient-ar-prefix',
    resultClaimClass: null,
    claimClass: null,
  }
}

function resolveCycleStart({ rows, costPath, pointIndex, costPoint, side, targetPrice, anchorPrice }) {
  const windowSessions = positiveInteger(costPoint?.windowSpec?.cost) ?? pointIndex + 1
  const windowStart = Math.max(0, pointIndex - windowSessions + 1)
  const windowExtreme = extremeCandidate(rows, windowStart, pointIndex, side)
  if (validStructure(windowExtreme?.price, targetPrice, anchorPrice, side)) {
    return {
      ...windowExtreme,
      source: side === 'long' ? 'adaptive-cost-window-low-extreme' : 'adaptive-cost-window-high-extreme',
    }
  }

  for (let cursor = pointIndex; cursor >= 0; cursor -= 1) {
    const candidate = candleExtreme(rows[cursor], cursor, side)
    const boundary = positive(side === 'long' ? costPath[cursor]?.lower : costPath[cursor]?.upper)
    if (!crossesBoundary(candidate?.price, boundary, side)) continue
    if (!validStructure(candidate.price, targetPrice, anchorPrice, side)) continue
    return {
      ...candidate,
      source: side === 'long' ? 'recent-dynamic-lower-crossing' : 'recent-dynamic-upper-crossing',
    }
  }

  return windowExtreme
    ? {
        ...windowExtreme,
        source: side === 'long' ? 'adaptive-cost-window-low-extreme' : 'adaptive-cost-window-high-extreme',
      }
    : null
}

function extremeCandidate(rows, start, end, side) {
  let selected = null
  for (let cursor = start; cursor <= end; cursor += 1) {
    const candidate = candleExtreme(rows[cursor], cursor, side)
    if (!candidate) continue
    if (!selected || (side === 'long' ? candidate.price <= selected.price : candidate.price >= selected.price)) {
      selected = candidate
    }
  }
  return selected
}

function candleExtreme(row, index, side) {
  const price = positive(side === 'long' ? row?.low : row?.high)
  if (price === null) return null
  return { price, date: row?.date ?? null, index }
}

function validStructure(cycleStartPrice, targetPrice, anchorPrice, side) {
  if (![cycleStartPrice, targetPrice, anchorPrice].every(Number.isFinite)) return false
  return side === 'short'
    ? cycleStartPrice > targetPrice && targetPrice > anchorPrice
    : cycleStartPrice < targetPrice && targetPrice < anchorPrice
}

function crossesBoundary(price, boundary, side) {
  if (![price, boundary].every(Number.isFinite)) return false
  return side === 'short' ? price > boundary : price < boundary
}

function isPositiveMonotonicMeanReversion(meanReversion) {
  return (
    meanReversion?.isMeanReverting === true &&
    meanReversion?.decayMode === 'monotonic-decay' &&
    meanReversion?.arCoefficient > 0 &&
    meanReversion?.arCoefficient < 1 &&
    meanReversion?.halfLifeSessions > 0
  )
}

function unavailablePrefix(reason) {
  return {
    status: 'missing-input',
    eligible: false,
    mode: 'formula-derived',
    reason,
    identityClaimClass: 'exact-identity',
    resultClaimClass: 'missing-input',
    claimClass: 'missing-input',
    executionAuthority: 'none',
  }
}

function resolvePointIndex(index, length) {
  if (!Number.isInteger(index)) return length - 1
  return Math.min(Math.max(index, 0), length - 1)
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function positiveInteger(value) {
  const next = Number(value)
  return Number.isInteger(next) && next > 0 ? next : null
}
