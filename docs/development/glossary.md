# Glossary

These terms are deliberately separate. Do not reuse one field for another without changing the domain model and tests.

## Price Terms

| Term | Meaning | Do not confuse with |
| --- | --- | --- |
| `markPrice` | observed market price at the active cursor | `entryPrice`, `costAnchor` |
| `entryPrice` | assumed or user-selected entry price for formula and plan calculations | `markPrice` |
| `costAnchor` | rolling market cost basis estimate derived from OHLCV state | `startPrice`, `entryPrice` |
| `strikePrice` | option strike used by option research formulas | `markPrice`, `entryPrice` |
| `startPrice` | starting anchor for a formula path or replay scenario | `costAnchor` |

## Planning Terms

| Term | Meaning |
| --- | --- |
| executable layer | market path, cost anchor, volatility basis, GetDelta bands, condition table, and candidate order plan |
| research layer | Black-Scholes, LP inventory, funding, AMM, capital efficiency, portfolio curves, liquidity fingerprint |
| candidate order | simulated order output from StrategyPlanning, not a trading instruction |
| blocked reason | explicit reason a plan cannot produce a valid conclusion |
| invalidation line | price or condition where the current candidate plan no longer applies |

## Data Terms

| Term | Meaning |
| --- | --- |
| OHLCV | open, high, low, close, volume row |
| sample | indexed static instrument dataset |
| generated data | JS module generated from CSV for Vite-owned production delivery |
| tdpy | trading days per year inferred per instrument with optional user override |

## Replay Terms

| Term | Meaning |
| --- | --- |
| spot path replay | current replay scope using cash, base position, limit fill, target, stop, and expiry |
| portfolio backtest | future scope requiring option, LP, hedge, fee, funding, and rebalance legs |
| no future parameters | a bar may only use data and configuration available at that bar |
