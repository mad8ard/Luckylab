const INPUT_LABELS = Object.freeze({
  'ohlcv-history': '历史 OHLCV 路径',
  'mark-price': '观察价',
  'entry-price': '入场价',
  'cost-anchor': '成本锚',
  'cost-band': '成本上下沿',
  'cost-distance-series': '成本偏离序列',
  'realized-volatility': '历史已实现波动率',
  'atr-percent': 'ATR 波动比例',
  'trading-days-per-year': '市场年交易会话数',
  tradingDaysPerYear: '市场年交易会话数',
  'formula-derived-horizon': '公式推导周期',
  'formula-horizon-inputs': '公式周期推导所需输入',
  'formula-horizon-sessions': '公式周期（交易会话）',
  'getdelta-band': '对应周期的 GetDelta 价格带',
  'delta-band': 'GetDelta 价格带',
  'delta-slope': 'GetDelta 局部斜率',
  'option-tenor-sessions': '独立期权到期交易会话',
  'explicit-option-tenor-sessions': '明确的期权到期交易会话',
  'strike-price': '期权行权价',
  'scenario-strike': '情景行权价',
  'option-model-output': '期权模型输出',
  'real-option-leg': '真实期权合约腿',
  'option-leg-premium': '期权腿权利金报价',
  'verified-market-iv-source': '可验证的市场 IV 来源',
  'contract-multiplier': '合约乘数',
  'valid-lp-position-range': '有效 LP 仓位区间',
  'valid-arithmetic-range-width': '有效算术区间宽度',
  'declared-lp-scenario-or-complete-position': '已声明 LP 情景或可估值完整仓位',
  'lp-scenario-enabled': 'LP 研究情景开关',
  'lp-scenario-start-price': 'LP 情景入场价',
  'lp-scenario-range-width': 'LP 情景区间宽度',
  'lp-scenario-skew': 'LP 情景区间偏斜',
  'lp-scenario-liquidity': 'LP 情景流动性 L',
  'position-price-range': '可定价 LP 仓位区间',
  'valuation-liquidity-basis': '可估值 LP 流动性口径',
  liquidity: 'LP 流动性 L',
  'lp-liquidity': 'LP 流动性 L',
  startPrice: 'LP 入场价',
  'start-price': 'LP 入场价',
  'liquidity-fingerprint-output': '流动性指纹模型输出',
  'real-lp-pool': '真实 LP 池快照',
  'pool-coverage-snapshot': '聚合池覆盖快照',
  'position-nft': 'LP 仓位 NFT',
  'tick-liquidity': 'tick 流动性',
  'timestamped-tick-liquidity': '带时间戳的 tick 流动性',
  'tick-liquidity-history': 'tick 流动性历史',
  'lp-add-remove-events': 'LP 增减仓事件',
  'real-ticks': '真实 tick 数据',
  'lp-nft-weights': 'LP NFT 权重',
  'order-book-depth': '订单簿深度',
  'reserve-snapshot': '储备量快照',
  'range-width': '区间宽度',
  skew: '区间偏斜',
  'valuation-price-basis': '估值价格口径',
  perpTwap: '永续合约 TWAP',
  spotTwap: '现货 TWAP',
  'perp-twap': '永续合约 TWAP',
  'spot-twap': '现货 TWAP',
  'funding-session-duration-hours': '资金费结算会话时长',
  'exchange-schedule': '交易所结算制度',
  'settlement-history': '历史结算记录',
  'funding-cashflow-quote': '资金费现金流（报价币）',
  'funding-cashflow-source': '资金费现金流来源',
  'observed-funding-settlement': '已观测资金费结算',
  'cumulative-funding-proxy': '同周期累计资金费代理',
  'funding-position-side': '资金费腿方向',
  'funding-session-calendar-id': '资金费会话日历',
  'recovery-notional-basis': '修复腿名义本金口径',
  'funding-notional-basis': '资金费腿名义本金口径',
  'common-notional-basis': '共同名义本金口径',
  'target-price': '结构目标价',
  'recovery-side': '修复方向',
  'same-horizon-impermanent-loss': '同期限无常损失',
  'il-model': 'IL 模型',
  'common-capital-basis': '共同本金口径',
  'il-start-and-mark-price': 'IL 入场价与标记价',
  'il-model-range': 'IL 模型区间',
  'realized-or-path-fee-return': '已实现或路径手续费收益',
  'path-fee-source': '路径手续费数据源',
  'path-fee-model': '路径手续费模型',
  'fee-treatment': '手续费处理口径',
  'fee-and-il-horizon': '手续费与 IL 共同期限',
  'fee-income-quote': '手续费收入（报价币）',
  'lp-pnl': 'LP 损益',
  'option-pnl': '期权损益',
  'hedge-pnl': '对冲损益',
  'hedge-mark-value': '对冲腿标记价值',
  'hedge-entry-cashflow': '对冲腿入场现金流',
  'common-valuation-basis': '共同估值口径',
  'portfolio-ledger-inputs': '组合账本必要输入',
  'decision-state': '市场决策状态',
  'account.capital': '账户资金',
  'account.basePosition': '账户底仓',
  'monotonic-mean-reversion': '单调衰减的 AR 样本证据',
  'dynamic-holding-output': '动态持仓状态输出',
  'option-gamma': '期权 Gamma',
  'price-change-scenario': '价格变动情景',
  'volatility-sample-size': '至少 5 个有效波动样本',
})

