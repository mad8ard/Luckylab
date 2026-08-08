export function lambertW(x, branch = 0, maxIterations = 80) {
  if (!Number.isFinite(x)) return null
  if (branch !== 0) return null
  if (x < -1 / Math.E) return null
  let w = x < 1 ? x : Math.log(x)
  if (x > 3) w = Math.log(x) - Math.log(Math.log(x))
  for (let i = 0; i < maxIterations; i += 1) {
    const ew = Math.exp(w)
    const wew = w * ew
    const numerator = wew - x
    const denominator = ew * (w + 1) - ((w + 2) * numerator) / (2 * w + 2)
    if (!Number.isFinite(denominator) || denominator === 0) return null
    const next = w - numerator / denominator
    if (Math.abs(next - w) < 1e-12) return next
    w = next
  }
  return w
}

export function ammCurve({ price, invariant = 1, n = 50, c = 1 }) {
  if (!Number.isFinite(price) || price <= 0 || invariant <= 0) return null
  const L = Math.sqrt(invariant)
  const reserveX0 = L / Math.sqrt(price)
  const reserveY0 = L * Math.sqrt(price)
  const xRange = reserveX0 * 3
  const points = Array.from({ length: n }, (_, i) => {
    const x = (xRange * (i + 1)) / n
    const y = invariant / x
    const wArg = (c * Math.exp(c * (2 - x))) / Math.max(x, 1e-9)
    const w = lambertW(wArg)
    const lambertY = w !== null ? w / c : null
    return { x, y, lambertY }
  })
  return { points, currentX: reserveX0, currentY: reserveY0, L, invariant, price, c, status: 'research-only' }
}

export function ammLambertCurve({ c = 1, n = 80, minX = 0.1, maxX = 3 }) {
  if (![c, n, minX, maxX].every(Number.isFinite) || c <= 0 || maxX <= minX) return null
  const points = []
  for (let i = 0; i <= n; i += 1) {
    const x = minX + (maxX - minX) * i / n
    const wArg = (c * Math.exp(c * (2 - x))) / x
    const w = lambertW(wArg)
    if (w !== null) points.push({ x, y: w / c, w })
  }
  return { points, c, status: 'research-only' }
}

export function numoenSnapshot({ R1 = 8.7, s = 1.649981319214726, u = 4, dy = 0.1 } = {}) {
  if (![R1, s, u, dy].every(Number.isFinite) || s <= 0 || R1 <= 0) return null
  const L = u ** 2
  const reserveX = (Ry) => s * 1e3 * (0.25 * (Ry / s) ** 2 - u * (Ry / s) + L)
  const ubR1Inner = (u ** 2 - L) / s
  const upperBoundR1 = ubR1Inner >= 0 ? 2 * s ** 2 * (u / s - Math.sqrt(ubR1Inner)) : null
  const R0 = reserveX(R1)
  const R1s = R1 + dy
  const R0s = reserveX(R1s)
  const dx = R0 - R0s
  const px = 2 * s / (1e3 * (-R1 + 2 * s * u))
  const py = 1 / px
  const txPx = dx !== 0 ? dy / dx : null
  const txPy = txPx ? 1 / txPx : null
  return {
    status: 'protocol-unverified',
    invariant: L,
    R0,
    R1,
    R0s,
    R1s,
    dx,
    dy,
    priceX: px,
    priceY: py,
    txPriceX: txPx,
    txPriceY: txPy,
    slippageY: txPy !== null ? txPy - py : null,
    upperBoundR1,
    note: 'Numoen reverse-engineered invariant from archived Desmos; protocol mechanics not verified',
  }
}
