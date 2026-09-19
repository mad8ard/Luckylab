# China Stock Selection CLI Contract

This reference records the current command-line behavior of the canonical runtime in
`.agents/skills/china-stock-selection/scripts/`. Read it before running, overriding, or
interpreting the screen or replay. The CLI is a research runtime, not an order router.

The executable scripts remain the source of truth. When their defaults, units, fields,
or fill rules change, update this contract and `scripts/check-china-stock-skill-runtime.mjs`
in the same change.

## Shared Invocation Rules

- Canonical screen: `node .agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs`
- Canonical replay: `node .agents/skills/china-stock-selection/scripts/replay-short-hold.mjs --fee 0`
- Generic and Claude runtimes must delegate to these canonical scripts.
- Flags use `--key value`. A flag without a following value becomes boolean `true`.
  Declared boolean options reject values other than `true` or `false`; declared enum
  options reject unknown values.
- Unknown flag names, positional arguments, and missing values for non-boolean flags
  fail. This prevents a typo or incomplete override from looking applied.
- Paths are resolved from the repository root, not the caller's current directory.
- Only local index and CSV inputs are read. Neither CLI fetches current quotes, company
  identity, fundamentals, sectors, news, calendars, option chains, or account state.
- Percent-like inputs are not uniform: the tables below distinguish decimal return
  fractions from percentage-point thresholds.

## Screen CLI

### Screen options

