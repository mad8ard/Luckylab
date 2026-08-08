# Formula and Planning Flow

The default plan path is intentionally narrow. Research metrics may be visible, but only explicit executable domain outputs can drive candidate orders.

## Executable Flow

```txt
OHLCV rows
  -> MarketData market state path
  -> cursor observation state
  -> executable input semantics
  -> GetDelta bands
  -> StrategyPlanning decision graph
  -> candidate order table
  -> UI status, risks, blocked reasons
```

## Research Flow

```txt
Market state + user research inputs + executable graph
  -> FormulaResearch snapshot
  -> ResearchVisualization models
  -> chart panes, racks, overlays, source labels
```

Research flow is side-channel visualization. It does not silently mutate `strategyProfile`, condition triggers, account requirements, or candidate orders.

## Required Separation

Keep these terms separate:

| Term | Meaning | Typical owner |
| --- | --- | --- |
| `markPrice` | observed current market price at cursor | MarketData |
| `entryPrice` | user or command-selected entry assumption | ViewModel input / StrategyPlanning |
| `costAnchor` | rolling market cost basis estimate | MarketData |
| `strikePrice` | option strike assumption | FormulaResearch |
| `startPrice` | formula path or replay start anchor | StrategyPlanning / Replay |

Do not reuse one field as another because values happen to be numerically close.

## Default Order Plan Rules

- Use `GetDelta(price, T, iv, profit)` for price bands at arbitrary entry price and holding time.
- Consume market cost state from MarketData.
- Express missing inputs and blocked states explicitly.
- Keep risk hints and invalidation lines in the decision graph, not hard-coded in components.
- Treat Black-Scholes, LP inventory, funding, capital efficiency, AMM geometry, and liquidity fingerprint as research or portfolio layers unless they are promoted through a documented domain model.

## Adding a New Formula

1. Add pure math and input semantics under `src/domain/formulas/`.
2. Add or update source evidence under `docs/formula-evidence/`.
3. Add Vitest coverage in `src/domain/__tests__/` or a focused test folder.
4. Decide whether the formula is executable, research-only, or future portfolio scope.
5. If executable, expose a structured query result to StrategyPlanning.
6. If research-only, expose a labeled result to FormulaResearch or ResearchVisualization.
7. Update UI only after the domain output has a stable shape.

## Adding a Planning Rule

1. Add the rule to StrategyPlanning, not a component.
2. Model required inputs, blocked reasons, trigger state, and output order fields.
3. Keep account assumptions explicit.
4. Add tests for triggered, untriggered, and blocked cases.
5. Map the result in the ViewModel and render it in the relevant component.
