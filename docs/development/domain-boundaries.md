# Domain Boundaries

The domain layer is split by stable responsibility. Keep modules cohesive and explicit; do not create broad helper files that become a second application layer.

## MarketData

Primary path: `src/domain/market-data/`

Owns:

- OHLCV parsing and validation
- market sample metadata
- trading-days-per-year inference
- cost path, cost anchor, cost band
- market state path for cursor-based observation
- factual volatility, ATR, and momentum inputs

Notes:

- All consumers must import from `src/domain/market-data/` directly. The legacy `src/domain/market/` re-export shims have been removed.
- MarketData must not depend on StrategyPlanning, FormulaResearch, Vue, or browser APIs.

## FormulaResearch

Paths:

- `src/domain/formulas/`
- `src/domain/formula-research/`

Owns:

- `GetDelta` and related executable formula primitives
- Black-Scholes, LP, AMM, funding, liquidity, probability, and option portfolio research formulas
- source audit and evidence metadata
- research snapshot assembly

Rules:

- Research formulas can produce labeled query outputs.
- Research formulas cannot directly generate default order conclusions.
- Source and status labels should stay close to formula outputs.

## StrategyPlanning

Primary path: `src/domain/strategy-planning/`

Owns:

- executable strategy profile
- condition table
- required account and position inputs
- candidate order plan
- blocked reasons and invalidation lines
- decision graph consumed by the ViewModel

Rules:

- `OrderPlan` consumes formula bands and market cost state.
- It must not create a separate unrelated gradient formula.
- It may use executable `GetDelta` band primitives, but not research-only LP, AMM, funding, or liquidity fingerprint outputs as default plan inputs.

## ReplayAccount

Primary path: `src/domain/replay/`

Current scope:

- spot path replay
- cash and base position simulation
- next-bar limit fill
- target, stop, and expiry exit

Rules:

- Replay must use only data available at each bar.
- Keep heavy replay work bounded or explicitly triggered.
- Do not run unbounded historical simulation inside hot computed paths.
- Until portfolio legs exist, label outputs as spot path replay, not full strategy backtest.

## ResearchVisualization

Primary path: `src/domain/research-visualization/`

Owns:

- formula chart model
- liquidity rack model
- research-only overlays and pane layout state

Rules:

- It may read MarketData, FormulaResearch, and StrategyPlanning outputs.
- It must not write back into StrategyPlanning.
- UI must show source and status when research outputs are experimental, partial, or reference-only.

## Workbench ViewModel

Paths:

- `src/stores/`
- `src/composables/`

Owns:

- Pinia facade
- command handling
- persistence
- data loading
- user interaction state
- mapping domain outputs to UI state

The store is allowed to compose multiple domain query results, but it should not bury formulas or plan rules inline.