const WORD_LABELS = Object.freeze({
  account: '账户',
  risk: '风险',
  limit: '上限',
  steps: '步骤',
  volume: '成交量',
  quote: '报价',
  price: '价格',
  horizon: '周期',
  sessions: '交易会话',
  source: '来源',
  model: '模型',
  range: '区间',
  capital: '资金',
  position: '仓位',
  liquidity: '流动性',
  history: '历史',
  settlement: '结算',
  calendar: '日历',
  option: '期权',
  funding: '资金费',
  fee: '手续费',
  input: '输入',
  output: '输出',
})

const BLOCK_REASON_LABELS = Object.freeze({
  'drawdown-repair-insufficient': '回撤修复尚不足',
  'drawdown-expanding': '回撤仍在扩张',
  'gross-return': '情景毛收益未达到当前门禁',
  'holding-window': '当前目标超出公式周期',
  'insufficient-history': '历史样本不足',
  'no-structural-target': '尚未形成前向结构目标',
  'non-finite-target-horizon': '目标周期无法得到有限值',
  'post-anchor-extension': '目标位于成本锚之后，属于延伸情景',
  'target-behind-entry': '目标与当前方向相反',
  'z-threshold': '偏离强度未达到当前门禁',
  'cycle-start-at-or-beyond-anchor': '周期起点已达到或超过成本锚，当前没有前向修复区间',
  'target-already-crossed-at-cycle-start': '结构目标在周期起点已被跨过，当前结构不适用',
  'target-not-strictly-between-cycle-start-and-anchor': '结构目标不在周期起点与成本锚之间，当前没有合法的前向修复目标',
  'non-monotonic-or-insufficient-ar-prefix': 'AR 样本不足或不是单调衰减，模型门禁未通过',
  'non-finite-recovery-horizon': '结构修复周期无法得到有限值，模型门禁未通过',
  'invalid-recovery-input': '结构修复周期的输入不完整',
  'delta-band-model-domain': '当前参数超出 GetDelta 有效定义域',
  'degenerate-volatility': '波动率样本为零，模型退化，当前不生成零宽价格带',
})

export function formatFormulaInputToken(value) {
  if (typeof value !== 'string' || !value.trim()) return '未标注的输入'
  const token = value.trim()
  if (INPUT_LABELS[token]) return INPUT_LABELS[token]
  return token
    .replace(/\[(\d+)\]/g, ' 第 $1 项 ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .split(/[\s._:/\\-]+/)
    .filter(Boolean)
    .map((part) => WORD_LABELS[part.toLowerCase()] ?? part)
    .join(' · ')
}

export function formatFormulaInputList(values, { limit = 4, empty = '无' } = {}) {
  const tokens = [
    ...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value)),
  ]
  if (!tokens.length) return empty
  const visible = tokens.slice(0, Math.max(1, limit)).map(formatFormulaInputToken)
  const remainder = tokens.length - visible.length
  return `${visible.join(' · ')}${remainder > 0 ? ` · 另 ${remainder} 项` : ''}`
}

export function formatFormulaBlockReason(value) {
  if (typeof value !== 'string' || !value.trim()) return '未标注的门禁原因'
  const token = value.trim()
  if (BLOCK_REASON_LABELS[token]) return BLOCK_REASON_LABELS[token]
  return /[\u3400-\u9fff]/u.test(token) ? token : '未标注的门禁原因'
}

export function formatFormulaReasonList(values, { limit = 2, empty = '无' } = {}) {
  const reasons = [
    ...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value)),
  ]
  if (!reasons.length) return empty
  const visible = reasons.slice(0, Math.max(1, limit)).map(formatFormulaBlockReason)
  const remainder = reasons.length - visible.length
  return `${visible.join('；')}${remainder > 0 ? `；另 ${remainder} 项` : ''}`
}
