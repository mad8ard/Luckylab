export function buildLpV3Curve({ market, graph, researchInputs, layout }) {
  const { PL, PT, PB, pw } = layout
  const mp = market?.markPrice || graph.inputs?.entryPrice
  const position = lpScenarioPosition({ graph, researchInputs })
  if (!mp || !position) return ''
  try {
    const lo = mp * 0.5
    const hi = mp * 2
    const n = 50
    const { lowerPrice: lowerP, upperPrice: upperP, liquidity } = position
    const points = []
    const svgHeight = 200 - PT - PB
    for (let index = 0; index <= n; index++) {
      const price = lo + ((hi - lo) * index) / n
      let value = 0
      if (price <= lowerP) {
        value = liquidity * (1 / Math.sqrt(lowerP) - 1 / Math.sqrt(upperP)) * price
      } else if (price >= upperP) {
        value = liquidity * (Math.sqrt(upperP) - Math.sqrt(lowerP))
      } else {
        value =
          liquidity * (1 / Math.sqrt(price) - 1 / Math.sqrt(upperP)) * price +
          liquidity * (Math.sqrt(price) - Math.sqrt(lowerP))
      }
      if (Number.isFinite(value)) points.push({ price, value })
    }
    if (!points.length) return ''
    const maxValue = Math.max(...points.map((point) => point.value), 0.01)
    const minValue = Math.min(...points.map((point) => point.value), 0)
    const valueRange = maxValue - minValue || 1
    return points
      .map(
        (point) =>
          `${PL + ((point.price - lo) / (hi - lo)) * pw},${PT + svgHeight * (1 - (point.value - minValue) / valueRange)}`,
      )
      .join(' ')
  } catch {
    return ''
  }
}

export function buildLpV3Marker({ market, layout }) {
  const { PL, pw, syH } = layout
  try {
    const mp = market?.markPrice
    if (!mp) return { cx: PL, cy: syH(0.5) }
    const lo = mp * 0.5
    const hi = mp * 2
    return { cx: PL + ((mp - lo) / (hi - lo)) * pw, cy: syH(0.5) }
  } catch {
    return { cx: PL, cy: syH(0.5) }
  }
}

export function buildLpRealMarker({ market, graph, layout }) {
  const { W, PL, PR, pw } = layout
  try {
    const mp = market?.markPrice
    const price = graph.lpOnchain?.quotePrice
    if (!mp || !Number.isFinite(price) || price <= 0) return null
    const lo = mp * 0.5
    const hi = mp * 2
    const x = PL + ((price - lo) / (hi - lo)) * pw
    if (!Number.isFinite(x) || x < PL || x > W - PR) return null
    return {
      x,
      price,
      label: graph.lpOnchain?.pool?.label ?? '链上池价',
      divergence: (mp - price) / price,
    }
  } catch {
    return null
  }
}

export function buildLpV3Bounds({ market, graph, researchInputs, layout }) {
  const { PL, pw } = layout
  try {
    const mp = market?.markPrice
    const position = lpScenarioPosition({ graph, researchInputs })
    if (!mp || !position) return null
    const lo = mp * 0.5
    const hi = mp * 2
    const { lowerPrice, upperPrice } = position
    return {
      loX: PL + ((lowerPrice - lo) / (hi - lo)) * pw,
      hiX: PL + ((upperPrice - lo) / (hi - lo)) * pw,
    }
  } catch {
    return null
  }
}

function lpScenarioPosition({ graph, researchInputs }) {
  if (researchInputs?.lpValuationMode !== 'explicit-scenario') return null
  const source = graph?.rangeV3Il ?? graph?.lpV3Hedged
  const lowerPrice = Number(source?.lowerPrice)
  const upperPrice = Number(source?.upperPrice)
  const liquidity = Number(researchInputs?.liquidity)
  if (![lowerPrice, upperPrice, liquidity].every(Number.isFinite)) return null
  if (lowerPrice <= 0 || upperPrice <= lowerPrice || liquidity <= 0) return null
  return { lowerPrice, upperPrice, liquidity }
}

