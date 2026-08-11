# Research archive boundary

Everything below this directory is historical evidence, not a production input.

- `pine/` contains retired TradingView variants with fixed-window/fixed-horizon
  semantics. They are preserved only for audit.
- Ignored snapshots under `src/data/recommended-pools/` may contain older schema fields
  such as `holdingDays`, `regressionProbability`, RSI, or KDJ. Runtime and build code
  must never read those dated snapshots; current rendering consumes only the freshly
  generated `recommended-pool-latest.json` payload.

Archived material has `executionAuthority=none`. A result copied from it must be
re-derived under the current formula contract before it can even enter a research gate.
