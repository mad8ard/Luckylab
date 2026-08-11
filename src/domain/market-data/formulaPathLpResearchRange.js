/**
 * Build a display-only LP research interval from the same dynamic horizon and
 * volatility wave already used by GetDelta.
 *
 * GetDelta defines r(T)=((1+w)/(1-w))^2.  A Uniswap-style price interval is
 * naturally expressed in sqrt-price space, so the range factor is sqrt(r(T)).
 * This is a research scenario only: it does not declare liquidity, inventory,
 * fees, IL or PnL and must never be consumed as an executable LP position.
 */
export function deriveFormulaPathLpResearchRange({
  bandAnchor,
  deltaBands,
  horizon,
  iv,
  tradingDaysPerYear,
  deltaAvailability,
} = {}) {
  const anchor = positive(bandAnchor)
  const wave = resolveWave({ deltaBands, horizon, iv, tradingDaysPerYear })
  const ratio = positive(deltaBands?.rT) ?? (wave ? Math.pow((1 + wave) / (1 - wave), 2) : null)
  const factor = ratio ? Math.sqrt(ratio) : null
  if (!anchor || !Number.isFinite(factor) || factor <= 1) {
    const status = unavailableStatus(deltaAvailability)
    return {
      status,
      available: false,
      source: 'formula-derived-lp-research-range',
      inputMode: 'formula-derived-research-scenario',
      isSynthetic: true,
      missingInputs:
        deltaAvailability?.missingInputs?.length || status !== 'missing-input'
          ? [...(deltaAvailability?.missingInputs ?? [])]
          : ['formula-derived-getdelta-wave'],
      blockedReasons: [...(deltaAvailability?.blockedReasons ?? [])],
      executionAuthority: 'none',
      lowerPrice: null,
      upperPrice: null,
    }
  }

  return {
    status: 'research-only',
    available: true,
    source: 'formula-derived-lp-research-range',
    inputMode: 'formula-derived-research-scenario',
    isSynthetic: true,
    missingInputs: [],
    blockedReasons: [],
    executionAuthority: 'none',
    claimClass: 'scenario-proxy',
    lowerPrice: anchor / factor,
    upperPrice: anchor * factor,
    rangeFactor: factor,
    formula: 'LP=[P/sqrt(r(T)),P*sqrt(r(T))]',
    availableAt: horizon?.availableAt ?? null,
    horizonSessions: horizon?.modelHorizonSessions ?? null,
    recoveryFraction: horizon?.recoveryFraction ?? null,
    wave,
    rT: ratio,
  }
}

function unavailableStatus(deltaAvailability) {
  return ['missing-input', 'not-applicable', 'model-gate-failed'].includes(deltaAvailability?.status)
    ? deltaAvailability.status
    : 'missing-input'
}

function resolveWave({ deltaBands, horizon, iv, tradingDaysPerYear }) {
  const direct = positive(deltaBands?.wave)
  if (direct && direct < 1) return direct
  const sessions = positive(horizon?.modelHorizonSessions)
  const sigma = positive(iv)
  const tdpy = positive(tradingDaysPerYear)
  if (!sessions || !sigma || !tdpy) return null
  const wave = sigma * Math.sqrt(sessions / (tdpy * 2 * Math.PI))
  return Number.isFinite(wave) && wave > 0 && wave < 1 ? wave : null
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}