export function buildWaterfallBars(portfolio, layout) {
  if (!portfolio) return []
  const { PL, pw, ph, sy } = layout
  const items = [
    { label: 'LP PnL', val: portfolio.lpPnl || 0 },
    { label: '对冲', val: portfolio.hedgePnl || 0 },
    { label: '手续费', val: portfolio.feeIncome || 0 },
    { label: '期权 PnL', val: portfolio.optionPnl || 0 },
    { label: 'Funding', val: portfolio.fundingCashflowQuote || 0 },
  ]
  const maxAbs = Math.max(...items.map((item) => Math.abs(item.val)), 1)
  const barWidth = Math.min(60, Math.max(20, (pw - 40) / items.length))
  const gap = Math.max(4, (pw - barWidth * items.length) / (items.length + 1))
  return items.map((item, index) => {
    const x = PL + gap + index * (barWidth + gap)
    const height = Math.max(2, Math.min(ph * 0.8, (Math.abs(item.val || 0) / maxAbs) * ph * 0.8))
    const y = (item.val || 0) >= 0 ? sy(0) - height : sy(0)
    const fill = (item.val || 0) >= 0 ? 'var(--green)' : 'var(--red)'
    return { x, y, w: barWidth, h: height, fill, label: item.label, val: item.val || 0 }
  })
}

export function buildPortfolioCurves(portfolio, layout) {
  const points = portfolio?.curve ?? []
  if (points.length < 2) return null
  const { PL, PT, pw, ph } = layout
  const minPrice = Math.min(...points.map((point) => point.price))
  const maxPrice = Math.max(...points.map((point) => point.price))
  const values = points
    .flatMap((point) => [point.lpPnl, point.optionValue, point.hedgePnl, point.combined])
    .filter(Number.isFinite)
  const minValue = Math.min(...values, 0)
  const maxValue = Math.max(...values, 1)
  const priceRange = maxPrice - minPrice || 1
  const valueRange = maxValue - minValue || 1
  const line = (key) =>
    points
      .map(
        (point) =>
          `${PL + ((point.price - minPrice) / priceRange) * pw},${PT + (1 - (point[key] - minValue) / valueRange) * ph}`,
      )
      .join(' ')
  return {
    lp: line('lpPnl'),
    option: line('optionValue'),
    hedge: line('hedgePnl'),
    combined: line('combined'),
    minP: minPrice,
    maxP: maxPrice,
    minV: minValue,
    maxV: maxValue,
  }
}

export function buildNormalCurve(layout) {
  const { PL, pw, sy } = layout
  try {
    const count = 50
    const points = []
    const step = 6 / count
    for (let index = 0; index <= count; index++) {
      const z = -3 + index * step
      const density = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI)
      points.push(`${PL + ((z + 3) / 6) * pw},${sy(Math.min(1, density / 0.4))}`)
    }
    return points.join(' ')
  } catch {
    return ''
  }
}

export function buildZMarker(deviation, layout) {
  const { PL, pw, sy } = layout
  try {
    const z = deviation?.z || 0
    const density = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI)
    const x = PL + ((z + 3) / 6) * pw
    const y = sy(Math.min(1, density / 0.4))
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: PL, y: sy(0) }
    return { x, y }
  } catch {
    return { x: PL, y: sy(0) }
  }
}

export function buildNetCarryDisplay(carry, layout) {
  if (!carry) return null
  const { PT, ph } = layout
  const series = [
    { label: '目标毛收益', value: carry.grossRecoveryReturn },
    { label: 'Funding 现金流', value: carry.fundingCashflowReturn },
    { label: '净 carry', value: carry.netReturn },
  ]
  if (series.some((item) => !Number.isFinite(item.value))) return null
  const maxAbs = Math.max(...series.map((item) => Math.abs(item.value)), 0.01)
  const zeroY = PT + ph / 2
  const halfHeight = Math.max(ph / 2 - 18, 1)
  const bars = series.map((item, index) => {
    const height = Math.max(2, (Math.abs(item.value) / maxAbs) * halfHeight)
    return {
      ...item,
      x: 62 + index * 96,
      y: item.value >= 0 ? zeroY - height : zeroY,
      height,
      tone: item.value >= 0 ? 'var(--green)' : 'var(--red)',
    }
  })
  return { ...carry, zeroY, bars }
}
