---
name: china-stock-selection
description: Use this skill for Market Lab A-share and Hong Kong stock screening, source-labeled candidate reports, and T+1 short-hold replay.
---

# China Stock Selection — Generic Runtime Wrapper

Before taking any action, read `.agents/skills/china-stock-selection/SKILL.md` completely. That file is the sole semantic and safety contract for this skill.

This runtime delegates executable behavior to the canonical `.agents` implementation. Do not copy formulas or maintain alternate scoring rules here.

```bash
node skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股,港股 --top 20
node skills/china-stock-selection/scripts/replay-short-hold.mjs --profile combo
```

In particular, preserve these canonical rules:

- the social-security whitelist filters A shares only; Hong Kong stocks bypass it
- normal-reference deviation percentile/tail and empirical ranks diagnose extremeness, not reversion probability
- synthetic CK geometry is not a real LP position, token holding, fee income, or return
- dynamic targets use the cost band and anchor only
- AR holding/return fields are conditional zero-shock projections, not forecasts
- `signalStrength` is deviation extremeness, not confidence; all notionals stay simulation-only
- this static research skill never emits an executable order
- RSI, KDJ, EMA, and MA are outside this skill's decision model
