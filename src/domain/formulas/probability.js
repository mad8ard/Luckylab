const SQRT_TWO_PI = Math.sqrt(2 * Math.PI)

export function normalPdf(x) {
  if (!Number.isFinite(x)) return 0
  return Math.exp(-(x * x) / 2) / SQRT_TWO_PI
}

export function normalCdf(x) {
  if (x === Infinity) return 1
  if (x === -Infinity) return 0
  if (!Number.isFinite(x)) return null
  const sign = x < 0 ? -1 : 1
  const z = Math.abs(x) / Math.sqrt(2)
  const t = 1 / (1 + 0.3275911 * z)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const erf = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z))
  return 0.5 * (1 + sign * erf)
}

export function inverseNormalCdf(p) {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null
  const a = [-3.969683028665376e+1, 2.209460984245205e+2, -2.759285104469687e+2, 1.38357751867269e+2, -3.066479806614716e+1, 2.506628277459239]
  const b = [-5.447609879822406e+1, 1.615858368580409e+2, -1.556989798598866e+2, 6.680131188771972e+1, -1.328068155288572e+1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const plow = 0.02425
  const phigh = 1 - plow
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  const q = p - 0.5
  const r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

export function integrateTrapezoid(fn, lower, upper, steps = 128) {
  if (![lower, upper, steps].every(Number.isFinite) || upper <= lower || steps < 1) return null
  const n = Math.max(1, Math.round(steps))
  const dx = (upper - lower) / n
  let sum = 0
  for (let i = 0; i <= n; i += 1) {
    const x = lower + dx * i
    const y = Number(fn(x))
    const weight = i === 0 || i === n ? 0.5 : 1
    if (Number.isFinite(y)) sum += y * weight
  }
  return sum * dx
}

export function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}
