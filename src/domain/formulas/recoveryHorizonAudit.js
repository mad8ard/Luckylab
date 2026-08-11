export function recoveryHorizonAudit(cycleStartPrice, anchorPrice, targetPrice, halfLifeSessions, side, availableAt) {
  const direction = side === 'short' ? -1 : 1
  const anchorGap = [anchorPrice, cycleStartPrice].every(Number.isFinite)
    ? (anchorPrice - cycleStartPrice) * direction
    : null
  const targetGap = [targetPrice, cycleStartPrice].every(Number.isFinite)
    ? (targetPrice - cycleStartPrice) * direction
    : null
  const rawRecoveryFraction =
    Number.isFinite(anchorGap) && anchorGap !== 0 && Number.isFinite(targetGap) ? targetGap / anchorGap : null
  return {
    side,
    cycleStartPrice,
    anchorPrice,
    targetPrice,
    halfLifeSessions,
    availableAt,
    anchorGap,
    targetGap,
    rawRecoveryFraction,
    recoveryFraction: rawRecoveryFraction,
  }
}
