---
name: china-stock-selection
description: Use this skill for beginner-friendly Market Lab research on mainland China and Hong Kong stocks, including A-share or HK watchlist screening, dynamic holding-state analysis, T+1 short-hold formula replay, local CSV coverage checks, source-labelled candidate reports, and interpretation of the CK, LP, AMM, option, Greek, volatility, fee, funding, carry, or portfolio fields exposed by those workflows. Trigger when the user asks to choose, screen, rank, replay, backtest, plan around, or explain China-market candidates in this repository.
---

# China Stock Selection

Build a source-labeled research watchlist from Market Lab's local China-market data. Results are observation candidates, not financial advice or direct buy/sell instructions.

The retail value of this skill is decision discipline: make data quality, assumptions, counter-evidence, invalidation, and execution blockers visible. It must not turn mathematical sophistication into false confidence.

## Required Reading Routes

- For every screen, ranking, explanation, holding-state, or plan request, read `references/retail-decision-contract.md` before producing conclusions.
- Before invoking either CLI or interpreting its output, read `references/cli-contract.md`.
- Before consuming or explaining CK, LP, AMM, options, Greeks, volatility, fee, funding, carry, or portfolio fields, also read `references/formula-risk-contract.md`.
- `references/stock-names.json` is only a local display-name aid. It is not a current market-identity source.
- Read the references from this canonical `.agents/skills/china-stock-selection` directory even when invoked through a generic or Claude wrapper.

## Canonical Runtime

- Canonical implementation: `.agents/skills/china-stock-selection`
- Claude wrapper: `.claude/skills/china-stock-selection`
- Generic-agent wrapper: `skills/china-stock-selection`
- Keep executable logic in the canonical `scripts/` directory. Mirror runtimes must delegate to it instead of maintaining divergent copies.

## Non-negotiable Rules

- Read from `src/data/stock-index.json`, `public/data/*.csv`, and the documented data pipeline.
- Report market, source, last data date, row count, and freshness. Do not invent missing prices, fundamentals, sectors, news, or calendar facts.
- Use `观察`, `等待`, `剔除`, or `需刷新数据`; never imply guaranteed returns.
- Do not use RSI, KDJ, EMA, or MA in screening, scoring, entry, exit, holding state, or explanations. If supplied externally, mark them ignored.
- The recommended-pool query accepts only `DIMENSION_LIBRARY` ids and rebinds every id to its canonical `score`, `requires`, `label`, and `optional` definition; callers may override only `enabled` and `weight`. It also strips `rsi`/`j`, rejects duplicate ids, and the generator does not compute or emit those indicators. Aliases and caller-supplied scorer functions are not permitted extension paths.
- Keep formulas in domain modules and orchestration in scripts/stores. Do not duplicate hidden business formulas in UI components.
- Treat backtests as historical replay with stated assumptions. Never describe replay output as live tradability or future expectancy.
- Preserve the distinction between raw diagnostic score, domain holding state, order-plan gate, and executable status. A high score cannot override a blocked domain gate.
- If account size, loss budget, liquidity, settlement, or transaction-cost inputs are absent, position sizing and executable orders remain unavailable.
- Keep `dataState`, `scoreStatus`, `candidateStatus`, and `executionStatus` separate. This static research skill never emits an executable order.
- Classify every nontrivial claim as `exact-identity`, `sample-estimate`, `calibrated-estimate`, `scenario-proxy`, or `missing-input` according to `references/formula-risk-contract.md`.

## End-to-end Workflow

1. Inspect repository state and data coverage. Do not mix unrelated working-tree changes into a skill change or report.
2. Run `pnpm run check:data` and `pnpm run check:generated-data` before a dated conclusion.
3. Run the screen in JSON mode when a downstream plan or explanation is needed; Markdown is only the compact human view.
4. Keep `scoreStatus` separate from the gated `candidateStatus`. Consume `dynamicHolding`, `orderPlan.blockedReasons`, and every `missingInputs` union before using the word `观察`.
5. Use replay only to test a predeclared rule under disclosed fill assumptions. Do not tune thresholds on the same period and then present the result as validation.
6. Produce the minimum backing decision record defined in `references/retail-decision-contract.md`, including claim classes; unresolved fields stay explicit. The five-question retail view is only its compact projection.

