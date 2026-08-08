export function resolveChartOverlayPlan({ overlays, formulaPath }) {
  const priceBands = overlayOn(overlays, 'priceBands')
  const greeks = overlayOn(overlays, 'greeksPane') && hasPathData(formulaPath, ['optionDelta', 'optionGamma', 'optionThetaDaily'])
  const lp = overlayOn(overlays, 'lpPane') && hasPathData(formulaPath, ['lpNormalizedDelta', 'lpValue', 'lpRealDivergence', 'capitalEfficiency'])
  const lpPoolCoverage = lp && hasPathData(formulaPath, ['lpPoolTurnover24h', 'lpPoolTopReserveShare'])
  const carry = overlayOn(overlays, 'carryPane') && hasPathData(formulaPath, ['fundingProxy', 'netCarry'])
  const panes = buildPaneLayout({
    volume: overlayOn(overlays, 'volume'),
    greeks,
    lp,
    carry,
    equity: overlayOn(overlays, 'equityPane'),
    kdj: overlayOn(overlays, 'kdjPane'),
    rsi: overlayOn(overlays, 'rsiPane'),
  })
  return {
    price: {
      costBand: priceBands && overlayOn(overlays, 'costBand'),
      deltaBand: priceBands && overlayOn(overlays, 'volBand'),
      lpBand: priceBands,
      lpRealPrice: priceBands && hasPathData(formulaPath, ['lpRealPrice']),
      entryLine: overlayOn(overlays, 'entryLine'),
    },
    panes,
    paneOn: {
      volume: panes.volume !== undefined,
      greeks,
      lp,
      lpPoolCoverage,
      carry,
      equity: panes.equity !== undefined,
      kdj: panes.kdj !== undefined,
      rsi: panes.rsi !== undefined,
    },
    markers: {
      execution: overlayOn(overlays, 'executionMarkers'),
      replay: overlayOn(overlays, 'executionMarkers') && overlayOn(overlays, 'replayMarkers'),
      replayLabels: overlayOn(overlays, 'replayMarkerLabels'),
      currentDecision: overlayOn(overlays, 'executionMarkers') && overlayOn(overlays, 'currentDecision'),
      research: overlayOn(overlays, 'researchMarkers'),
    },
  }
}

export function buildPaneLayout({ volume, greeks, lp, carry, equity, kdj, rsi }) {
  const layout = { main: 0 }
  let next = 1
  if (volume) layout.volume = next++
  if (greeks) layout.greeks = next++
  if (lp) layout.lp = next++
  if (carry) layout.carry = next++
  if (equity) layout.equity = next++
  if (kdj) layout.kdj = next++
  if (rsi) layout.rsi = next
  return layout
}

export function hasPathData(formulaPath, fields) {
  return fields.some((field) => formulaPath.some((row) => Number.isFinite(row?.[field])))
}

function overlayOn(overlays, key) {
  return overlays?.[key] !== false
}
