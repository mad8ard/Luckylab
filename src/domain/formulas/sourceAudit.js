import { formulaEvidenceCatalog } from './evidence.js'
import { formulaStages } from './registry.js'

const BOUNDARIES = {
  path: 'Shared market-data query layer only; it normalizes OHLCV and never emits execution advice.',
  cost: 'Executable only as market cost state; order plans must combine it with formula bands and account constraints.',
  volatility: 'Volatility is a measurement input; it does not produce orders or risk budgets by itself.',
  'delta-band': 'Executable only as a price-band input; it is not a complete strategy by itself.',
  'option-greeks': 'Research and risk observation only unless a real option leg is configured.',
  'asian-option': 'Payoff-fit research for averaging and normal-vol comparisons; not a strategy conclusion.',
  'lp-inventory': 'Requires a real LP position before it can describe user exposure.',
  'liquidity-fingerprint': 'Model distribution only; not an order book or real LP interval map.',
  'lp-pool-coverage':
    'Real pool aggregate snapshot only; it marks coverage quality and must not infer historical tick liquidity.',
  'amm-geometry': 'Geometry and protocol research only; no default order output.',
  'capital-efficiency': 'Describes range geometry; does not imply profitability.',
  funding: 'Proxy-only TWAP basis estimate until exchange funding schedules and settlement history are wired.',
  portfolio: 'Requires configured legs and settlement rules before leaving research UI.',
  'order-plan': 'Executable query output only from cost band, GetDelta band, account, and explicit risk constraints.',
  'deviation-score': 'A normalized distance signal; it can filter execution but cannot alone place orders.',
  'risk-surface': 'Research surface over chart bands; not an order mutation path.',
  'net-lp-efficiency': 'Research-only fusion until real fee model, LP weights, and rebalance rules are present.',
  'net-carry': 'Proxy-only carry comparison until true funding schedule and settlement records exist.',
  'mean-reversion': 'Second-order observation for speed; it is not a timing command.',
  'gamma-pnl': 'Risk attribution for convexity; no execution authority by default.',
  'vol-confidence': 'Uncertainty band around volatility estimate; no direct order output.',
}

export const formulaSourceAudit = formulaStages.map((stage) => {
  const evidence = formulaEvidenceCatalog.find((entry) => entry.id === stage.id)
  const sources = evidence?.sources?.length
    ? evidence.sources
    : stage.sources?.length
      ? stage.sources
      : [`${evidence?.sourceTier ?? 'implementation'}:local`]

  return {
    id: stage.id,
    executable: Boolean(evidence?.executable),
    executionInput: Boolean(evidence?.executionInput),
    executionDecision: Boolean(evidence?.executionDecision),
    status: evidence?.status ?? stage.status,
    sourceTier: evidence?.sourceTier ?? 'implementation',
    sources,
    inputs: evidence?.inputs?.length ? evidence.inputs : stage.inputs,
    outputs: evidence?.outputs?.length ? evidence.outputs : stage.outputs,
    missingInputs: evidence?.missingInputs ?? [],
    boundary: BOUNDARIES[stage.id] ?? 'Query-only formula stage; not allowed to bypass domain execution constraints.',
  }
})

export function getFormulaSourceAudit(id) {
  return formulaSourceAudit.find((entry) => entry.id === id) ?? null
}