```bash
git status --short
pnpm run check:data
pnpm run check:generated-data
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股,港股 --top 20 --format json
```

## Market Scope

`--market` accepts `A股`, `港股`, or a comma-separated combination.

## Identity and Provenance

Every candidate must retain:

- `symbol`, `market`, `source`, `dataThrough`, `rows`, and `staleDays`
- `name` and `nameSource`
- active market/filter configuration
- `dataState`, `scoreStatus`, `candidateStatus`, `executionStatus`, and the reasons for every non-ready state

If `nameSource=local-name-overrides`, describe it as a local convenience label. If `nameSource=unresolved-local-index`, keep the symbol and do not guess the company name. Current company identity, corporate actions, fundamentals, sectors, and news require a dated external source when the user asks for them.

## Screening

Run the canonical screen:

```bash
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股,港股 --top 20
```

Useful variants:

```bash
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股 --top 30
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market 港股 --top 15 --format json
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market 港股 --top 15 --format json --option-tenor-sessions 30 # explicit option-expiry scenario
node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股 --min-rows 240 # explicit sample-gate scenario
```

### Score Contract

The total is 100 points:

- Cost structure: 30
- Synthetic CK geometry: 35
- Deviation extremeness: 25
- Data completeness: 10

Do not add `regressionProb` or `netLpEfficiency` to this score. Neither is a validated probability or return measure.

The score is diagnostic only. It cannot upgrade a candidate when the domain dynamic-holding state is not `观察` or the order-plan query remains blocked; expose the raw score state separately from the gated candidate state.

Any Black-Scholes/Asian/Bachelier fields in the screen use historical realized volatility as scenario sigma. Label `volatilitySource=historical-realized-scenario` and `isMarketIv=false`. Their `timeToExpirySessions` is independent of the stock-repair `formulaHorizonSessions`: it exists only when the caller explicitly supplies `--option-tenor-sessions`. Without that flag, the option layer is `missing-input`, all Greeks and Gamma scenario values remain `null`, and the stock-repair horizon must never be substituted. Without option-chain quotes, bid/ask, contract multiplier and settlement rules, an explicitly tenored result is still not an executable option or market-making output.

### Screen Output Contract

The compact view contains `symbol`, `name`, `market`, `dataThrough`, gated `status`, `score`, cost state, synthetic CK geometry, and deviation extremeness.

The JSON view is the authoritative machine contract. Preserve at least:

- top-level data/filter provenance and `syntheticCkGeometry` disclosure
- machine-readable `stateContract`, complete `claimClassContract.allowedValues`, and
  emitted-claim map `claimClasses`
- `dataState`/`dataStateReasons`, both `scoreStatus` and gated
  `candidateStatus`/legacy `status`, `executionStatus`, and their reasons
- `cost`, `deviation`, `meanReversion`, `dynamicHolding`, and `orderPlan`
- `deltaBands`, option scenario, Gamma scenario, volatility confidence, and their input modes
- synthetic CK geometry, fingerprint, AMM geometry, and LP research attribution
- explicit `funding.hasFunding=false` / `netCarry=null` when the market has no corresponding data

Do not silently omit a model layer because its inputs are missing. Return `null`, `missingInputs`, `research-only`, `proxy-only`, or `calibration-required` as appropriate.

### Deviation Extremeness

`deviationScore()` exposes a normal-reference percentile and two-sided tail:

```text
deviationPercentile = 2 * Phi(abs(z)) - 1
twoSidedTailProbability = 2 * (1 - Phi(abs(z)))
```

The score uses the two-sided normal-reference tail together with negative z depth. `probabilitySemantics` must remain `normal-reference-extremeness-not-mean-reversion-probability`.

For a current cost-distance observation `x` and valid historical sample `x_i`:

```text
percentilePct = count(x_i <= x) / n * 100
lowerTailPct  = count(x_i <= x) / n * 100
upperTailPct  = count(x_i >= x) / n * 100
twoSidedTailPct = min(1, 2 * min(lowerTail, upperTail)) * 100
```

