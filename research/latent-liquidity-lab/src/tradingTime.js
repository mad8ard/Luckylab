export function requireTradingDaysPerYear(value, context = 'query') {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new TypeError(`${context}: tradingDaysPerYear must be an explicit finite positive number`)
  }
  return parsed
}