| Flag                      |                     Default | Unit / accepted value                     | Runtime meaning                                                                                                                                      |
| ------------------------- | --------------------------: | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--market`                |                  `A股,港股` | comma-separated exact market labels       | Includes entries whose `market` is in the requested set.                                                                                             |
| `--top`                   |                        `20` | positive integer count                    | Final candidate gate is ordered first (`观察`, `等待`, `剔除`, `需刷新数据`), then diagnostic score within each state. Invalid supplied values fail. |
| `--min-rows`              |                    adaptive | OHLCV row count                           | Optional explicit sample-gate scenario. Without it, the per-instrument gate is `ceil(sqrt(tradingDaysPerYear))`; output labels mode and source.      |
| `--option-tenor-sessions` |                     missing | positive integer sessions                 | Optional explicit option-expiry scenario. It never defaults to or consumes `formulaHorizonSessions`; missing keeps option/Greek outputs missing.     |
| `--format`                |                  `markdown` | `markdown` or `json`                      | Unknown values fail instead of silently changing the output contract.                                                                                |
| `--index`                 | `src/data/stock-index.json` | repository-relative or absolute path      | Instrument index and its local source labels.                                                                                                        |
| `--data-dir`              |               `public/data` | repository-relative or absolute directory | Directory containing the CSV named by each index entry.                                                                                              |
| `--name-map`              |      local reference lookup | repository-relative or absolute JSON path | Optional display-name map; it is not current identity evidence.                                                                                      |

The screen has no fee, slippage, account, position-size, or order-quantity input.

### Screen JSON contract

Top-level fields are:

- `schemaVersion=china-stock-selection.screen.v3`, `generatedAt`, `markets`, `top`,
  top-level `rowGate`, and `optionScenario`
- `provenance` with canonical runtime, local data model, index, data directory, and
  name-map inputs
- complete `filters` with the resolved markets
- aggregate `freshness` and `audit`, including considered/data-ready/emitted/skipped
  counts and `skipReasons`
- the row-level `adaptiveWindowSpec` and `rowGate`; default windows use only the
  instrument's `tradingDaysPerYear` and currently visible prefix, while an explicit
  `--min-rows` is labeled `mode=explicit-scenario`, `source=cli:--min-rows`
- `stateContract`, `claimClassContract.allowedValues`, and `claimClasses`. The
  contract field exposes the complete five-value enum; `claimClasses` maps only
  claims actually emitted by this runtime
- `syntheticCkGeometry` disclosure
- `researchBoundary` with `status=research-only` and `executionStatus=blocked`
- `ranked` candidates and reason-coded `skipped` records

Each ranked candidate preserves at least:

- identity/provenance: `symbol`, `label`, `name`, `nameSource`, `market`, `source`
- data coverage: `dataThrough`, `rows`, `staleDays`
- decision separation: `dataState`/`dataStateReasons`, diagnostic `score` and
  `scoreStatus`, gated `candidateStatus` plus compatibility alias `status`,
  `statusReasons`, `executionStatus`, and `executionReasons`
- row-level `claimClasses` using only the enum from `formula-risk-contract.md`
- row-level `freshness` and `provenance`
- compact diagnostics: `costNote`, `ckGeometryNote`, `zNote`,
  `avgAmountRecent`, and `avgAmountWindowRows`
- structured `formula` with `tdpy`, `cost`, `deviation`, `deltaBands`, `options`,
  `gammaConvexity`, `syntheticCkGeometry`, `fingerprint`, `amm`, `funding`,
  `netCarry`, `volConfidence`, `meanReversion`, `dynamicHolding`, `vixFix`, and
  `orderPlan`

Formula horizons use `formulaHorizonSessions`, mean reversion uses
`arCoefficient`/`halfLifeSessions`, and dynamic formula payloads serialize only
canonical `*Sessions` fields. `staleDays` remains a calendar-age provenance field and
is not a formula horizon.

Important field semantics:

- `dataState` alone carries freshness and provenance readiness. `scoreStatus` is only
  `diagnostic-high`, `diagnostic-medium`, or `diagnostic-low`; it never carries stale
  state. `candidateStatus` is the final gate after dynamic-holding and
  `orderPlan.blockedReasons`; score cannot override a blocked gate.
  The emitted top set is ordered by this final gate before raw score.
- Valid, current local OHLCV remains `dataState=provisional` in this bundled candidate
  record because corporate actions, exchange state, point-in-time identity, and live
  execution inputs are not all verified. `ready` is reserved by the enum for a future
  input path that verifies the declared claim scope; it is not emitted by the current
  local-only CLIs.
- `options.volatilitySource=historical-realized-scenario` and `isMarketIv=false`.
  `options.missingInputs` keeps market option data explicit. `timeToExpirySessions`
  comes only from `--option-tenor-sessions`; without it, `options.status` and
  `claimClass` are `missing-input`, all option/Greek values are `null`, and
  `options.missingInputs` includes `explicit-option-tenor-sessions`, while
  `gammaConvexity=null`. The independently derived stock-repair
  `formulaHorizonSessions` still drives GetDelta and is never an option-tenor fallback.
- `funding.hasFunding=false` and `netCarry=null` are deliberate for unsupported A/H
  stock funding data.
- `syntheticCkGeometry`, `fingerprint`, AMM, option, and Gamma values are research
  geometry/scenarios, not positions, quoted prices, probabilities, or executable PnL.
- `syntheticCkGeometry.capitalEfficiencyMultiple` uses the declared
  `capitalEfficiencyValuationBasis=range-geometric-midpoint`; when the arithmetic
  reference is treated as current price, consume the separately reported
  `capitalEfficiencyAtArithmeticCenterMultiple`. Neither shares the normalized
  current-versus-anchor synthetic-geometry basis.
- `syntheticCkGeometry.fullRangeV2IlProxyPct` is a constant-product v2 proxy based on
  current price versus cost anchor. It does not consume the synthetic v3 range bounds
  and must never be described as that range's v3 IL.
- The proxy is produced by `fullRangeV2ImpermanentLoss()`. Its attribution call uses
  `lpIlFraction`, `ilModel`, `capitalBasis`, and `horizonSessions`; absent path fees and
  a common horizon keep `status=calibration-required`, `returns.netReturn=null`, and
  `researchBoundary=research-only`.
- Candidate `candidateStatus`/legacy `status` is one of `需刷新数据`, `剔除`, `等待`, or `观察`;
  `executionStatus` remains `blocked`, so none means an order.

Residual provenance limitation: the JSON records input paths, coverage end, row count,
freshness, filters, and skip reasons, but not the exact command string, per-file digest,
or coverage start. Preserve those separately when a byte-for-byte audit is required.

## Replay and Latest-scan CLI

### Global replay options

| Flag               |                     Default | Unit / accepted value                         | Runtime meaning                                                                                                          |
| ------------------ | --------------------------: | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `--profile`        |                    `strict` | `strict`, `swing`, `combo`                    | Unknown values fail. Combo evaluates strict first, then swing.                                                           |
| `--mode`           |                    `replay` | `replay`, `latest`                            | Unknown values fail. Latest emits current eligible observations without simulated exits.                                 |
| `--market`         |                       `A股` | `A股`, `港股`, or comma-separated combination | Unknown market labels fail; `config.markets` preserves the resolved set.                                                 |
| `--fee`            |                    required | decimal return fraction                       | Must be explicit, including zero. Replay uses `netReturn = grossReturn - feeRate`; latest records but does not apply it. |
| `--min-rows`       |                    adaptive | OHLCV row count                               | Optional explicit sample-gate scenario; default gate is derived per instrument and prefix.                               |
| `--format`         |                  `markdown` | `markdown` or `json`                          | Unknown values fail.                                                                                                     |
| `--index`          | `src/data/stock-index.json` | repository-relative or absolute path          | Instrument index.                                                                                                        |
| `--data-dir`       |               `public/data` | repository-relative or absolute directory     | OHLCV CSV directory.                                                                                                     |
| `--name-map`       |      local reference lookup | repository-relative or absolute JSON path     | Optional display-name map and its source label.                                                                          |
| `--validate`             |                       `none` | `none` or `walk-forward`   | Unknown values fail; walk-forward requires `--mode replay`.            |
| `--hypothesis`           |                       none | JSON file path             | Pre-registered rule declaration; an unreadable path fails before the scan. |
| `--run-log`              |                       none | JSONL file path            | Appends the run hash and raises `multipleComparisonsWarning`.          |
| `--seed`                 |                   `20260101` | integer                    | Seeds bootstrap resampling and random-entry draws.                     |
| `--bootstrap-samples`    |                      `2000` | positive integer           | Resamples behind `bootstrapCI95Pct`.                                  |
| `--random-entry-samples` |                       `200` | positive integer           | Random entries drawn per instrument for the null benchmark.            |
| `--train-sessions`       |                       `400` | positive integer           | In-sample window of each walk-forward fold.                           |
| `--test-sessions`        |                        `60` | positive integer           | Out-of-sample window of each walk-forward fold.                       |
| `--step-sessions`        |                        `60` | positive integer           | Calendar advance between consecutive folds.                           |
| `--min-folds`            |                         `3` | positive integer           | Minimum fold count; shortfalls are reported, never satisfied silently. |
| `--holding-gate`         |                `diagnostic` | `enforce` or `diagnostic`  | `diagnostic` keeps a candidate the domain holding plan does not mark `execute` and records the verdict; `enforce` discards it. |

### Profiles, structural horizon, and override units

`strict` and `swing` are threshold profiles, not 5-day or 10-day holding buckets. Their
resolved names are `strict-structure` and `swing-structure`. `combo` evaluates strict
first and then swing, but neither profile supplies a default holding period.
Explicit fixed mode instead resolves to `strict-fixed-scenario` or
`swing-fixed-scenario`, so a scenario cannot masquerade as a structural profile.

| Override            | Strict structure | Swing structure | Unit and rule                                                                      |
| ------------------- | ---------------: | --------------: | ---------------------------------------------------------------------------------- |
| `--target`          |           `0.03` |          `0.04` | `minimumGrossReturn` in structure mode; required `fixedTargetReturn` in fixed mode |
| `--stop`            |          `0.015` |         `0.015` | decimal loss fraction: 1.5%                                                        |
| `--min-z`           |              `2` |           `2.5` | negative z threshold evaluated on the event-derived horizon                        |
| `--ck-geometry-max` |              `3` |             `5` | synthetic CK geometry percentile points, not a probability                         |
| `--lp-max`          |            alias |           alias | compatibility alias for `--ck-geometry-max`; do not use in new reports             |
| `--max-hl`          |             `12` |            `20` | sample half-life eligibility gate; not the holding horizon                         |
| `--min-slope`       |             `-1` |            `-1` | cost-slope percentage points                                                       |
| `--max-slope`       |              `1` |           `0.5` | cost-slope percentage points                                                       |
| `--min-distance`    |             `10` |            `12` | absolute percentage points below the cost anchor                                   |
| `--max-distance`    |             `16` |            `22` | absolute percentage points below the cost anchor                                   |
| `--max-entry-gap`   |            `0.5` |           `0.5` | next-open gap percentage points versus signal close                                |
| `--min-entry-gap`   |             `-3` |            `-3` | next-open gap percentage points versus signal close                                |
| `--target-mode`     |      `structure` |     `structure` | `structure` or explicit alternate `fixed`; unknown values fail                     |
| `--max-hold`        |             none |            none | required only with `--target-mode fixed`; explicit scenario horizon                |

Structure mode derives, for every signal or entered event:

```text
q = (costLower - cycleStartPrice) / (costAnchor - cycleStartPrice)
H_raw = halfLifeSessions * log2(1 / (1 - q))
modelHorizonSessions = ceil(H_raw)
```

The target must be strictly between cycle start and the frozen anchor, so `0 < q < 1`.
There is no `0.875` fallback and the anchor itself (`q=1`) is asymptotic, not a finite
target. At signal close the runtime exposes a provisional structural `q/H`. Historical
replay recomputes both from the actual next-session open before it accepts the trade.
Latest mode reports `modelHorizonStatus=awaiting-next-session-open` rather than pretending
that the future open is known.

For interpretation only, the inverse identity is
`q(H)=1-2^(-H/halfLifeSessions)`: an explicitly chosen three-half-life coordinate gives
`q=7/8=0.875`. This is not a runtime fallback, a calibrated target, or the CK skew
frontier's `alpha=0` result (`0.8704`).

Fixed target and fixed horizon are an explicit paired scenario only:

```bash
--target-mode fixed --target 0.03 --max-hold 10
```

Omitting either `--target` or `--max-hold` in fixed mode fails. Supplying `--max-hold`
in structure mode also fails. Every fixed-mode config and row emits `fixedHorizonApplied=true` and
`executionAuthority=none`; it cannot become a default or an execution instruction.
Profile output never uses one ambiguous return field: structure mode has a finite
`minimumGrossReturn` and `fixedTargetReturn=null`; fixed mode has
`minimumGrossReturn=null` and the explicit finite `fixedTargetReturn`. Signal rows use
`profileMinimumGrossReturnPct`, `profileFixedTargetReturnPct`, and
`signalTargetGrossReturnPct` so thresholds, scenarios, and derived targets stay distinct.

Supplied numeric overrides are strict: non-finite or out-of-domain values fail rather
than falling back. `fee` is required and in `[0,1)`; missing fee is an error while
explicit `--fee 0` is valid. `target` and `stop` are in `(0,1)`; `min-z` is
non-negative; the CK geometry threshold is in `[0,100]`; maximum half-life is positive;
distance bounds are non-negative; and a fixed-scenario horizon is a positive integer.
Minimum slope, distance, and entry-gap bounds must not exceed their maximums. Screen
`top` and any explicitly supplied screen/replay `min-rows` are also strict positive
integers.

### Replay sample and non-overlap rules

- There is no global default row count or fixed historical start index. At each
  observation the runtime derives an `adaptiveWindowSpec` from only
  `tradingDaysPerYear` and `visibleRows`; it emits
  `mode=adaptive-tdpy-visible-prefix`, `causal=true`, and `futureRowsUsed=false`:

  ```text
  minimumRequiredRows = max(3, ceil(sqrt(tradingDaysPerYear)))
  analysisWindowRows  = min(visibleRows,
                            max(minimumRequiredRows,
                                ceil(sqrt(tradingDaysPerYear * visibleRows))))
  scenarioHorizonSessions = ceil(sqrt(visibleRows))
  ```

- CK geometry rank, empirical deviation, and mean-reversion fitting consume the
  declared `analysisWindowRows`. Each replay prefix derives its own value; appended
  future rows cannot alter an earlier observation.
- Without `--min-rows`, file and replay-prefix readiness use
  `minimumRequiredRows`. An explicit `--min-rows` replaces only that readiness gate,
  is labeled `mode=explicit-scenario`, `source=cli:--min-rows`, and does not turn the
  analytical windows into fixed global windows.
- Signals must have negative cost distance, positive monotonic mean reversion
  (`0 < arCoefficient < 1`, `isMeanReverting=true`, `decayMode=monotonic-decay`), and pass the
  selected profile gates.
- Accepted structure-mode trades do not overlap within an instrument. After a trade is
  accepted, `nextAllowedIndex = signalIndex + appliedHorizonSessions + 1`, where
  `appliedHorizonSessions=modelHorizonSessions`. This reserves the full event-derived horizon
  even if a stop or target is hit earlier. An explicit fixed scenario uses its declared
  fixed horizon instead.
- Non-overlap resets for each instrument. There is no portfolio-level capital or
  cross-symbol overlap constraint.
- Tail sufficiency is checked per event after the actual entry-open recomputation. A
  historical signal is not accepted unless the CSV contains the whole applied horizon.
  Latest mode evaluates only the final visible row after its declared adaptive or
  explicit-scenario row gate.

### Signal, entry, and exit timeline

The market-aware timeline is:

```text
T session close: observe signal
T+1 next session open: enter if the open-gap gate passes
T+2 earliest A-share session: first stop/target check because T+1 resale is unavailable
```

More exactly:

- `entryIndex = signalIndex + 1`; entry price is that row's `open`.
- The structural `costLower` target, its target-position recovery fraction `q`, and its
  formula horizon are recomputed against the actual entry open and retain
  `targetTiming=signal-context-frozen-target-recomputed-with-next-session-open` and
  `targetRecomputedAtEntry=true`.
- `targetContextPolicy=cost-band-half-life-and-drawdown-frozen-at-signal-close; deviation-rescaled-to-entry-derived-horizon`:
  the cost band, annual volatility, half-life, slope, and drawdown sample remain frozen
  at signal close. The entry open changes `q/H`, so the deviation coordinate is rescaled
  to that actual-entry horizon before replay eligibility is accepted.
- Structure-mode exit scanning ends at
  `entryIndex + modelHorizonSessions`; a no-hit exit fills that session's close with
  `reason=modelHorizon`. A-share checks begin one session after entry because of T+1.
  Hong Kong may check the entry session (same-day), with same-bar ambiguity still resolved stop-first.
- Stop is `entryPrice * (1 - stopLoss)`. Structure target is the frozen signal-context
  `costLower`; fixed mode uses `entryPrice * (1 + fixedTargetReturn)` and the explicitly supplied
  fixed horizon.
- Fixed mode still computes and enforces the same structural dynamic-holding and phase
  gates; `low-compression` remains `等待`, and replay trades require the short-plan action
  to be `execute`. It emits `fixedHorizonApplied=true` and `executionAuthority=none`.
- If stop and target both fall inside one daily OHLC bar, stop wins and output retains
  `intrabarPolicy=stop-first-conservative-when-both-hit` plus `intrabarBothHit=true`.
- Stop/target hits fill exactly at their boundary. A formula-horizon or explicit
  fixed-scenario-horizon exit fills at that day's close.

Both A-share and Hong Kong annualization currently use the market metadata value of
242 trading days per year. This is an annualization basis, not a sample-window length.
The A-share one-session resale lag is a settlement
rule (`settlementLagSessions=1`), never a minimum holding-period estimate.

### Fee and return semantics

`--fee` is required. There is no hidden default: `--fee 0` must be passed explicitly
when the scenario assumes no aggregate drag. In `replay` mode it is a single
dimensionless round-trip drag subtracted once from gross return:

```text
grossReturn = exitPrice / entryPrice - 1
netReturn   = grossReturn - feeRate
```

It is not a per-side rate, LP fee tier, broker tariff, or cash ledger. The replay does
not separately model commission minimums, stamp duty/tax, exchange and clearing fees,
transfer fees, bid/ask spread, slippage, market impact, FX, financing, or borrow cost.
Reports must call it an assumed aggregate fee drag, not actual transaction cost.
In `latest` mode there is no return simulation: `feeAppliedToReturns=false`,
`feeModel.appliedRate=null`, and the requested fee is retained only as provenance.

### Replay JSON contract

Top-level fields are:

- `schemaVersion=china-stock-selection.replay.v4` and `generatedAt`
- resolved `config`, including `profile`, `mode`, `market`, `feeRate`,
- `markets`, `feeAppliedToReturns`, `feeModel`, `rowGate`, `format`,
  `intrabarPolicy`, `targetTiming`, `targetContextPolicy`, resolved
  `profiles`, `horizonPolicy`, `fixedHorizonApplied`, `executionAuthority`,
  and `settlementPolicy`
- `provenance`, complete `filters`, aggregate `freshness`, `audit`, and
  `researchBoundary`
- machine-readable `stateContract`, complete `claimClassContract.allowedValues`, and
  emitted-claim mapping `claimClasses`
- `syntheticCkGeometry` disclosure
- `evidenceSchemaVersion=china-stock-selection.evidence.v1`, `evidenceMode`,
  `survivorshipBias`, `reproducibility`, `hypothesis`, `statistics`, `benchmarks`,
  and `walkForward`
- `executionAudit` and `config.execution`, covering the declared slippage model,
  liquidity floors, participation cap, A-share price-limit rule, and suspension rule
- `equityCurve`, `riskMetrics`, `signalDecay` with `signalDecayHorizonSource` and
  `signalDecaySemantics`, and `sensitivity`
- `summary`
- `trades` in replay mode or `signals` in latest mode, plus reason-coded `skipped`

Every eligible signal includes:

- profile and target: `profile`, `profileMinimumGrossReturnPct`,
  `profileFixedTargetReturnPct`, `signalTargetGrossReturnPct`, `profileStopPct`, `targetMode`,
  `targetId`, `targetPrice`, `signalTargetRecoveryFraction`,
  `signalStructuralRecoveryFraction`, and `signalModelHorizonSessions`
- provenance: `symbol`, `name`, `nameSource`, `market`, `source`, `dataThrough`,
  `rows`, `staleDays`, row-level `freshness`, `provenance`, and `signalDate`
- gated research state: `dataState`, `dataStateReasons`,
  `scoreStatus=not-applicable`, `candidateStatus` plus compatibility alias `status`,
  `statusReasons`, `executionStatus`, and `executionReasons`
- row-level `claimClasses` using only the enum from `formula-risk-contract.md`
- mean-reversion diagnostics: `deviationZ`, `deviationHorizonSessions`,
  `halfLifeSessions`, `arCoefficient`,
  `meanReversionDecayMode`
- causal sample provenance: `adaptiveWindowSpec` and row-level provenance `rowGate`
- normal-reference and empirical deviation fields with
  `deviationProbabilitySemantics`
- `ckGeometryPercentile`, `ckGeometryModel`, `ckGeometryInterpretation`
- cost fields, conditional zero-shock holding projections, `dynamicHolding`, and flattened dynamic-state
  fields such as `dynamicStatus`, `shortPlan`, `fundPlan`, and `waitingReasons`
- `eligible=true`, meaning only that the research signal passed the declared gates

The v4 replay schema does not emit formula `*Days`, `rho`, or generic hold-duration
aliases. It uses `arCoefficient`, `halfLifeSessions`, `*HorizonSessions`, and
`actualHoldSessions`. Calendar-age `staleDays` is retained solely as provenance.

Replay trades add `entryDate`, `exitDate`, `entryGapPct`, `entryPrice`, `exitPrice`,
`signalTargetPrice`, recomputed `targetPrice`, `targetRecomputedAtEntry`, `targetTiming`,
`targetContextPolicy`, actual-entry `targetRecoveryFraction`,
`structuralRecoveryFraction`, `horizonCycleStartPrice`, `horizonCostLowerPrice`,
`horizonAnchorPrice`, `modelHorizonRaw`, `modelHorizonSessions`,
`appliedHorizonSessions`, `fixedHorizonApplied`, `modelHorizonStatus`, `horizonMode`,
`entryDeviationZ`, `entryDeviationHorizonSessions`, `actualTargetGrossReturnPct`,
`settlementLagSessions`, `executionAuthority`, `reason`, `intrabarBothHit`,
`intrabarPolicy`, `actualHoldSessions`, `grossReturnPct`, and `netReturnPct`.

In structure mode `appliedHorizonSessions === modelHorizonSessions`. In fixed mode the structural
model horizon remains visible for comparison while `appliedHorizonSessions` is the explicitly
requested scenario horizon. Latest observations keep actual-entry `modelHorizonSessions=null`
and declare that the next-session open is missing. Replay trade rows replace signal-close
`dynamicHolding` and flattened dynamic fields with the accepted actual-entry-open
re-evaluation; signal-only target and horizon fields remain separately prefixed `signal`.

Historical replay rows reconstruct provenance and decision state from the visible
prefix only. For each trade, `dataThrough === signalDate`, `rows ===
adaptiveWindowSpec.visibleRows`, freshness uses
`basis=historical-visible-prefix-as-of-signal-close`, and `futureRowsUsed=false`.
Dataset-end coverage remains only in aggregate coverage/audit metadata and cannot set a
historical row's `candidateStatus`.

Replay `summary` reports trade count, win/target/stop percentages, average, median,
p10, p90, worst, best, and per-profile summaries. Latest `summary` reports eligible
signal counts by profile. These are in-sample historical diagnostics, not expected
future return.

Residual provenance limitations: replay now emits input paths, filters, coverage end,
row count, freshness, names and name sources, audit counts, and skipped-symbol reasons.
It still does not emit the exact command string, per-file digest, or coverage start;
preserve those separately when byte-for-byte auditability is required.

### P0 evidence gates

`--validate`, `--hypothesis`, `--run-log`, `--seed`, `--bootstrap-samples`,
`--random-entry-samples`, `--train-sessions`, `--test-sessions`, `--step-sessions`,
and `--min-folds` are additive: the existing gates, rows, and fill rules are unchanged,
and every new block stays `research-only`.

| Flag                     |                     Default | Unit / accepted value    | Runtime meaning                                                       |
| ------------------------ | --------------------------: | ------------------------ | --------------------------------------------------------------------- |
| `--validate`             |                      `none` | `none` or `walk-forward` | Unknown values fail. Walk-forward requires `--mode replay`.           |
| `--train-sessions`       |                       `400` | positive integer         | In-sample window length of each walk-forward fold.                    |
| `--test-sessions`        |                        `60` | positive integer         | Out-of-sample window length of each walk-forward fold.                |
| `--step-sessions`        |                        `60` | positive integer         | Calendar advance between consecutive folds.                           |
| `--min-folds`            |                         `3` | positive integer         | Minimum fold count; shortfalls are reported, never satisfied silently. |
| `--hypothesis`           |                       none | JSON file path           | Pre-registered rule declaration. An unreadable path fails before the scan. |
| `--run-log`              |                       none | JSONL file path          | Appends the run hash and raises `multipleComparisonsWarning`.          |
| `--seed`                 |                   `20260101` | integer                  | Seeds the bootstrap and random-entry draws so output is reproducible.  |
| `--bootstrap-samples`    |                      `2000` | positive integer         | Resamples behind `bootstrapCI95Pct`.                                  |
| `--random-entry-samples` |                       `200` | positive integer         | Random entries drawn per instrument for the null benchmark.           |

`survivorshipBias` always reports `warning=universe-is-current-membership-only`,
`pointInTimeMembershipAvailable=false`, and `biasDirection=upward`. The local index is
today's membership, so an absolute return level is an upper bound rather than an estimate,
and the missing point-in-time membership stays an explicit missing input.

`--holding-gate diagnostic` is a research override, not a new signal. The deep-discount
profile gates select states whose drawdown is still expanding, while the domain holding plan
only returns `execute` for `repair-start` or `mean-reverting`; enforcing both leaves an almost
empty intersection. `diagnostic` keeps every other gate, stops discarding on the phase verdict,
and records `holdingGateEnforced=false`, `holdingGateVerdict`, `holdingGatePhase`,
`holdingGateShortTradeAction`, and `holdingGateBlockedReasons` on every row. `statistics`
gains `byDynamicPhase` and `byHoldingGateVerdict` so an overridden trade is never reported
inside the clean sample. The default is `diagnostic`, because a hard gate that discards every
candidate leaves no sample to test; `--holding-gate enforce` restores the strict gate.

`reproducibility` carries `configHash`, `dataHash`, `dataHashScope`, `nodeVersion`,
`platform`, `gitCommit`, and the resolved seeds. `configHash` covers the resolved profiles,
gates, fee, markets, and evidence options. `dataHash` covers the manifest of
`symbol, market, rows, dataThrough, source` per instrument. Both are `sha256:` prefixed and
independent of `--format`.

`statistics` reports `n`, `meanPct`, `medianPct`, `stdPct`, `tStat`, `pValue`,
`bootstrapCI95Pct`, and `sampleWarning`. `n<30` always sets
`insufficient-sample: n<30, results are not statistically meaningful`; zero trades set
`no-sample`. `testModel` states that the two-sided p-value is a normal-reference
approximation on the sample t statistic, not an exact finite-sample test.

`benchmarks` pairs the rule against `buyAndHoldSameHorizon` (accepted entry open to accepted
exit close, same accepted trade sample) and `randomEntrySameUniverse` (seeded uniform entries
per instrument held for the median accepted horizon). Both apply the same single fee drag.
`excessReturnPctVsBuyAndHold` and `excessReturnPctVsRandomEntry` are differences of sample
means, not significance proofs.

`walkForward` cuts the union session calendar of every covered instrument into
`trainSessions` and `testSessions` folds advanced by `stepSessions`. Each fold reports its
date range, `inSampleTrades`, `outOfSampleTrades`, and both averages. `aggregate` adds
`outOfSampleStdPct`, `outOfSampleWinRatePct`, `foldsWithOutOfSampleTrades`,
`positiveOutOfSampleFolds`, and `consistency` (positive out-of-sample folds divided by folds
that produced at least one trade). `degradationPct` is out-of-sample minus in-sample average,
and `outOfSampleStatistics` reuses the statistics block on out-of-sample trades only. Folds
hold the supplied thresholds fixed: the split measures stability, it does not refit the rule,
and it cannot remove parameter-selection bias from how the thresholds were chosen. `warnings`
reports short calendars, unmet `--min-folds`, and folds with no out-of-sample trade.

`hypothesis` echoes the supplied declaration, compares its optional `configHash`, and lists
`mismatches` when `rule` or `prediction` is missing. It is recorded, never enforced. When
`--run-log` is supplied, a different `configHash` already logged against the same `dataHash`
raises `multipleComparisonsWarning`.

In `latest` mode `statistics`, `benchmarks`, and `walkForward` are `null` with
`evidenceMode=latest-observation-only` rather than zero, because no return is simulated.


### Execution Reality

`--slippage-bps`, `--slippage-atr-fraction`, `--volume-cap` with `--order-notional`,
`--min-avg-volume`, and `--min-avg-turnover` extend the replay from a fill model into an
execution model. All of them are additive, and `config.execution.assumptionSource` records
whether a scenario was declared or every mechanism stayed at its default.

| Flag                      |        Default | Unit / accepted value       | Runtime meaning                                                       |
| ------------------------- | -------------: | --------------------------- | --------------------------------------------------------------------- |
| `--slippage-bps`          |            `0` | non-negative number         | Aggregate price concession per fill, in basis points.                 |
| `--slippage-atr-fraction` |            `0` | non-negative number         | Alternative concession as a fraction of the signal-close ATR percent. |
| `--volume-cap`            |           none | number in `(0,1]`           | Participation ceiling; requires `--order-notional`.                   |
| `--order-notional`        |           none | positive number             | Declared order size, used only to compute participation.              |
| `--min-avg-volume`        |            `0` | non-negative number         | Causal average-volume floor; `0` disables the gate.                   |
| `--min-avg-turnover`      |            `0` | non-negative number         | Causal average-turnover floor; `0` disables the gate.                 |

Slippage is frozen at signal close and applied to both fills: the entry fill pays up and the exit
fill receives less, so `grossReturn = exitFillPrice / entryFillPrice - 1`. The structural target
level is unchanged, and the stop is derived from the actual entry fill. `--slippage-bps` and
`--slippage-atr-fraction` are mutually exclusive, and an undeclared concession is reported as
`none-declared` rather than silently treated as zero cost.

`executionAudit` accounts for every emitted signal: `signals` equals `accepted` plus the reason
counters `entry-gate-rejected`, `insufficient-liquidity`, `suspended-entry-session`,
`entry-at-price-limit-up`, and `order-exceeds-volume-cap`. A blocked signal produces no trade row
at all, so the surviving sample is the execution-feasible one.

The A-share price-limit rule blocks an entry whose session open is at or above the board limit over
the previous close: `30` and `68` prefixes use 20%, `43`, `83`, `87`, and `88` use 30%, and other
six-digit codes use 10%. Back-adjusted prices make the limit price approximate, and ST or newly
listed boards cannot be detected locally, so the rule is a near-limit gap detector rather than an
exchange-exact check. Hong Kong has no modeled daily limit. A suspended entry session, detected
from zero volume or a calendar gap beyond the disclosed threshold, is not tradable. A suspension
inside the holding window is disclosed per trade and is not re-simulated, and an exit session that
closed at the board limit is flagged instead of re-priced.

Liquidity gates consume only the visible prefix, with the averaging window taken from
`adaptiveWindowSpec.analysisWindowRows` rather than a hidden fixed period.

### P2 Research Outputs

`--sensitivity`, `--sensitivity-factors`, and `--decay-horizons` are additive research
outputs over the same accepted trades. `equityCurve`, `riskMetrics`, and `signalDecay` are
always emitted in `replay` mode and stay `null` in `latest` mode, where no return exists.

`riskMetrics` is `simulation-only` and uses an equal-weight, one-unit-per-accepted-trade curve
compounded in exit-date order. `capitalModel` states that there is no position limit and no
cash ledger, so concurrent trades compound sequentially and the curve is a trade-sequence
research curve rather than a portfolio NAV. It reports `points`, `finalEquity`,
`totalReturnPct`, `maxDrawdownPct`, `profitFactor`, `perTradeSharpe`, `annualizedSharpe` with
its explicit annualization basis, `annualizedReturnPct`, `calmar`, and `avgHoldSessions`. A
sample below 30 trades always carries the sample warning.

`signalDecay` reports the forward net return after the accepted entry fill at each
`--decay-horizons` coordinate (default `1,2,3,5,10,20`) under the same fee, with `n`,
`avgNetPct`, `winRatePct`, and a per-bucket sample warning. The ladder is a fixed research
coordinate, disclosed as `signalDecayHorizonSource`, not a holding recommendation.

| Flag                     |          Default | Unit / accepted value   | Runtime meaning                                          |
| ------------------------ | ---------------: | ----------------------- | -------------------------------------------------------- |
| `--sensitivity`          |            `off` | `off` or `thresholds`   | `thresholds` re-runs the same command once per perturbed threshold. |
| `--sensitivity-factors`  |       `0.8,1.2` | comma-separated numbers | Multipliers applied to each resolved profile threshold.   |
| `--decay-horizons`       | `1,2,3,5,10,20` | comma-separated integers | Forward-return coordinates for `signalDecay`.            |

`--sensitivity thresholds` perturbs `minZ`, `maxCkGeometryPercentile`, `maxHalfLifeSessions`,
`minCostDistancePct`, `maxCostDistancePct`, and `minimumGrossReturn`. Each variant is a
separate full replay, so the flag costs one whole run per variant. `stabilityScore` is the
share of variants that keep a positive sample mean and a trade count within
`tradesToleranceFactor` (2x) of the base. `byParameter` reports `baseValue`, `minTrades`,
`maxTrades`, `tradesRangeRatio`, and `signFlips` per perturbed threshold, so one hypersensitive
knob stays visible even when the aggregate score is high. An invalid perturbation, a variant
with no sample, a base sample below the 30-trade floor, and any parameter whose sample size
swings by 2x or more are all reported in `warnings`. `stabilityScoreInterpretable` states
whether the score may be read as evidence at all.

## Unmodeled Execution and Cost Mechanisms

Neither CLI models or verifies:

- live bid/ask, depth, spread, latency, partial fills, or rejected orders; the declared
  `--slippage-bps` or `--slippage-atr-fraction` concession is not a book
- gap-through stop/target fills; daily-bar boundaries are filled at the declared level
- exchange price limits beyond the disclosed A-share board-prefix rule, trading halts,
  auctions, tick size, board lot, or broker minimum-order rules; ST and newly listed boards
  are not detectable locally and Hong Kong has no modeled daily limit
- A-share or Hong Kong commissions, taxes/stamp duty, levies, transfer/clearing fees,
  minimum commissions, or currency conversion
- account cash, position size, portfolio loss budget, settlement availability, margin,
  financing, securities borrowing, liquidation, or cross-position exposure
- point-in-time constituents, delistings, corporate-action identity, fundamentals,
  news, or event calendars; `survivorshipBias` discloses the resulting
  current-membership bias instead of correcting it
- a suspension inside the holding window, which is disclosed per trade rather than
  re-simulated, and an exit session that closed at the board limit, which is flagged
  rather than re-priced
- parameter-selection bias in the threshold choice itself; `walkForward` splits the
  timeline, `hypothesis` records a pre-registered rule, and `sensitivity` perturbs one
  threshold at a time, but none of them can prove which thresholds were tried before the run
- portfolio construction, capital allocation, rebalancing, position sizing, financing,
  and any concurrent-position exposure; `riskMetrics` is a trade-sequence curve, not a NAV

Therefore `eligible=true`, `观察`, a high score, a high win rate, or a positive
`netReturnPct` never promotes output to `executable`. The safe terminal states remain
research-only, calibration-required, missing-input, `需刷新数据`, `剔除`, `等待`, or
`观察` until a separate execution workflow supplies and validates the missing inputs.

## Required Provenance for Reports

For a result intended to be reproducible, retain:

1. exact command and resolved profile configuration
2. symbol, market, source/name source, CSV identity, coverage start/end, rows, and freshness
3. the active market filter
4. `dataState`, raw `scoreStatus`, gated `candidateStatus`, and `executionStatus`
5. signal, entry, settlement lag, target/q/horizon recomputation, tail sufficiency,
   non-overlap, intrabar, explicit fixed-scenario horizon (if any), and fee assumptions
6. model labels and non-probability/non-return disclaimers
7. missing account, liquidity, cost, settlement, and fill inputs