Both families describe extremeness. Neither is a probability that price will revert, rise, or hit a target. A low tail only says the standardized or historical observation was unusual under its stated reference.

### Synthetic CK Geometry

The CK/Uniswap-v3 calculation uses a normalized synthetic setup:

- `liquidity = 1`
- range is symmetric around the rolling cost anchor
- range width is derived from ATR and bounded by the script
- normalization divides the unit-liquidity value by the same synthetic range valued at its rolling cost anchor
- the historical percentile ranks this dimensionless synthetic ratio

It is only a geometry diagnostic. It is not:

- a real LP position or token inventory
- a stock accumulation amount
- fee income, PnL, carry, or investment return
- a price or mean-reversion probability

Capital-efficiency and relative-IL fields are shape diagnostics under the synthetic inputs. Pass them through `lpResearchAttribution()` so dimensional semantics remain explicit. With no path-calibrated fees and common horizon, its status must remain `calibration-required` and `returns.netReturn` must remain `null`. Do not call these fields realized or expected returns. The geometry may contribute to screening diagnostics, but it must not be turned into a fabricated LP upper-price target.

The screen's constant-product proxy must call `fullRangeV2ImpermanentLoss()` and pass
`lpIlFraction`, `ilModel`, `capitalBasis`, and `horizonSessions` into
`lpResearchAttribution()`. It must not call the deprecated generic IL wrapper. Because
path fees and a common horizon are absent, attribution remains `calibration-required`,
`researchBoundary=research-only`, and non-executable.

CK's exact symmetric capital-efficiency frontier and its valuation-basis caveat are specified in `references/formula-risk-contract.md`. The exact `±84.13%` result may be explained as a theorem under its own objective, but never installed as a default stock range, probability band, fee optimum, or PnL optimum. Do not combine its geometric-midpoint efficiency with the screen's current-versus-anchor normalized synthetic value; they use different valuation bases.

### Dynamic Holding Targets

Dynamic target generation consumes cost-band structure only:

- `costLower`
- `anchor`

The output must state `targetInputMode=cost-band-and-anchor-only` and `syntheticCkGeometryUsedAsTarget=false`. Synthetic CK range bounds are never target prices.

Holding time is not a `5/10/30/60/90` bucket. For a valid structural target strictly
between the event start and its frozen cost anchor, derive its location and horizon:

```text
q = (targetPrice - cycleStartPrice) / (costAnchor - cycleStartPrice)
H = halfLifeSessions * log2(1 / (1 - q))
q(H) = 1 - 2^(-H / halfLifeSessions)
modelHorizonSessions = ceil(H)
```

For the replay's default structure mode, `targetPrice=costLower`. At signal close this is
only a provisional coordinate. After the next-session open is observed, recompute `q`
and `H` from that actual entry; the recomputed horizon controls the exit boundary,
required trailing sample, and per-instrument non-overlap. Never substitute `q=0.875`.
An explicitly chosen `H=3*halfLifeSessions` does imply the exact identity
`q=1-2^-3=0.875`; this is a conditional time coordinate, not an instrument-calibrated
target and not the CK skew frontier's `alpha=0` solution.
The anchor has `q=1` and an asymptotic horizon, so it is not silently converted into a
finite target.

Sample length is dynamic too. Without `--min-rows`, each instrument emits an adaptive
window specification derived only from `tradingDaysPerYear` and the rows visible at
that observation. CK geometry rank, empirical deviation, mean-reversion fitting, and
the first replay-eligible prefix consume that specification; they do not use global
`180/242/260/360/726` row windows. An explicit `--min-rows` is a user-declared sample
gate scenario and is labeled `mode=explicit-scenario`, `source=cli:--min-rows`.

Any `expectedSessions` or `expectedReturn*` field is a conditional zero-shock AR-path
projection under the frozen sample state. It is not a forecast, expected realized
return, promised holding period, or position-sizing input. New skill output uses
`arCoefficient`, `halfLifeSessions`, `*HorizonSessions`, and `actualHoldSessions`;
legacy `*Days` formula aliases are not serialized.

