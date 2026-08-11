import { computed } from 'vue'
import {
  buildOrderPlanReviewPresentation,
  getFormulaAvailability,
} from '../domain/formula-research/formulaAvailability.js'
import { formulaStages } from '../domain/formulas/registry.js'
import {
  ammCurve,
  asianOption,
  bachelierOption,
  capitalEfficiencyFrontier,
  ckCapitalEfficiencyReference,
  deviationScore,
  liquidityFingerprint,
  lpResearchAttribution,
  numoenSnapshot,
  riskSurface,
  sampleCapitalEfficiencyCurve,
} from '../domain/formulas/core.js'
import { useFormulaSecondOrderModel } from './useFormulaSecondOrderModel.js'
import { buildFormulaChartGuide, buildFormulaOrderData } from './formulaChartGuide.js'
import {
  buildLpRealMarker,
  buildLpV3Bounds,
  buildLpV3Curve,
  buildLpV3Marker,
  buildNetCarryDisplay,
  buildNormalCurve,
  buildPortfolioCurves,
  buildWaterfallBars,
  buildZMarker,
} from './formulaChartGeometry.js'
import { FORMULA_CHART_LAYOUT, f4, fmt, pctFmt } from './formulaChartPrimitives.js'

export function useFormulaChartModel(props) {
  const stage = computed(() => formulaStages.find((s) => s.id === props.formulaId))
  const availability = computed(() =>
    getFormulaAvailability(props.formulaId, {
      graph: props.graph,
      market: props.market,
      rows: props.rows,
      costPath: props.costPath,
      formulaPath: props.formulaPath,
    }),
  )
  const orderReview = computed(() => buildOrderPlanReviewPresentation(props.graph))
  const researchInputs = computed(() => props.graph.researchInputs ?? {})
  const activeIndex = computed(() => {
    if (!props.rows.length) return 0
    const next = Number.isFinite(props.cursor) ? props.cursor : props.rows.length - 1
    const costLimited = props.costPath?.length ? props.costPath.length - 1 : next
    return Math.max(0, Math.min(props.rows.length - 1, next, costLimited))
  })
  const activeRows = computed(() => props.rows.slice(0, activeIndex.value + 1))
  const activeFormulaRow = computed(() => {
    if (!props.formulaPath?.length) return null
    return props.formulaPath[Math.min(activeIndex.value, props.formulaPath.length - 1)]
  })

  const { W, H, PL, PR, PT, PB } = FORMULA_CHART_LAYOUT
  const pw = W - PL - PR; const ph = H - PT - PB
  const sx = (v) => PL + v * pw; const sy = (v) => PT + (1 - v) * ph

  const pathData = computed(() => {
    const r = activeRows.value
    if (!r?.length) return null
    const first = r[0]; const last = r.at(-1)
    const totalReturn = last.close / first.close - 1
    const logReturn = Math.log(last.close / first.close)
    const annualVol = props.market?.annualVol ?? 0
    return { count: r.length, firstDate: first.date, lastDate: last.date, firstClose: first.close, lastClose: last.close, totalReturn, logReturn, annualVol }
  })

  const costData = computed(() => {
    const m = props.market; if (!m) return null
    return { anchor: m.costAnchor, recent: m.costRecent, low: m.costLow, high: m.costHigh, distance: m.costDistance, price: m.markPrice, slope: m.costSlopeRecent, windowSpec: m.windowSpec }
  })

  const volData = computed(() => {
    const m = props.market; const g = props.graph
    if (!m) return null
    return { annualVol: m.annualVol, atr: m.atrPercent, momentumFast: m.momentumFast, momentumSlow: m.momentumSlow, windowSpec: m.windowSpec, iv: g.inputs?.iv, ivSource: researchInputs.value.volatilitySource ?? g.inputs?.ivSource ?? 'scenario-unspecified' }
  })

  const bandData = computed(() => {
    const b = props.graph.deltaBands; const mp = props.market?.markPrice
    if (!b || !mp) return null
    const all = [b.long.low, b.long.cost, b.long.high, b.short.cost, b.short.high, mp]
    const min = Math.min(...all) * 0.9
    const max = Math.max(...all) * 1.1
    const range = max - min; const s = (v) => (v - min) / range
    return { min, max, range, longLow: s(b.long.low), longCost: s(b.long.cost), longHigh: s(b.long.high), shortLow: s(b.short.low), shortCost: s(b.short.cost), shortHigh: s(b.short.high), price: s(mp), wave: b.wave, ratio: b.longRatio, raw: b }
  })

  const greeksData = computed(() => {
    const portfolio = props.graph.optionPortfolio
    if (portfolio) {
      return {
        price: portfolio.value,
        optionDelta: portfolio.optionDelta,
        optionGamma: portfolio.optionGamma,
        optionThetaPerSession: portfolio.optionThetaPerSession,
        optionThetaAnnual: portfolio.optionThetaAnnual,
        optionVegaPerPct: portfolio.optionVegaPerPct,
        optionRhoPerPct: portfolio.optionRhoPerPct,
        legs: portfolio.legs?.length ?? 0,
        strategyClass: portfolio.strategyClass,
        isPortfolio: true,
        volatilitySource: portfolio.volatilitySource,
      }
    }
    const o = props.graph.option; if (!o) return null
    return {
      price: o.price,
      optionDelta: o.optionDelta,
      optionGamma: o.optionGamma,
      optionThetaPerSession: o.optionThetaPerSession,
      optionThetaAnnual: o.optionThetaAnnual,
      optionVegaPerPct: o.optionVegaPerPct,
      optionRhoPerPct: o.optionRhoPerPct,
      d1: o.d1,
      d2: o.d2,
      legs: 1,
      isPortfolio: false,
    }
  })

  const lpData = computed(() => {
    const v3 = props.graph.lpV3
    const v2 = props.graph.lp
    if (!v3 && !v2 && !props.graph.rangeV3Il && !props.graph.fullRangeV2Il) return null
    return {
      v3,
      v2,
      rangeV3Il: props.graph.rangeV3Il,
      fullRangeV2Il: props.graph.fullRangeV2Il,
    }
  })
  const syH = (v) => PT + (1 - v) * (200 - PT - PB)
  const geometry = { W, PL, PR, PT, PB, pw, ph, sy, syH }
  const lpV3Curve = computed(() =>
    buildLpV3Curve({
      market: props.market,
      graph: props.graph,
      researchInputs: researchInputs.value,
      layout: geometry,
    }),
  )
  const lpV3Marker = computed(() => buildLpV3Marker({ market: props.market, layout: geometry }))
  const lpRealMarker = computed(() =>
    buildLpRealMarker({ market: props.market, graph: props.graph, layout: geometry }),
  )
  const lpV3Bounds = computed(() =>
    buildLpV3Bounds({
      market: props.market,
      graph: props.graph,
      researchInputs: researchInputs.value,
      layout: geometry,
    }),
  )

  const ceData = computed(() => {
    const current = props.graph.efficiency
    if (!current) return null
    const skew = Math.max(Number(researchInputs.value.skew) || 1, 0)
    return {
      ...current,
      downMove: Number.isFinite(current.downMove) ? current.downMove : -(1 - current.lower),
      upMove: Number.isFinite(current.upMove) ? current.upMove : current.upper - 1,
      skew,
      ckReference: ckCapitalEfficiencyReference(),
      currentFrontier: capitalEfficiencyFrontier({ skew }),
    }
  })
  const ceCurve = computed(() => {
    try {
      const skew = ceData.value?.skew ?? 1
      return sampleCapitalEfficiencyCurve({ skew, steps: 80, maxEfficiency: 50 })
        .map((point) => `${PL + point.rangeWidth * pw},${sy(Math.min(1, point.efficiency / 50))}`)
        .join(' ')
    } catch { return '' }
  })
  const ceFrontierDot = computed(() => {
    const frontier = ceData.value?.currentFrontier
    if (!frontier) return null
    return {
      cx: PL + frontier.rangeWidth * pw,
      cy: sy(Math.min(1, frontier.efficiency / 50)),
      label: ceData.value.skew === 1 ? 'CK 端点比 ±84.13%' : `偏斜端点比 ${pctFmt(frontier.rangeWidth)}`,
    }
  })
  const ceDot = computed(() => {
    try {
      const e = props.graph.efficiency; if (!e) return { cx: PL, cy: sy(0) }
      const w = 1 - e.lower
      const cx = PL + Math.min(1, w) * pw
      const cy = sy(Math.min(1, e.efficiency / 50))
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return { cx: PL, cy: sy(0) }
      return { cx, cy }
    } catch { return { cx: PL, cy: sy(0) } }
  })

  const fundData = computed(() => {
    const funding = props.graph.funding
    return funding
      ? {
          basisFraction: funding.basisFraction,
          cumulativeFundingProxy: funding.cumulativeFundingProxy,
        }
      : null
  })

  const portData = computed(() => {
    const research = props.graph.portfolioResearch
    const p = research?.pnl
    if (!p || !Number.isFinite(p.scenarioTotal)) return null
    return {
      total: p.total,
      scenarioTotal: p.scenarioTotal,
      status: research.status,
      missingInputs: p.missingInputs ?? [],
      lpPnl: p.lp ?? 0,
      hedgePnl: p.hedge ?? 0,
      feeIncome: p.feeIncomeQuote,
      optionPnl: p.option ?? 0,
      fundingCashflowQuote: p.fundingCashflowQuote ?? 0,
      curve: props.graph.lpPortfolio?.points ?? [],
    }
  })
  const waterfallBars = computed(() => buildWaterfallBars(portData.value, geometry))
  const portfolioCurves = computed(() => buildPortfolioCurves(portData.value, geometry))

  const asianData = computed(() => {
    if (props.graph.asian) return props.graph.asian
    const m = props.market; const g = props.graph
    const ep = m?.markPrice || g.inputs?.entryPrice
    const iv = m?.annualVol || g.inputs?.iv
    const tenor = researchInputs.value.optionTenorSessions
    if (!ep || !iv || !Number.isFinite(tenor)) return null
    return asianOption({ entryPrice: ep, strikePrice: ep * 1.05, timeToExpirySessions: tenor, iv, riskFreeRate: 0.04, type: 'put', tradingDaysPerYear: g.inputs?.tradingDaysPerYear })
  })
  const bachelierData = computed(() => {
    if (props.graph.bachelier) return props.graph.bachelier
    const m = props.market; const g = props.graph
    const ep = m?.markPrice || g.inputs?.entryPrice
    const iv = m?.annualVol || g.inputs?.iv
    const tenor = researchInputs.value.optionTenorSessions
    if (!ep || !iv || !Number.isFinite(tenor)) return null
    return bachelierOption({ entryPrice: ep, strikePrice: ep * 1.05, timeToExpirySessions: tenor, normalVol: iv * ep, riskFreeRate: 0.04, type: 'put', tradingDaysPerYear: g.inputs?.tradingDaysPerYear })
  })

  const ammData = computed(() => {
    const mp = props.market?.markPrice || props.graph.inputs?.entryPrice
    if (!mp) return null
    return {
      curve: ammCurve({ price: mp, invariant: mp, n: 50 }),
      numoen: props.graph.numoen ?? numoenSnapshot(),
    }
  })

  const fingerprintData = computed(() => {
    if (props.graph.liquidityFingerprint) return props.graph.liquidityFingerprint
    const mp = props.market?.markPrice || props.graph.inputs?.entryPrice
    if (!mp) return null
    return liquidityFingerprint({
      entryPrice: props.market?.costAnchor || mp,
      priceGrid: 60, distribution: 'log-laplace',
      lambda: 2,
      kappa: 1,
      segmentCount: 12,
      activePrice: mp,
      costAnchor: props.market?.costAnchor,
      targetRange: { lower: props.market?.costLow, upper: props.market?.costHigh },
      orderLevels: props.graph.plan?.primaryOrders,
      volatility: props.market?.annualVol || props.graph.inputs?.iv,
      tradingDaysPerYear: props.graph.inputs?.tradingDaysPerYear ?? props.market?.tradingDaysPerYear,
    })
  })

  const devScoreData = computed(() => {
    const m = props.market; const g = props.graph
    return deviationScore({ costDistance: m?.costDistance, annualVol: m?.annualVol, formulaHorizonSessions: g.inputs?.formulaHorizonSessions, tradingDaysPerYear: g.inputs?.tradingDaysPerYear })
  })
  const normalCurve = computed(() => buildNormalCurve(geometry))
  const zMarker = computed(() => buildZMarker(devScoreData.value, geometry))

  const riskSurfaceData = computed(() => {
    const g = props.graph; const m = props.market; const b = g.deltaBands
    const ep = m?.markPrice || g.inputs?.entryPrice
    const tenor = researchInputs.value.optionTenorSessions
    const iv = m?.annualVol || g.inputs?.iv
    if (!ep || !iv || !Number.isFinite(tenor) || !b?.long) return null
    return riskSurface({ entryPrice: ep, strikePrice: ep, timeToExpirySessions: tenor, iv, bandLow: b.long.low, bandHigh: b.long.high, tradingDaysPerYear: g.inputs?.tradingDaysPerYear })
  })

  const netLpData = computed(() => {
    const g = props.graph
    return lpResearchAttribution({
      capitalEfficiency: g.efficiency?.efficiency,
      lpIlFraction: g.rangeV3Il?.rangeV3Il,
      ilModel: g.rangeV3Il?.model,
      capitalBasis: 'same-entry-inventory-hold-value',
      startPrice: g.rangeV3Il?.startPrice,
      markPrice: g.rangeV3Il?.markPrice,
      lowerPrice: g.rangeV3Il?.lowerPrice,
      upperPrice: g.rangeV3Il?.upperPrice,
      feeReturn: null,
      feeSource: null,
      feeTreatment: null,
      horizonSessions: g.inputs?.formulaHorizonSessions,
    })
  })

  const netCarryData = computed(() => props.graph.netCarry ?? null)
  const netCarryDisplay = computed(() => buildNetCarryDisplay(netCarryData.value, geometry))
  const lpPoolData = computed(() => {
    const row = activeFormulaRow.value
    if (!row) return null
    if (![row.lpPoolTurnover24h, row.lpPoolTopReserveShare].some(Number.isFinite)) return null
    const state = row.fieldStates?.lpPoolTurnover24h
    return {
      turnover24h: row.lpPoolTurnover24h,
      topReserveShare: row.lpPoolTopReserveShare,
      inputMode: state?.inputMode,
      missingInputs: state?.missingInputs ?? [],
      isSynthetic: state?.isSynthetic,
      poolCoverage: state?.context?.poolCoverage,
    }
  })
  const {
    mrData,
    dynamicHoldingData,
    decayCurve,
    hlMarker,
    gpData,
    gammaCurve,
    gpMarker,
    vcData,
  } = useFormulaSecondOrderModel({
    props,
    activeIndex,
    activeRows,
    layout: { PL, pw, sy },
  })

  const guide = computed(() =>
    buildFormulaChartGuide({
      formulaId: props.formulaId,
      market: props.market,
      graph: props.graph,
      greeks: greeksData.value,
      rangeV3Il: props.graph.rangeV3Il,
      deviationScore: devScoreData.value,
      netCarry: netCarryData.value,
      netLp: netLpData.value,
      dynamicHolding: dynamicHoldingData.value,
      meanReversion: mrData.value,
      gammaPnl: gpData.value,
      volConfidence: vcData.value,
      researchInputs: researchInputs.value,
      fmt,
      f4,
      pctFmt,
    }),
  )
  const orderData = computed(() => buildFormulaOrderData(props.graph.plan))

  return {
    stage,
    availability,
    orderReview,
    activeIndex,
    fmt,
    f4,
    pctFmt,
    pathData,
    costData,
    volData,
    bandData,
    greeksData,
    lpData,
    syH,
    lpV3Curve,
    lpV3Marker,
    lpRealMarker,
    lpV3Bounds,
    ceData,
    ceCurve,
    ceDot,
    ceFrontierDot,
    fundData,
    portData,
    waterfallBars,
    portfolioCurves,
    asianData,
    bachelierData,
    ammData,
    fingerprintData,
    devScoreData,
    normalCurve,
    zMarker,
    riskSurfaceData,
    lpPoolData,
    netLpData,
    netCarryData,
    netCarryDisplay,
    guide,
    mrData,
    dynamicHoldingData,
    decayCurve,
    hlMarker,
    gpData,
    gammaCurve,
    gpMarker,
    vcData,
    orderData,
    W,
    H,
    PL,
    PR,
    PT,
    PB,
    pw,
    ph,
    sx,
    sy,
  }
}
