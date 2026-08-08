export function buildFormulaStrategyComposition({ market, executable, timing, position, plan, account }) {
  const inputs = executable?.inputs ?? {}
  const longBand = executable?.deltaBands?.long
  const primaryOrders = plan?.primaryOrders ?? []
  const basis = buildFormulaBasis(executable?.deltaBands, inputs)
  return {
    label: '自有公式策略组合',
    summary: '默认回测链路只接已验证的成本路径、GetDelta、偏离强度和账户执行；研究层公式不改写挂单。',
    formulaBasis: basis,
    steps: [
      {
        id: 'cost',
        label: '成本路径',
        formula: 'Cost_vwap / 成本带',
        status: '已接入',
        value: `${fmt(market?.costLow)} / ${fmt(market?.costAnchor)} / ${fmt(market?.costHigh)}`,
        role: '用 OHLCV 生成成本锚、上下沿和成本斜率。',
      },
      {
        id: 'delta-band',
        label: 'GetDelta',
        formula: 'P,T,s,d → r_T → K → L/H',
        status: '已接入',
        value: longBand ? `${fmt(longBand.low)} / ${fmt(longBand.cost)} / ${fmt(longBand.high)}` : '等待输入',
        role: `P=${fmt(inputs.entryPrice)}，T=${inputs.holdingDays ?? '—'} 天，s=${pct(inputs.iv)}，d=${pct(inputs.deltaSlope ?? inputs.targetReturn)}。`,
      },
      {
        id: 'deviation-score',
        label: '偏离强度',
        formula: 'costDistance / periodVol',
        status: '已接入',
        value: Number.isFinite(timing?.zScore) ? `${timing.zScore.toFixed(2)}σ · ${timing.zStrength}` : '等待市场态',
        role: '把成本偏离换算成持仓窗口内的波动尺度。',
      },
      {
        id: 'order-plan',
        label: 'OrderPlan',
        formula: '公式带 + 账户权益',
        status: primaryOrders.length ? `${primaryOrders.length} 档` : '未生成',
        value: `${sideLabel(position?.side)} · 目标 ${fmt(position?.targetPrice)} · 失效 ${fmt(position?.stopPrice)}`,
        role: account?.isConfigured ? '账户已接入，按风险预算和仓位上限生成候选单。' : '缺少账户资金或底仓时不生成名义金额。',
      },
    ],
    executionParams: [
      ['执行档位', '只调过滤、仓位和冷却，不新增公式'],
      ['公式输入', `d=${pct(inputs.deltaSlope ?? inputs.targetReturn)}；T=${inputs.holdingDays ?? '—'} 天`],
      ['候选订单', primaryOrders.length ? `${primaryOrders.length} 档` : '未触发或缺账户'],
    ],
    researchOnly: [
      ['期权 Greeks', '研究层', '展示风险曲面，不改写 OrderPlan。'],
      ['LP / 流动性', '研究层', '展示库存和密度，不生成默认挂单。'],
      ['Funding / Carry', '研究层', '未接真实结算制度，不参与回测收益。'],
      ['AMM / Numoen', '研究层', '协议口径未验证，不输出策略判断。'],
    ],
  }
}

export const formulaSource = {
  sourceId: '943334771f',
  title: '永久uni期权计算',
  status: 'implemented',
  equation: 'a=s√(T/(N·2π)); r_T=((1+a)/(1-a))²; K=P(1+d(r_T-1))²/r_T',
  note: 'T 是本次仓位持有/到期时间；历史统计只能辅助执行档位，不能改写 P/T/s/d。',
}

export function buildFormulaBasis(bands, inputs = {}) {
  return {
    ...formulaSource,
    variables: [
      ['P', '入场/观察价', fmt(inputs.entryPrice)],
      ['T', '持仓/到期天数', `${fmtRaw(inputs.holdingDays)} 天`],
      ['s', '年化 IV', pct(inputs.iv)],
      ['d', '目标增量', pct(inputs.deltaSlope ?? inputs.targetReturn)],
    ],
    terms: [
      ['a', 's√(T/(N·2π))', fixed(bands?.wave, 4)],
      ['r_T', '((1+a)/(1-a))²', fixed(bands?.rT, 4)],
      ['K', 'P(1+d(r_T-1))²/r_T', fmt(bands?.long?.cost)],
      ['L/H', 'K/r_T, K·r_T', bands?.long ? `${fmt(bands.long.low)} / ${fmt(bands.long.high)}` : '—'],
      ['局部斜率', 'g′(P)', fixed(bands?.long?.localSlopeAtEntry, 4)],
    ],
  }
}

function sideLabel(side) {
  if (side === 'buy') return '买入候选'
  if (side === 'sell') return '卖出候选'
  return '等待'
}

function fmt(value) {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

function pct(value) {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(0)}%`
}

function fixed(value, digits) {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

function fmtRaw(value) {
  if (!Number.isFinite(value)) return '—'
  return Number(value.toFixed(2)).toLocaleString('zh-CN')
}