### Options, LP, and Market-making Escalation

The stock screen exposes some option/LP fields to teach and compare risk geometry. They do not make this skill an executable option or AMM trader.

- Historical realized volatility is a scenario sigma, not market IV.
- Option expiry is an independent contract/scenario input. Never reuse the stock
  repair horizon or AR half-life as `timeToExpirySessions`; omit
  `--option-tenor-sessions` to preserve an honest `missing-input` result.
- A blank premium remains missing; explicit zero is a distinct input.
- Capital efficiency is a leverage/geometry multiple, not a return.
- Liquidity fingerprint mass is a model allocation weight, not a price probability.
- Pool fee tier is not fee income. Fee return needs a volume/liquidity-share/in-range/cost path.
- `fee ≈ theta` is an analogy only after currency, notional, sign, and horizon are aligned.
- Portfolio PnL must use entry cashflows and mark values on one ledger. Scenario totals stay separate from formal totals with missing inputs.
- `orderPlan.signalStrength` is normal-reference extremeness, not confidence, win probability, or calibrated edge. Any nominal amount derived from it remains `simulation-only`.

If a user requests an executable option, LP, hedge, or market-making plan, apply the promotion checklist in `references/formula-risk-contract.md`. Until every required input is present, report the missing inputs and remain `research-only` or `calibration-required`.

## T+1 Short-hold Replay

Run replay or a latest-observation scan:

```bash
node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs --fee 0
node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs --profile swing --fee 0.0011
node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs --profile combo --fee 0.0011
node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs --profile combo --mode latest --fee 0
node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs --market 港股 --mode latest --fee 0
```

Profiles are `strict`, `swing`, and `combo`, but these names select threshold sets rather
than fixed holding buckets. Resolved profile names are `strict-structure` and
`swing-structure`; fixed mode uses `strict-fixed-scenario` or `swing-fixed-scenario`.
`--target-mode structure` is the default and has no `max-hold`
fallback. `--target-mode fixed` is an explicit paired target/horizon scenario; it requires
both explicit `--target` and `--max-hold`, emits `fixedHorizonApplied=true` and
`executionAuthority=none`, and cannot bypass dynamic-holding or phase gates.
`low-compression` remains `等待` in both modes.

`--fee` has no hidden default and is required in replay and latest mode. Pass
`--fee 0` explicitly when the intended scenario has no aggregate fee drag. Explicit
zero and missing input are different states.

Profile return fields are deliberately disjoint. Structure mode exposes and consumes
only `minimumGrossReturn`; fixed mode exposes and consumes only the explicitly supplied
`fixedTargetReturn`. The absent field is `null`, so a structural threshold cannot be
mistaken for a fixed target and a fixed scenario cannot leak into structural mode.

All defaults, units, profile precedence, output fields, and fill limitations live in `references/cli-contract.md`; do not infer them from flag names.

Relevant overrides include:

```bash
--min-z 2
--ck-geometry-max 3
--max-hl 12
--min-distance 10
--max-distance 16
--min-slope -1
--max-slope 1
--fee 0.0011
```

An explicit fixed scenario must say so in the command:

```bash
node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs --target-mode fixed --target 0.03 --max-hold 10 --fee 0.0011
```

`--lp-max` remains a compatibility alias for `--ck-geometry-max`; new calls and reports must use the CK-geometry name.

Replay signal output includes:

- z score and half-life diagnostics
- normal-reference deviation percentile/two-sided tail with `probabilitySemantics`
- empirical deviation percentile, lower/upper tail, two-sided tail, and sample size
- synthetic CK geometry percentile and model label
- cost distance/slope
- cost/anchor-only dynamic holding state
- entry/exit assumptions and fee-adjusted historical result in replay mode
- market source and name-source provenance

Replay safety rules:

- only positive `arCoefficient` with `decayMode=monotonic-decay` may use the half-life target model; negative-coefficient oscillation and non-stationary estimates are ineligible
- the signal is observed at close and entry occurs at the next session open; use the signal-day frozen cost structure and statistical state to rebase target return and eligibility at that open
- in structure mode, recompute actual-entry `q` and `modelHorizonSessions`; use that same event horizon for tail sufficiency, no-hit exit, and non-overlap
- historical row state is reconstructed from `rows[0..signalIndex]`: `dataThrough`, row count, freshness, and `candidateStatus` cannot consume the dataset's later rows
- A-share `settlementLagSessions=1` is a T+1 market rule, not a modeled minimum holding period
- if both stop and target lie inside the same OHLC bar, resolve the ambiguous path as stop-first and disclose `intrabarPolicy=stop-first-conservative-when-both-hit`

All deviation fields remain extremeness diagnostics, not a reversion probability. The CK percentile remains synthetic geometry, not a real LP metric.

### P0 Evidence Gates

Replay emits survivorship, reproducibility, sample-statistics, benchmark, and walk-forward
blocks. They are the minimum honesty layer, not new signal:

- `survivorshipBias` always reports `universe-is-current-membership-only`; an absolute return level is an upper bound, not an estimate.
- `statistics.sampleWarning` marks `n<30` as not statistically meaningful and reports `no-sample` when the thresholds produced no trade.
- `benchmarks` compares the rule with same-universe buy-and-hold and seeded random entry under the same fee drag.
- `walkForward` splits the shared session calendar into train and test folds; `consistency` is the share of trading folds with a positive out-of-sample average. It measures stability, not a refitted edge.
- `reproducibility` carries `configHash`, `dataHash`, `nodeVersion`, and `gitCommit`. `--hypothesis <file.json>` records a pre-registered rule and `--run-log <file.jsonl>` raises `multipleComparisonsWarning` when several configurations are logged against one dataset.
- `--holding-gate diagnostic` is the default: it keeps a candidate whose domain holding phase is not `execute` and records the verdict instead of discarding it. Report every such trade as an override with `holdingGateEnforced=false`, never as a clean observation; `--holding-gate enforce` restores the hard gate.
- `equityCurve`, `riskMetrics`, and `signalDecay` are always emitted in replay mode and stay `null` in latest mode. `riskMetrics` is a trade-sequence research curve (`simulationOnly`), never a portfolio NAV.
- `--sensitivity thresholds` re-runs the same command once per perturbed threshold and reports `stabilityScore`. Read it only when `stabilityScoreInterpretable` is true, and never present a variant count as evidence on its own.
- Execution reality is declared, never assumed: `--slippage-bps` or `--slippage-atr-fraction`, `--min-avg-volume`/`--min-avg-turnover`, and `--volume-cap` with `--order-notional`. `executionAudit` must reconcile `signals` with `accepted` plus every block reason, and a `none-declared` slippage model must be reported as an undeclared assumption.

```bash
node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs --profile strict --fee 0.0011 --validate walk-forward --min-folds 3 --hypothesis ./hypotheses/z2-hl12.json --format json
```

## Data Validation

Before using output for a dated request:

```bash
pnpm run check:data
pnpm run check:generated-data
pnpm run check:skill-runtime
```

Refresh only through the project's existing pipeline. Preserve local source labels and disclose when the available CSV ends before the requested date.

For code changes, validate in proportion to scope:

```bash
pnpm test
pnpm run audit:formulas
pnpm run build
```

## Output Checklist

Every report should include:

1. Market and requested universe.
2. Data source, data-through date, row count, and freshness.
3. Candidate state and concise reason.
4. Normal-reference and empirical deviation percentile/two-sided tail with the non-probability disclaimer.
5. Synthetic CK geometry label with the non-position/non-return disclaimer.
6. Cost/anchor-only target provenance.
7. Replay assumptions and risks when historical simulation is used.
8. Supporting evidence, counter-evidence, invalidation condition, and unresolved inputs when the user asks for a plan.
9. Explicit execution status; without account/risk/liquidity inputs it cannot be `executable`.

The retail default view should answer five questions: is the data usable, what is the gated state, why, what would invalidate the thesis, and what must be checked next. Keep formulas and evidence available in the research layer, not as a wall of equations in the main workbench.

Keep the report compact and decision-oriented. Longer research notes belong outside the Market Lab workbench.
