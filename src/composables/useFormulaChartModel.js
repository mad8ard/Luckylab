import { computed } from 'vue'
import { formulaStages } from '../domain/formulas/registry.js'
import { ammCurve, asianOption, bachelierOption, deviationScore, liquidityFingerprint, netCarry, netLpEfficiency, numoenSnapshot, riskSurface } from '../domain/formulas/core.js'
import { useFormulaSecondOrderModel } from './useFormulaSecondOrderModel.js'

export function useFormulaChartModel(props) {
  const stage = computed(() => formulaStages.find((s) => s.id === props.formulaId))
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

  function fmt(v) { return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—' }
  function f4(v) { return Number.isFinite(v) ? v.toFixed(4) : '—' }
  function pctFmt(v) { return Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '—' }
  function planSummary(plan) { return plan ? `${plan.status}${plan.targetId ? `/${plan.targetId}` : ''}${Number.isFinite(plan.expectedDays) ? ` ${plan.expectedDays}天` : ''}` : '—' }

  const W = 520; const H = 200; const PL = 50; const PR = 16; const PT = 22; const PB = 24
  const pw = W - PL - PR; const ph = H - PT - PB
  const sx = (v) => PL + v * pw; const sy = (v) => PT + (1 - v) * ph

  /* ── path: 价格路径摘要 ── */
  const pathData = computed(() => {
    const r = activeRows.value
    if (!r?.length) return null
    const first = r[0]; const last = r.at(-1)
    const totalReturn = last.close / first.close - 1
    const logReturn = Math.log(last.close / first.close)
    const annualVol = props.market?.annualVol ?? 0
    return { count: r.length, firstDate: first.date, lastDate: last.date, firstClose: first.close, lastClose: last.close, totalReturn, logReturn, annualVol }
  })

  /* ── cost: 市场成本 ── */
  const costData = computed(() => {
    const m = props.market; if (!m) return null
    return { anchor: m.costAnchor, recent: m.costRecent, low: m.costLow, high: m.costHigh, distance: m.costDistance, price: m.markPrice, slope: m.costSlope5 }
  })

  /* ── volatility ── */
  const volData = computed(() => {
    const m = props.market; const g = props.graph
    if (!m) return null
    return { annualVol: m.annualVol, atr: m.atrPercent, momentum5: m.momentum5, momentum20: m.momentum20, iv: g.inputs?.iv }
  })

  /* ── delta-band ── */
  const bandData = computed(() => {
    const b = props.graph.deltaBands; const mp = props.market?.markPrice
    if (!b || !mp) return null
    const all = [b.long.low, b.long.cost, b.long.high, b.short.cost, b.short.high, mp]
    const min = Math.min(...all) * 0.9
    const max = Math.max(...all) * 1.1
    const range = max - min; const s = (v) => (v - min) / range
    return { min, max, range, longLow: s(b.long.low), longCost: s(b.long.cost), longHigh: s(b.long.high), shortLow: s(b.short.low), shortCost: s(b.short.cost), shortHigh: s(b.short.high), price: s(mp), wave: b.wave, ratio: b.longRatio, raw: b }
  })

  /* ── greeks ── */
  const greeksData = computed(() => {
    const portfolio = props.graph.optionPortfolio
    if (portfolio) {
      return {
        price: portfolio.value,
        delta: portfolio.delta,
        gamma: portfolio.gamma,
        thetaDaily: portfolio.thetaDaily,
        thetaAnnual: portfolio.thetaDaily * (props.graph.inputs?.tradingDaysPerYear || 365),
        vega: portfolio.vega,
        rho: portfolio.rho,
        legs: portfolio.legs?.length ?? 0,
        strategyClass: portfolio.strategyClass,
        isPortfolio: true,
      }
    }
    const o = props.graph.option; if (!o) return null
    return { price: o.price, delta: o.delta, gamma: o.gamma, theta: o.theta, thetaDaily: o.thetaDaily, thetaAnnual: o.thetaAnnual, vega: o.vega, rho: o.rho, d1: o.d1, d2: o.d2, legs: 1, isPortfolio: false }
  })

  /* ── lp-inventory + V2 + IL ── */
  const lpData = computed(() => {
    const v3 = props.graph.lpV3; const v2 = props.graph.lp; const il = props.graph.impermanentLoss
    return { v3, v2, il }
  })
  const syH = (v) => PT + (1 - v) * (200 - PT - PB)
  const lpV3Curve = computed(() => {
    const mp = props.market?.markPrice || props.graph.inputs?.entryPrice
    if (!mp) return ''
    try {
      const lo = mp * 0.5; const hi = mp * 2; const n = 50
      const rangeW = Number(researchInputs.value.rangeWidth) || 0.1
      const skew = Math.max(Number(researchInputs.value.skew) || 1, 0.01)
      const lowerP = props.graph.lpV3Hedged?.lowerPrice || mp * Math.max(1 - rangeW, 0.001)
      const upperP = props.graph.lpV3Hedged?.upperPrice || mp * (1 + rangeW * skew)
      const L = Math.max(Number(researchInputs.value.liquidity) || 1, 0.001)
      const pts = []; const svgH = 200 - PT - PB
      for (let i = 0; i <= n; i++) {
        const p = lo + (hi - lo) * i / n
        let val = 0
        if (p <= lowerP) val = L * (1 / Math.sqrt(lowerP) - 1 / Math.sqrt(upperP)) * p
        else if (p >= upperP) val = L * (Math.sqrt(upperP) - Math.sqrt(lowerP))
        else val = L * (1 / Math.sqrt(p) - 1 / Math.sqrt(upperP)) * p + L * (Math.sqrt(p) - Math.sqrt(lowerP))
        if (Number.isFinite(val)) pts.push({ price: p, value: val })
      }
      if (!pts.length) return ''
      const maxV = Math.max(...pts.map(p => p.value), 0.01)
      const minV = Math.min(...pts.map(p => p.value), 0)
      const rng = maxV - minV || 1
      return pts.map(p => `${PL + ((p.price - lo) / (hi - lo)) * pw},${PT + svgH * (1 - (p.value - minV) / rng)}`).join(' ')
    } catch { return '' }
  })
  const lpV3Marker = computed(() => {
    try {
      const mp = props.market?.markPrice; if (!mp) return { cx: PL, cy: syH(0.5) }
      const lo = mp * 0.5; const hi = mp * 2
      return { cx: PL + ((mp - lo) / (hi - lo)) * pw, cy: syH(0.5) }
    } catch { return { cx: PL, cy: syH(0.5) } }
  })
  const lpRealMarker = computed(() => {
    try {
      const mp = props.market?.markPrice
      const price = props.graph.lpOnchain?.quotePrice
      if (!mp || !Number.isFinite(price) || price <= 0) return null
      const lo = mp * 0.5; const hi = mp * 2
      const x = PL + ((price - lo) / (hi - lo)) * pw
      if (!Number.isFinite(x) || x < PL || x > W - PR) return null
      return {
        x,
        price,
        label: props.graph.lpOnchain?.pool?.label ?? '链上池价',
        divergence: (mp - price) / price,
      }
    } catch { return null }
  })
  const lpV3Bounds = computed(() => {
    try {
      const mp = props.market?.markPrice; if (!mp) return { loX: PL, hiX: PL + pw }
      const lo = mp * 0.5; const hi = mp * 2
      const rangeW = Number(researchInputs.value.rangeWidth) || 0.1
      const skew = Math.max(Number(researchInputs.value.skew) || 1, 0.01)
      const lp = props.graph.lpV3Hedged?.lowerPrice || mp * Math.max(1 - rangeW, 0.001)
      const up = props.graph.lpV3Hedged?.upperPrice || mp * (1 + rangeW * skew)
      return { loX: PL + ((lp - lo) / (hi - lo)) * pw, hiX: PL + ((up - lo) / (hi - lo)) * pw }
    } catch { return { loX: PL, hiX: PL + pw } }
  })

  /* ── capital-efficiency ── */
  const ceData = computed(() => { const e = props.graph.efficiency; return e ? { efficiency: e.efficiency, lower: e.lower, upper: e.upper } : null })
  const ceCurve = computed(() => {
    try {
      const n = 50; const pts = []
      for (let i = 1; i <= n; i++) {
        const w = i / n; const lo = 1 - w; const up = 1 + w
        if (lo <= 0) continue
        const eff = 1 / (1 - Math.pow(lo / up, 0.25))
        if (!Number.isFinite(eff) || eff > 100) continue
        const x = PL + (w / 1.0) * pw; const y = sy(Math.min(1, eff / 50))
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push(`${x},${y}`)
      }
      return pts.join(' ')
    } catch { return '' }
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

  /* ── funding ── */
  const fundData = computed(() => { const f = props.graph.funding; return f ? { ratio: f.ratio, funding: f.funding } : null })

  /* ── portfolio ── */
  const portData = computed(() => {
    const p = props.graph.portfolioResearch?.value; const h = props.graph.lpV3Hedged
    if (!Number.isFinite(p)) return null
    return { total: p, lpPnl: h?.lpPnl ?? 0, hedgePnl: h?.hedgePnl ?? 0, feeIncome: h?.feeIncome ?? 0, optionVal: props.graph.option?.price ?? 0, curve: props.graph.lpPortfolio?.points ?? [] }
  })
  const waterfallBars = computed(() => {
    const p = portData.value; if (!p) return []
    const items = [
      { label: 'LP PnL', val: p.lpPnl || 0 },
      { label: '对冲', val: p.hedgePnl || 0 },
      { label: '手续费', val: p.feeIncome || 0 },
      { label: '期权', val: p.optionVal || 0 },
    ]
    const maxAbs = Math.max(...items.map(i => Math.abs(i.val)), 1)
    const barW = Math.min(60, Math.max(20, (pw - 40) / items.length))
    const gap = Math.max(4, (pw - barW * items.length) / (items.length + 1))
    return items.map((item, i) => {
      const x = PL + gap + i * (barW + gap)
      const h = Math.max(2, Math.min(ph * 0.8, (Math.abs(item.val || 0) / maxAbs) * ph * 0.8))
      const y = (item.val || 0) >= 0 ? sy(0) - h : sy(0)
      const fill = (item.val || 0) >= 0 ? 'var(--green)' : 'var(--red)'
      return { x, y, w: barW, h, fill, label: item.label, val: item.val || 0 }
    })
  })
  const portfolioCurves = computed(() => {
    const points = portData.value?.curve ?? []
    if (points.length < 2) return null
    const minP = Math.min(...points.map(p => p.price))
    const maxP = Math.max(...points.map(p => p.price))
    const vals = points.flatMap(p => [p.lpPnl, p.optionValue, p.hedgePnl, p.combined]).filter(Number.isFinite)
    const minV = Math.min(...vals, 0)
    const maxV = Math.max(...vals, 1)
    const spanP = maxP - minP || 1
    const spanV = maxV - minV || 1
    const line = (key) => points
      .map(p => `${PL + ((p.price - minP) / spanP) * pw},${PT + (1 - ((p[key] - minV) / spanV)) * ph}`)
      .join(' ')
    return { lp: line('lpPnl'), option: line('optionValue'), hedge: line('hedgePnl'), combined: line('combined'), minP, maxP, minV, maxV }
  })

  /* ── asian-option ── */
  const asianData = computed(() => {
    if (props.graph.asian) return props.graph.asian
    const m = props.market; const g = props.graph
    const ep = m?.markPrice || g.inputs?.entryPrice
    const iv = m?.annualVol || g.inputs?.iv
    if (!ep || !iv) return null
    return asianOption({ entryPrice: ep, strikePrice: ep * 1.05, holdingDays: g.inputs?.holdingDays || 30, iv, riskFreeRate: 0.04, type: 'put' })
  })
  const bachelierData = computed(() => {
    if (props.graph.bachelier) return props.graph.bachelier
    const m = props.market; const g = props.graph
    const ep = m?.markPrice || g.inputs?.entryPrice
    const iv = m?.annualVol || g.inputs?.iv
    if (!ep || !iv) return null
    return bachelierOption({ entryPrice: ep, strikePrice: ep * 1.05, holdingDays: g.inputs?.holdingDays || 30, normalVol: iv * ep, riskFreeRate: 0.04, type: 'put' })
  })

  /* ── amm-geometry ── */
  const ammData = computed(() => {
    const mp = props.market?.markPrice || props.graph.inputs?.entryPrice
    if (!mp) return null
    return {
      curve: ammCurve({ price: mp, invariant: mp, n: 50 }),
      numoen: props.graph.numoen ?? numoenSnapshot(),
    }
  })

  /* ── liquidity-fingerprint ── */
  const fingerprintData = computed(() => {
    if (props.graph.liquidityFingerprint) return props.graph.liquidityFingerprint
    const mp = props.market?.markPrice || props.graph.inputs?.entryPrice
    if (!mp) return null
    return liquidityFingerprint({
      entryPrice: props.market?.costAnchor || mp,
      priceGrid: 60,
      distribution: 'log-laplace',
      lambda: 2,
      kappa: 1,
      segmentCount: 12,
      activePrice: mp,
      costAnchor: props.market?.costAnchor,
      targetRange: { lower: props.market?.costLow, upper: props.market?.costHigh },
      orderLevels: props.graph.plan?.primaryOrders,
      volatility: props.market?.annualVol || props.graph.inputs?.iv,
    })
  })

  /* ── Fusion: deviation-score ── */
  const devScoreData = computed(() => {
    const m = props.market; const g = props.graph
    return deviationScore({ costDistance: m?.costDistance, annualVol: m?.annualVol, holdingDays: g.inputs?.holdingDays, tradingDaysPerYear: g.inputs?.tradingDaysPerYear })
  })
  const normalCurve = computed(() => {
    try {
      const n = 50; const pts = []; const step = 6 / n
      for (let i = 0; i <= n; i++) {
        const z = -3 + i * step
        const dens = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)
        pts.push(`${PL + ((z + 3) / 6) * pw},${sy(Math.min(1, dens / 0.4))}`)
      }
      return pts.join(' ')
    } catch { return '' }
  })
  const zMarker = computed(() => {
    try {
      const z = devScoreData.value?.z || 0
      const dens = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)
      const x = PL + ((z + 3) / 6) * pw
      const y = sy(Math.min(1, dens / 0.4))
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: PL, y: sy(0) }
      return { x, y }
    } catch { return { x: PL, y: sy(0) } }
  })

  /* ── Fusion: risk-surface ── */
  const riskSurfaceData = computed(() => {
    const g = props.graph; const m = props.market; const b = g.deltaBands
    const ep = m?.markPrice || g.inputs?.entryPrice
    return riskSurface({ entryPrice: ep, strikePrice: ep, holdingDays: g.inputs?.holdingDays || 30, iv: m?.annualVol || g.inputs?.iv || 0.4, bandLow: b?.long?.low || ep * 0.5, bandHigh: b?.long?.high || ep * 1.5, tradingDaysPerYear: g.inputs?.tradingDaysPerYear })
  })

  /* ── Fusion: net-lp-efficiency ── */
  const netLpData = computed(() => {
    const g = props.graph
    return netLpEfficiency({ capitalEfficiency: g.efficiency?.efficiency, impermanentLoss: g.impermanentLoss?.impermanentLoss, feeRate: 0.003 })
  })

  /* ── Fusion: net-carry ── */
  const netCarryData = computed(() => {
    const m = props.market; const g = props.graph
    return netCarry({ costDistance: m?.costDistance, fundingRate: g.funding?.funding, holdingDays: g.inputs?.holdingDays, tradingDaysPerYear: g.inputs?.tradingDaysPerYear })
  })
  const lpPoolData = computed(() => {
    const row = activeFormulaRow.value
    if (!row) return null
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
    researchInputs,
    devScoreData,
    fingerprintData,
    layout: { PL, pw, sy },
  })

  /* ── 小白指南 ── */
  const guide = computed(() => {
    const id = props.formulaId; const m = props.market; const g = props.graph
    const b = g.deltaBands; const o = greeksData.value; const il = g.impermanentLoss
    const ds = devScoreData.value; const nc = netCarryData.value; const nl = netLpData.value; const dh = dynamicHoldingData.value

    const guides = {
      path: { title: '怎么看价格路径', body: `这里有 ${m?.rows || '—'} 天的 K 线数据。对数收益是把涨跌幅取对数，用来算波动率。区间跨越 ${m ? '多年' : '—'} ，数据量足够让公式稳定工作。` },
      cost: { title: '市场成本事实', body: `成本锚 ${fmt(m?.costAnchor)} 是滚动成交量加权价格。现价 ${fmt(m?.markPrice)}，相对成本偏离 ${pctFmt(m?.costDistance)}。成本带上沿和下沿只表示当前样本内的成本区间，不单独构成操作结论。` },
      volatility: { title: '波动口径事实', body: `年化波动 ${pctFmt(m?.annualVol)}，ATR ${pctFmt(m?.atrPercent)}。这些数值只描述样本波动，不代表未来波动或仓位建议。` },
      'delta-band': { title: 'GetDelta 价格带', body: `在 ${g.inputs?.holdingDays || 30} 天窗口、${pctFmt(g.inputs?.iv)} 波动下，GetDelta 输出多头带 ${fmt(b?.long?.low)} ~ ${fmt(b?.long?.high)}。该带是公式输出，进入模拟挂单前还需要市场成本状态和账户输入共同满足。` },
      'option-greeks': { title: '怎么看期权 Greeks', body: `${o?.isPortfolio ? '组合' : '单腿'} Delta ${f4(o?.delta)}：标的涨 1 元，模型价值约变动 ${f4(o?.delta)} 元。${(o?.delta ?? 0) > 0 ? '正 Delta = 偏多暴露' : '负 Delta = 偏空/保护暴露'}。Gamma ${f4(o?.gamma)} 管曲率，Theta/日 ${f4(o?.thetaDaily ?? o?.theta)} 管时间损耗，Rho ${f4(o?.rho)} 管利率敏感度。该页是 research-only 风险拆解。` },
      'asian-option': { title: '研究层：Asian/Bachelier', body: `Asian 使用几何均价近似，Bachelier 使用 normal vol 口径，两者用于观察 LP payoff 的平滑贴合关系。它们是研究层曲线，不参与默认挂单结论。` },
      'lp-inventory': { title: '研究层：LP 库存', body: `当前 V3 LP 头寸价值 ${fmt(g.lpV3?.value)}，无常损失估计 ${pctFmt(il?.impermanentLoss)}。这些值来自研究层输入，不等于真实链上 LP 仓位。` },
      'liquidity-fingerprint': { title: '研究层：流动性指纹', body: `连续密度现在按底层分布、现价、成本锚、区间和模拟挂单拆成成分，再归一化离散成 LP 区间权重；右侧竖仓仍是模型目标仓，不是市场盘口。池级链上快照可作为来源状态，真实 tick 分布和链上 LP NFT 权重仍未接入。` },
      'amm-geometry': { title: '研究层：AMM 几何', body: `绿线是恒定乘积，蓝线是 Lambert W 研究曲线，Numoen 快照只展示 reverse-engineered invariant / quoter / slippage，状态为 protocol-unverified，不能作为交易信号。` },
      'capital-efficiency': { title: '研究层：资本效率', body: `资本效率 ${(g.efficiency?.efficiency ?? 0).toFixed(1)}×，区间 [${(g.efficiency?.lower ?? 0).toFixed(2)}, ${(g.efficiency?.upper ?? 0).toFixed(2)}]。该值只描述区间宽度函数，不判断仓位是否有效。` },
      funding: { title: '研究层：资金费率', body: `当前只有 perp TWAP / spot TWAP - 1 的估计：${pctFmt(g.funding?.ratio)}。还没有接真实永续资金费率、结算周期、交易所制度和历史结算数据，不能作为持仓结论。` },
      portfolio: { title: '研究层：组合研究', body: `组合视图只是把 LP、期权、对冲、手续费和资金费率估计放在一起检查。由于 LP payoff、资金费率和真实区间权重仍未校准，这里不参与默认挂单。` },
      'order-plan': { title: '模拟挂单', body: g.plan?.primaryOrders?.length ? `${g.plan.primaryOrders.length} 条模拟挂单来自已满足的信号条件和账户输入。` : `当前没有模拟挂单：${g.decision?.blockedReasons?.[0] || g.decision?.missingInputs?.[0] || '信号条件未触发'}。` },
      'deviation-score': { title: '偏离强度事实', body: `Z-score ${ds?.z?.toFixed(2)}，样本内偏离状态为 ${ds?.strength ?? '—'}。该值只衡量成本偏离强度，不单独构成交易信号。` },
      'risk-surface': { title: '怎么看风险曲面', body: `在 GetDelta 价格带 [${fmt(b?.long?.low)}, ${fmt(b?.long?.high)}] 上展开 Greeks：Delta 曲线（绿）从虚值到实值，Gamma（蓝）在入场价附近最大 → 这里风险敏感度最高，调仓最频繁。越远离入场价，Gamma 越小 → 风险变化平缓。` },
      'lp-pool-coverage': { title: '研究层：LP 池覆盖', body: `池覆盖只读聚合池快照，展示 24h 换手和主池资金占比；tick 流动性历史和 LP 加减仓事件未接入，不作为交易结论。` },
      'net-lp-efficiency': { title: '研究层：LP 净效率', body: `当前净效率 ${nl ? nl.totalNet.toFixed(1) : '—'}× 只是 IL × CE 的估计。真实 LP 区间权重、手续费制度和再平衡规则未完成，不能判断“可行/赚钱”。` },
      'net-carry': { title: '研究层：持仓净收益', body: `当前净收益估计 ${pctFmt(nc?.netReturn)} 只使用 TWAP 偏离。真实资金费率和结算制度未接入，不能作为持仓是否有利的结论。` },
      'mean-reversion': { title: '均值回归半衰期', body: `自回归系数 ρ=${mrData.value?.rho?.toFixed(3)}，半衰期 ${mrData.value?.halfLifeDays !== null && mrData.value?.halfLifeDays !== undefined ? Math.round(mrData.value.halfLifeDays) + ' 个交易日' : '不可定义'}。只有 |ρ|<1 才是历史均值回归；ρ<0 表示偏离正负交替衰减。` },
      'dynamic-holding-state': { title: '动态持仓状态', body: `当前阶段 ${dh?.phaseLabel ?? '—'}，状态 ${dh?.status ?? '—'}。短线 ${planSummary(dh?.holdingPlan?.shortTrade)}；基金周期 ${planSummary(dh?.holdingPlan?.fundCycle)}。输入只使用当前观察点之前的回撤、z、半衰期和结构目标。` },
      'gamma-pnl': { title: '怎么看 Gamma PnL', body: `持仓 Gamma ${fmt(gpData.value?.positionGamma)}，Dollar Gamma ${fmt(gpData.value?.dollarGamma)}。本次价格变动 ${fmt(gpData.value?.priceChange)}，凸性估计 ${fmt(gpData.value?.gammaPnl)}。${gpData.value?.convexityNote}。绝对价格口径用 ½·持仓Γ·(ΔP)²；收益率口径等价为 ½·Dollar Gamma·(ΔP/P)²。这里是模型情景值，不是实际人民币收益。` },
      'vol-confidence': { title: '波动率区间估计', body: `基于 ${vcData.value?.sampleSize} 天样本，波动率区间估计为 [${pctFmt(vcData.value?.lower)}, ${pctFmt(vcData.value?.upper)}]。相对误差 ${pctFmt(vcData.value?.relativeUncertainty)}，精度标签 ${vcData.value?.quality}。` },
    }
    return guides[id] || null
  })
  const orderData = computed(() => {
    const plan = props.graph.plan; if (!plan?.primaryOrders?.length) return null
    return plan.primaryOrders.map((o) => ({
      action: o.role, side: o.side, price: o.price, notional: o.notional, amount: o.amount, target: o.targetPrice, expected: o.expectedProfit,
    }))
  })

  return {
    stage,
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
