import { computed } from 'vue'
import { gammaPnl, meanReversionHalfLife, volConfidence } from '../domain/formulas/core.js'
import { resolveDynamicHoldingData } from './formulaDynamicHolding.js'

export function useFormulaSecondOrderModel({
  props,
  activeIndex,
  activeRows,
  researchInputs,
  devScoreData,
  fingerprintData,
  layout,
}) {
  const { PL, pw, sy } = layout

  const mrData = computed(() => {
    const series = (props.costPath || [])
      .slice(0, activeIndex.value + 1)
      .map((c, i) => {
        const row = props.rows?.[i]
        return c?.anchor > 0 && row ? (row.close - c.anchor) / c.anchor : null
      })
      .filter((v) => v !== null)
    return series.length >= 5
      ? meanReversionHalfLife({
          costDistanceSeries: series,
          tradingDaysPerYear: props.graph.inputs?.tradingDaysPerYear,
        })
      : null
  })

  const dynamicHoldingData = computed(() =>
    resolveDynamicHoldingData({
      graph: props.graph,
      market: props.market,
      rows: activeRows.value,
      researchInputs: researchInputs.value,
      deviation: devScoreData.value,
      meanReversion: mrData.value,
      fingerprint: fingerprintData.value,
    }),
  )

  const decayCurve = computed(() => {
    try {
      const d = mrData.value
      if (!d?.halfLifeDays || !Number.isFinite(d.theta)) return ''
      const maxT = d.halfLifeDays * 3
      const n = 50
      const pts = []
      for (let i = 0; i <= n; i++) {
        const t = (maxT / n) * i
        const decay = Math.exp(-d.theta * t)
        if (Number.isFinite(decay)) pts.push(`${PL + (t / maxT) * pw},${sy(decay)}`)
      }
      return pts.join(' ')
    } catch {
      return ''
    }
  })
  const hlMarker = computed(() => {
    try {
      const d = mrData.value
      if (!d?.halfLifeDays || !Number.isFinite(d.halfLifeDays)) return { x: PL, y: sy(0) }
      const maxT = d.halfLifeDays * 3
      const x = PL + (d.halfLifeDays / maxT) * pw
      if (!Number.isFinite(x)) return { x: PL, y: sy(0) }
      return { x, y: sy(0.5) }
    } catch {
      return { x: PL, y: sy(0) }
    }
  })

  const gpData = computed(() =>
    gammaPnl({
      gamma: props.graph.option?.gamma,
      priceChange: Math.abs(props.market?.costDistance ?? 0) * (props.market?.markPrice ?? 0),
      positionSize: 1,
      markPrice: props.market?.markPrice,
    }),
  )
  const gammaCurve = computed(() => {
    try {
      const g = gpData.value
      if (!g) return ''
      const maxDP = (props.market?.markPrice || 1) * 0.3
      const n = 50
      const pts = []
      const maxPnl = Math.abs(0.5 * (g.positionGamma || 0.0001) * maxDP * maxDP) || 0.01
      for (let i = 0; i <= n; i++) {
        const dp = -maxDP + ((2 * maxDP) / n) * i
        const pnl = 0.5 * (g.positionGamma || 0) * dp * dp
        const x = PL + ((dp + maxDP) / (2 * maxDP)) * pw
        const y = sy(Math.min(1, Math.abs(pnl) / maxPnl))
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push(`${x},${y}`)
      }
      return pts.join(' ')
    } catch {
      return ''
    }
  })
  const gpMarker = computed(() => {
    try {
      const g = gpData.value
      const maxDP = (props.market?.markPrice || 1) * 0.3
      const dp = g?.priceChange || 0
      const maxPnl = Math.abs(0.5 * (g?.positionGamma || 0.0001) * maxDP * maxDP) || 0.01
      const cx = PL + ((dp + maxDP) / (2 * maxDP)) * pw
      const cy = sy(Math.min(1, Math.abs(g?.gammaPnl || 0) / maxPnl))
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return { cx: PL, cy: sy(0) }
      return { cx, cy }
    } catch {
      return { cx: PL, cy: sy(0) }
    }
  })

  const vcData = computed(() =>
    volConfidence({
      annualVol: props.market?.annualVol || props.graph.inputs?.iv,
      sampleSize: Math.min(activeRows.value.length || 60, 60),
    }),
  )

  return { mrData, dynamicHoldingData, decayCurve, hlMarker, gpData, gammaCurve, gpMarker, vcData }
}
