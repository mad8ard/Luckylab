# Market Lab Bounded Context Map

Market Lab is a neutral fact workbench. It is not an advice engine or an AI strategy engine. The current replay surface is only a spot path replay; a full portfolio backtest engine requires separate domain objects for option, LP, funding, hedge, and liquidity rebalance legs.

## Bounded Contexts

### MarketData BC

Path: `src/domain/market-data/`

Owns factual market data and derived market state:

- OHLCV parsing and sample metadata
- trading-days-per-year inference
- rolling cost path, cost anchor, cost band
- ATR, annualized volatility, momentum
- market state path for cursor-based observation

It must not import FormulaResearch, StrategyPlanning, or Workbench UI.

### FormulaResearch BC

Path: `src/domain/formula-research/` and formula primitives in `src/domain/formulas/`

Owns research formulas and source evidence:

- option, LP, funding, AMM, liquidity fingerprint, and portfolio research formulas
- source audit and research/protocol status
- research snapshot assembled from user research inputs

It must not generate default candidate orders or write planning conclusions.

### StrategyPlanning BC

Path: `src/domain/strategy-planning/`

Owns the default condition table:

- executable profile
- GetDelta/cost-band trigger rules
- account and position input requirements
- missing inputs, blocked reasons, triggered conditions
- candidate orders and invalidation lines

It may consume MarketData and executable delta bands. It must not consume portfolio, LP efficiency, funding carry, AMM geometry, or liquidity fingerprint as default planning inputs.

### ReplayAccount BC

Path: `src/domain/replay/`

Owns path replay and future portfolio backtest simulation:

- current scope: cash, spot base position, next-bar limit fill, target/stop/expiry exit
- future portfolio scope: option legs, LP segment legs, hedge legs, fee accrual, funding settlement, rebalance events
- no future parameters: each bar may only use data and configuration available at that bar
- user-specific account start date and sample cutoff

Until portfolio legs are implemented, ReplayAccount outputs must be labeled as spot path replay, not full strategy backtest.

### ResearchVisualization BC

Path: `src/domain/research-visualization/`

Owns view models for research-only visualizations:

- formula chart model
- liquidity fingerprint rack model
- expanded research views and density/order overlays

It may read MarketData, FormulaResearch, and StrategyPlanning outputs, but it must not write back into StrategyPlanning.

### Workbench UI BC

Paths: `src/components/`, `src/composables/`, `src/stores/`, `src/canvas/`

Owns Vue, Pinia, persistence, layout, controls, and interaction commands. It should compose query models from the domain BCs and avoid embedding formulas or trading rules.

## Dependency Rule

Allowed direction:

```txt
Workbench UI
  -> MarketData
  -> FormulaResearch
  -> StrategyPlanning
  -> ResearchVisualization

StrategyPlanning -> MarketData
StrategyPlanning -> FormulaResearch only for executable GetDelta band primitives
ReplayAccount -> MarketData + StrategyPlanning
ResearchVisualization -> MarketData + FormulaResearch + StrategyPlanning
```

Forbidden direction:

```txt
MarketData -> FormulaResearch
MarketData -> StrategyPlanning
FormulaResearch -> StrategyPlanning
StrategyPlanning -> ResearchVisualization
ReplayAccount -> FormulaResearch research-only metrics as default PnL inputs
domain/* -> Workbench UI
```

## File Size Rule

Source files under `src/` must stay at or below 500 lines. `pnpm run check:size` enforces this and is part of `pnpm run build`.
