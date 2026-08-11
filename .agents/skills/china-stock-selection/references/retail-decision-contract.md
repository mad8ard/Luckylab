# Retail Decision Contract

Use this contract whenever the skill ranks, explains, or plans around a candidate. Its purpose is to reduce irreversible mistakes, not to manufacture certainty.

## Four Separate States

Do not compress different permissions into one optimistic label:

- `dataState`: `ready`, `provisional`, `stale`, or `invalid`. An isolated dated path diagnostic can be `ready` only for its narrowly verified scope. The current local-only screen/replay candidate record always stays `provisional` when current because corporate actions, suspension/limit status, exchange calendar, point-in-time identity, and execution inputs are not all verified.
- `scoreStatus`: the raw diagnostic ranking only. It grants no permission.
- `candidateStatus`: `需刷新数据`, `剔除`, `等待`, or `观察`. `观察` means the declared research gates passed; it is still not an order.
- `executionStatus`: only `blocked` or `simulation-only` in this static stock-selection skill. It never becomes `executable`; that requires a separate execution workflow with timestamped account, quote, liquidity, settlement, and cost inputs.

Never promote any state merely because a raw score is high. Preserve all four states and the reasons for every blocked or provisional state.

## Required Minimum Backing Record

For each shortlisted candidate, produce this minimum backing record or explicitly mark
fields missing. The five-question retail view below is a projection of this record, not
a replacement for its evidence and risk fields:

```text
instrument: symbol / verified or source-labelled name / market
data: source / dataThrough / rows / freshness / filters
state: dataState / scoreStatus -> candidateStatus / executionStatus
thesis: one testable sentence
claims: each non-trivial claim paired with exact-identity / sample-estimate / calibrated-estimate / scenario-proxy / missing-input
supportingEvidence: domain outputs that support the thesis
counterEvidence: trend, drawdown, uncertainty, missing fundamentals/news, or conflicting model outputs
invalidation: observable condition that would make the thesis no longer apply
riskBudget: account loss limit and position size, or unavailable when account inputs are missing
executionGate: blocked / simulation-only, with missing inputs
nextCheck: what data or event should be checked next
```

Do not invent `invalidation` or `riskBudget`. When domain outputs do not support them, mark them missing and keep the plan non-executable.

`low-compression` is always a `等待` gate even when a forward structural target can be
computed. A target coordinate does not prove that drawdown repair has started.

## Retail Default View

The compact answer or main workbench should answer only:

1. Is the data usable?
2. What is the gated state?
3. Why is it in that state?
4. What would invalidate the thesis or force a review?
5. What must be checked next?

Formula details, sensitivity curves, source evidence, and alternative assumptions belong in an advanced research layer.

## Thesis Discipline

- A deviation observation is not itself a mean-reversion thesis.
- A mean-reversion thesis requires positive monotonic decay evidence, a declared sample, and a target derived without future data.
- A cost-anchor or structural-repair thesis must include the adverse case where the anchor continues to fall.
- A high synthetic CK geometry score is supporting shape evidence only. It cannot supply a price target or a fee thesis.
- `orderPlan.signalStrength` is normal-reference extremeness. It is not confidence, win probability, or calibrated edge and cannot justify live position size.
- `expectedSessions` and `expectedReturn*` are conditional zero-shock AR-path projections. Treat them as sensitivity coordinates, not expected realized outcomes; no fixed 21-session monthly conversion is emitted.
- Missing fundamentals, corporate actions, sector context, news, and calendar effects are counter-evidence gaps, not neutral facts.

## Risk and Position Sizing

Position sizing is unavailable unless the workflow has at least:

- account equity and available cash
- maximum loss per position and portfolio loss budget
- market lot size, T+1/T+0 constraints, fees, taxes, and conservative slippage
- entry, stop/invalidation, and maximum holding rule
- current liquidity evidence appropriate to the instrument

If any are missing, show scenario returns only and do not output an order quantity. Even when the local workbench has account inputs, its profile-scaled notionals remain `simulation-only` until a separate execution workflow validates the full list.

For A-share T+1 research, a signal after close enters no earlier than the next session. A same-bar target/stop ambiguity in daily OHLC replay uses the conservative policy declared by the replay contract; it is not evidence of actual intraday fill order.

## Replay Interpretation

- Freeze the rule and thresholds before evaluating the holdout period.
- Report sample size, coverage period, skipped signals, fees, fill timing, stop/target ambiguity policy, and point-in-time limitations.
- Average return and win rate are insufficient. Include median, downside quantile, worst result, and profile-level counts.
- A replay on the same data used to design thresholds is an in-sample diagnostic, not validated expectancy.
- Static current whitelists, names, or classifications applied to history introduce lookahead and must be disclosed.

## Language

Use: `观察`, `等待`, `剔除`, `需刷新数据`, `研究坐标`, `情景`, `门禁`, `缺失输入`.

Avoid: `必涨`, `确定反转`, `抄底`, `买点`, `卖点`, `回归概率`, `机构托底`, `做市商囤货`, `稳赚手续费`, or unqualified `预期收益` / `月化收益`.

When historical or scenario returns are shown, prefix them with `历史回放` or `条件情景`, and state the horizon and assumptions.
