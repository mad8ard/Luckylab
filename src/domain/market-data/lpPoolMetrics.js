export function lpPoolCoverageMetrics(poolCoverage) {
  const reserveUsd = positive(poolCoverage?.reserveUsd)
  const volumeUsd24h = positive(poolCoverage?.volumeUsd24h)
  const topReserveShare = ratio(poolCoverage?.topPoolReserveShare)

  return {
    reserveUsd,
    volumeUsd24h,
    turnover24h: reserveUsd && volumeUsd24h ? volumeUsd24h / reserveUsd : null,
    topReserveShare,
  }
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function ratio(value) {
  const next = Number(value)
  return Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : null
}
