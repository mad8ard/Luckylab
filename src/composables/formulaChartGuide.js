export function buildFormulaChartGuide({
  formulaId,
  market: m,
  graph: g,
  greeks: o,
  rangeV3Il,
  deviationScore: ds,
  netCarry: nc,
  netLp: nl,
  dynamicHolding: dh,
  meanReversion: mr,
  gammaPnl: gp,
  volConfidence: vc,
  researchInputs,
  fmt,
  f4,
  pctFmt,
}) {
  const b = g.deltaBands
  const guides = {
    path: {
      title: '怎么看价格路径',
      body: `这里有 ${m?.rows || '—'} 根已闭合 K 线。对数收益用于计算样本波动率；样本长度只说明覆盖量，不等于参数稳定、样本外有效或未来可预测。`,
    },
    cost: {
      title: '市场成本事实',
      body: `成本锚 ${fmt(m?.costAnchor)} 是滚动成交量加权价格。现价 ${fmt(m?.markPrice)}，相对成本偏离 ${pctFmt(m?.costDistance)}。成本带上下沿只表示当前样本内的成本区间，不单独构成操作结论。`,
    },
    volatility: {
      title: '波动口径事实',
      body: `年化波动 ${pctFmt(m?.annualVol)}，ATR ${pctFmt(m?.atrPercent)}。这些数值只描述样本波动，不代表未来波动或仓位建议。`,
    },
    'delta-band': {
      title: 'GetDelta 价格带',
      body: Number.isFinite(g.inputs?.formulaHorizonSessions)
        ? `在结构目标推导的 ${g.inputs.formulaHorizonSessions} 个交易会话、${pctFmt(g.inputs?.iv)} 波动下，GetDelta 输出多头带 ${fmt(b?.long?.low)} ~ ${fmt(b?.long?.high)}。该带是公式输出，进入模拟挂单前还需要市场成本状态和账户输入共同满足。`
        : '当前样本无法从单调 AR 半衰期与结构目标得到有限周期，因此不生成 GetDelta 带。',
    },
    'option-greeks': {
      title: '怎么看期权 Greeks',
      body: o
        ? `${o.isPortfolio ? '组合' : '单腿'} Delta ${f4(o.optionDelta)}：标的涨 1 元，模型价值约变动 ${f4(o.optionDelta)} 元。${optionDeltaDirection(o.optionDelta)}。Gamma ${f4(o.optionGamma)} 管曲率，Theta/交易会话 ${f4(o.optionThetaPerSession)} 管每个交易会话的时间损耗。期限来自独立期权到期输入，不能复用持仓恢复周期。当前波动来源为 ${o.volatilitySource ?? researchInputs?.volatilitySource ?? '未标注情景'}；未由期权报价反推时只能叫情景 σ，不能叫市场 IV。`
        : '尚未提供独立的期权到期会话或完整期权腿，当前不生成价格与 Greeks；股票修复周期不会被拿来替代期权期限。',
    },
    'asian-option': {
      title: '研究层：Asian/Bachelier',
      body: 'Asian 使用几何均价近似，Bachelier 使用 normal vol 口径，两者用于观察 LP payoff 的平滑贴合关系。它们是研究层曲线，不参与默认挂单结论。',
    },
    'lp-inventory': {
      title: '研究层：LP 库存',
      body: `已声明 LP 情景的 V3 模型价值 ${fmt(g.lpV3?.value)}，同情景入场库存对照的 V3 IL 为 ${pctFmt(rangeV3Il?.rangeV3Il)}。全范围 v2 IL 另列，不能冒充 v3 结果；聚合池报价不能替代仓位区间或流动性 L，结果不等于真实链上 LP 仓位。`,
    },
    'liquidity-fingerprint': {
      title: '研究层：流动性指纹',
      body: '目标分配核按底层形状、现价、成本锚、区间和模拟挂单拆成成分，再在当前展示范围归一化为 LP 区间权重。它不是价格发生概率。聚合池报价只作校准代理；只有真实 tick 深度才能进入对照和缺口机会查询。',
    },
    'amm-geometry': {
      title: '研究层：AMM 几何',
      body: '绿线是恒定乘积，蓝线是 Lambert W 研究曲线；Numoen 快照只展示逆向整理的 invariant / quoter / slippage，协议口径尚未验证，不能作为交易信号。',
    },
    'capital-efficiency': {
      title: 'CK 端点比资本效率边际拐点',
      body: g.efficiency
        ? `CK 在 Pa=P0(1-x)、Pb=P0(1+x) 的端点比曲线上精确解得 x*=84.1299%、CE*=2.1826×；这里 CE 在区间几何中点估值，P0 只是算术宽度坐标。若把 P0 当真实当前价，同一边界的 CE 是 ${Number.isFinite(g.efficiency.efficiencyAtArithmeticCenter) ? g.efficiency.efficiencyAtArithmeticCenter.toFixed(2) + '×' : '不可计算'}，必须另算。该定理不是概率覆盖，也不推出手续费或 PnL 最优。`
        : 'CK 的 84.1299% 是对称端点比资本效率曲线的边际拐点，不是概率、收益最优或执行区间；当前没有合法区间输入，因此不生成标的专属 CE 数值。',
    },
    funding: {
      title: '研究层：资金费率',
      body: g.funding
        ? `当前只有 perp TWAP / spot TWAP - 1 的估计：${pctFmt(g.funding.basisFraction)}。还没有接真实永续资金费率、结算周期、交易所制度和历史结算数据，不能作为持仓结论。`
        : '当前未提供 perp/spot TWAP、结算会话时长和同周期结构，资金费率层不生成数值；A/H 股票也不能虚构 funding。',
    },
    portfolio: {
      title: '研究层：组合情景 PnL',
      body: '组合视图按同一 PnL 列分列 LP、期权、对冲、手续费和 funding；mark 与入场现金流不再混加。缺真实权利金、路径手续费或资金结算时只显示情景合计并标记待校准，不参与默认挂单。',
    },
    'order-plan': {
      title: '模拟挂单',
      body: g.plan?.primaryOrders?.length
        ? `${g.plan.primaryOrders.length} 条模拟挂单来自已满足的信号条件和账户输入。`
        : `当前没有模拟挂单：${g.decision?.timing?.reason || '信号条件未触发'}。`,
    },
    'deviation-score': {
      title: '偏离强度事实',
      body: ds
        ? `Z-score ${ds.z.toFixed(2)}，正态参考偏离百分位 ${pctFmt(ds.deviationPercentile)}，双尾质量 ${pctFmt(ds.twoSidedTailProbability)}。这些量只描述极端度，不是未来回归概率，也不单独构成交易信号。`
        : '当前没有与方向和结构目标绑定的有限周期，因此不把日线偏离强行换算成 z-score；偏离度更不是胜率或回归概率。',
    },
    'risk-surface': {
      title: '怎么看风险曲面',
      body:
        b?.long && Number.isFinite(researchInputs?.optionTenorSessions)
          ? `在 GetDelta 价格带 [${fmt(b.long.low)}, ${fmt(b.long.high)}] 上展开 Greeks：Delta 曲线（绿）从虚值到实值，Gamma（蓝）在入场价附近最大；这里风险敏感度最高，调仓最频繁。`
          : '风险曲面需要同周期 GetDelta 价格带和独立期权到期会话；任一缺失时保持空白，不用固定期限补洞。',
    },
    'lp-pool-coverage': {
      title: '研究层：LP 池覆盖',
      body: '池覆盖只读聚合池快照，展示 24h 换手和主池资金占比；tick 流动性历史和 LP 加减仓事件未接入，不作为交易结论。',
    },
    'net-lp-efficiency': {
      title: '研究层：LP 归因拆解',
      body: nl
        ? `CE ${nl.geometry?.capitalEfficiency?.toFixed(2) ?? '—'}× 是几何倍数，不能与 IL/手续费收益相加。只有同本金、同期限的路径手续费和 IL 才能得到净收益；fee≈theta 也只是在同币种、期限和名义本金归一后的经济类比。`
        : '当前缺少同本金、同期限的 LP 路径手续费与 IL 归因，不能计算净效率；CE 是几何倍数，fee≈theta 只是严格归一化后的经济类比。',
    },
    'net-carry': {
      title: '研究层：持仓归因代理',
      body: nc
        ? `当前归因代理 ${pctFmt(nc.netReturn)} 只使用 TWAP 偏离。真实资金费率和结算制度未接入，不能作为持仓是否有利的结论。`
        : '当前缺少共同名义、同周期 funding 结算与结构目标，持仓归因保持空白，不能用 TWAP 偏离替代真实现金流。',
    },
    'mean-reversion': {
      title: '均值回归半衰期',
      body: mr
        ? `AR 系数=${mr.arCoefficient?.toFixed(3) ?? '不可定义'}，半衰期 ${mr.halfLifeSessions !== null && mr.halfLifeSessions !== undefined ? Math.round(mr.halfLifeSessions) + ' 个交易会话' : '不可定义'}。这是穿过原点的 AR(1) 样本诊断；只有 0<arCoefficient<1 的单调衰减能进入动态持仓，负系数保持阻断。`
        : '当前前缀不足以估计 AR(1) 衰减；没有 0<AR 系数<1 的单调证据时，不生成半衰期或持仓周期。',
    },
    'dynamic-holding-state': {
      title: '动态持仓状态',
      body: dh
        ? `当前阶段 ${dh.phaseLabel ?? '未标注'}，状态 ${dh.status ?? '待观察'}。短线 ${planSummary(dh.holdingPlan?.shortTrade)}；基金周期 ${planSummary(dh.holdingPlan?.fundCycle)}。周期和收益是在信号日结构冻结、AR 零冲击下的条件路径投影，不是预测。`
        : '当前没有合法的回撤状态、结构目标和 AR 半衰期，动态持仓状态保持关闭；系统不会回退到任何固定日历周期。',
    },
    'gamma-pnl': {
      title: '怎么看 Gamma PnL',
      body: gp
        ? `持仓 Gamma ${fmt(gp.positionGamma)}，Dollar Gamma ${fmt(gp.dollarGamma)}。本次价格变动 ${fmt(gp.priceChange)}，凸性估计 ${fmt(gp.gammaPnl)}。${gp.convexityNote ?? '未提供凸性注释'}。这是模型情景值，不是实际人民币收益。`
        : '当前缺少期权腿、数量、合约乘数或价格变动情景，因此不生成 Gamma PnL；合成曲率不能冒充账户实际收益。',
    },
    'vol-confidence': {
      title: '波动率样本区间',
      body: vc
        ? `基于 ${vc.sampleSize} 个交易会话样本，IID 正态假设下的近似区间为 [${pctFmt(vc.lower)}, ${pctFmt(vc.upper)}]。相对标准误差 ${pctFmt(vc.relativeUncertainty)}，标签 ${vc.quality}；它不是厚尾或自相关序列的稳健置信区间，也不是未来波动率保证。`
        : '当前收益样本不足，无法给出波动率近似区间；即使样本足够，该区间仍依赖 IID 正态近似，不是未来波动保证。',
    },
  }
  return guides[formulaId] || null
}

function optionDeltaDirection(optionDelta) {
  if (!Number.isFinite(optionDelta)) return 'Delta 缺失，不能判断方向暴露'
  return optionDelta > 0 ? '正 Delta = 偏多暴露' : optionDelta < 0 ? '负 Delta = 偏空/保护暴露' : 'Delta 为零'
}

export function buildFormulaOrderData(plan) {
  if (!plan?.primaryOrders?.length) return null
  return plan.primaryOrders.map((order) => ({
    action: order.role,
    side: order.side,
    price: order.price,
    notional: order.notional,
    amount: order.amount,
    target: order.targetPrice,
    expected: order.expectedProfit,
  }))
}

function planSummary(plan) {
  if (!plan) return '—'
  const target = plan.targetId ? `/${plan.targetId}` : ''
  const horizon = Number.isFinite(plan.expectedSessions) ? ` ${plan.expectedSessions} 个交易会话` : ''
  return `${plan.status}${target}${horizon}`
}
