# Formula Inventory

这份清单是“当前实现中所有公式函数 / 派生公式”的索引。`formula-reference.md` 写核心数学推导；本文件负责防漏项。

## Scope

- `stage`：产品公式阶段，来自 `formulaStages` / `formulaEvidenceCatalog`。
- `formula/query`：具体实现函数或派生量，可能一个 stage 下有多个公式。
- `status`：`implemented` 表示 domain 已实现；`research-only` 表示只用于研究展示；`proxy-only` 表示缺外部真实制度；`protocol-unverified` 表示协议机制未验证。

## Probability / Numeric Primitives

| Function             | Formula / meaning                                                        | Status                      |
| -------------------- | ------------------------------------------------------------------------ | --------------------------- |
| `normalPdf`          | `n(x)=exp(-x^2/2)/sqrt(2pi)`                                             | implemented                 |
| `normalCdf`          | Abramowitz-Stegun erf approximation for `N(x)`                           | implemented                 |
| `inverseNormalCdf`   | Acklam-style inverse normal approximation                                | implemented                 |
| `integrateTrapezoid` | trapezoid numerical integral `sum((y_i+y_{i+1})/2)*dx`                   | implemented                 |
| `clamp`              | bounded scalar projection                                                | implemented                 |
| `erfApprox`          | local erf approximation inside order-timing normal-reference extremeness | implemented; not confidence |

## Market Path / Cost / Volatility

| Function / field                | Formula / meaning                                                                           | Status                |
| ------------------------------- | ------------------------------------------------------------------------------------------- | --------------------- |
| `deriveWindows`                 | adaptive `cost/recent/vol` windows from sample length                                       | implemented           |
| `buildMarketStatePath`          | log returns, true range, rolling market state                                               | implemented           |
| `isPrefixCausalMarketStatePath` | validates canonical builder provenance, unchanged fingerprint and per-point prefix metadata | implemented gate      |
| `buildMarketState`              | latest point from `buildMarketStatePath`                                                    | implemented           |
| `buildCostPath`                 | rolling cost anchor and cost band path                                                      | implemented           |
| `weightedTypicalCost`           | `sum(((H+L+C)/3)*volume)/sum(volume)`, equal-weight fallback                                | implemented           |
| `costDistance`                  | `(close-costAnchor)/costAnchor`                                                             | implemented           |
| `momentumAt`                    | `close_t/close_{t-n}-1`                                                                     | implemented           |
| `rollingAnnualVol`              | rolling `std(logReturn)*sqrt(tradingDaysPerYear)` for formula path                          | implemented           |
| `vixFix`                        | `(highestClose-low)/highestClose`                                                           | implemented           |
| `scoreFreshnessEvidence`        | 新鲜度、最低样本深度与 TDPY 覆盖的分列数据质量分；10 日是显式 freshness 阈值，不是持有期    | implemented query     |
| `deviationScore`                | 公式周期 z、绝对偏离分位和双侧尾部质量；不输出未来回归概率                                  | descriptive reference |
| `volConfidence`                 | IID 正态近似 `SE=sigma/sqrt(2n)` 与名义区间；显式标记为非稳健置信区间                       | implemented query     |

## Formula Path / Chart Curve Metadata

| Export / field                                                                                               | Formula / meaning                                                 | Status        |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------- |
| `buildFormulaPath`                                                                                           | unified chart path from market rows + formula inputs              | implemented   |
| `FORMULA_PATH_FIELDS`                                                                                        | complete field schema with source/unit/pane/status/drawable flags | implemented   |
| `FORMULA_PATH_CURVES`                                                                                        | source/unit/pane/status metadata for chart curves                 | implemented   |
| `costAnchor`, `costUpper`, `costLower`                                                                       | cost band outputs carried by `formulaPath`                        | implemented   |
| `deltaLower`, `deltaCost`, `deltaUpper`                                                                      | GetDelta chart band outputs                                       | implemented   |
| `optionDelta`, `optionGamma`, `optionThetaPerSession`                                                        | BS Greeks chart outputs with explicit trading-session time unit   | research-only |
| `lpLowerPrice`, `lpUpperPrice`, `lpValue`, `lpInventoryDeltaToken0`, `lpNormalizedDelta`                     | v3 LP chart outputs with token unit                               | research-only |
| `capitalEfficiency`, `capitalEfficiencyFrontier`, `fullRangeV2IlProxy`, `rangeV3Il`, `lpResearchAttribution` | geometry plus mechanism-specific, same-horizon LP attribution     | research-only |
| `fundingBasis`, `cumulativeFundingProxy`, `netCarry`, `breakEvenFundingNetCostReturn`                        | direction/notional/horizon-bound carry research outputs           | proxy-only    |

## Input Semantics

| Function                  | Formula / meaning                                              | Status      |
| ------------------------- | -------------------------------------------------------------- | ----------- |
| `resolveDeltaSlope`       | non-negative GetDelta `deltaSlope`; never reads `targetReturn` | implemented |
| `resolveExitTargetReturn` | non-negative execution exit target `g`                         | implemented |

## GetDelta / Option Formulas

| Function            | Formula / meaning                                                                                | Status                          |
| ------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------- |
| `GET_DELTA_SOURCE`  | Desmos/blog source id and implementation status for GetDelta                                     | implemented metadata            |
| `getDeltaBands`     | `e_T=sqrt(T/(tdpy*2pi))`, `R=((1+sigma e_T)/(1-sigma e_T))^2`, long/short bands                  | implemented                     |
| `getDeltaBandValue` | piecewise payoff value inside GetDelta band                                                      | implemented                     |
| `getDeltaBandSlope` | local payoff slope, audited against `deltaSlope`                                                 | implemented                     |
| `blackScholes`      | vanilla option price and explicitly-unitized Greeks; requires independent `timeToExpirySessions` | research-only                   |
| `asianOption`       | geometric Asian approximation; requires independent option expiry                                | research-only                   |
| `bachelierOption`   | normal-vol option price/Delta/Gamma; unimplemented Theta/Rho remain `null`                       | research-only                   |
| `riskSurface`       | BS Greeks sampled across a price band                                                            | implemented query, no execution |
| `gammaPnl`          | 局部二阶情景项 `0.5*optionGamma*positionSize*priceChange^2`，不是完整期权损益                    | implemented query               |

## Option Portfolio

| Function                  | Formula / meaning                                                                   | Status        |
| ------------------------- | ----------------------------------------------------------------------------------- | ------------- |
| `optionLegsFromTemplate`  | single / straddle / strangle / vertical / collar leg expansion                      | research-only |
| `normalizeOptionLegs`     | sanitize option leg definitions                                                     | research-only |
| `buildOptionPortfolio`    | aggregate signed leg value, PnL, Greeks, scenario and expiry curves                 | research-only |
| `priceLeg`                | signed leg value `direction*qty*multiplier*optionPrice`                             | research-only |
| `aggregateLegs`           | sum value, entryCost, PnL and known Greeks; any missing leg Greek propagates `null` | research-only |
| `scenarioLegPnl`          | model PnL under scenario price                                                      | research-only |
| `expiryLegPnl`            | intrinsic-value PnL at expiry                                                       | research-only |
| `classifyOptionPortfolio` | delta/gamma class label                                                             | research-only |

## LP / AMM / Liquidity

| Function                       | Formula / meaning                                                                                              | Status              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------- |
| `uniswapV2Inventory`           | simplified v2 LP payoff with separate LP and hedge-adjusted `netInventoryDeltaToken0`; naked `delta` forbidden | research-only       |
| `uniswapV3Inventory`           | real v3 token0/token1/value by lower/upper/current price                                                       | research-only       |
| `uniswapV3Payoff`              | symmetric approximation payoff retained for comparison                                                         | research-only       |
| `uniswapV3HedgedInventory`     | symmetric approximate hedged v3 payoff                                                                         | research-only       |
| `uniswapV3HedgedPosition`      | real lower/upper v3 hedged PnL                                                                                 | research-only       |
| `fullRangeV2ImpermanentLoss`   | full-range v2 ratio/value IL exposed as `fullRangeV2IlProxy`                                                   | research-only       |
| `rangeV3ImpermanentLoss`       | specified-range v3 IL against the same entry inventory held unchanged                                          | research-only       |
| `impermanentLoss`              | deprecated compatibility wrapper for `fullRangeV2ImpermanentLoss`; never a v3 result                           | deprecated          |
| `hedgedLpPortfolioCurve`       | LP + option + hedge + fees + signed `fundingCashflowQuote` scenario curve                                      | research-only       |
| `portfolioValue`               | `lpValue + optionValue + fundingCashflowQuote`                                                                 | research-only       |
| `laplaceDensity`               | asymmetric Laplace density                                                                                     | research-only       |
| `normalDensity`                | Gaussian anchor bump density `exp(-z^2/2)/(sqrt(2pi)*sigma)`                                                   | research-only       |
| `logLaplaceDensity`            | Laplace density on `log(price)`                                                                                | research-only       |
| `coveredCallFit`               | covered-call-fit density proxy using inverse normal CDF                                                        | research-only       |
| `buildDensityComponents`       | builds density components from explicit annual volatility and `tradingDaysPerYear`; missing inputs block       | research-only       |
| `normalizeComponents`          | integrates each component and normalizes mixture weights                                                       | research-only       |
| `componentDensity`             | per-component contribution `w_c f_c(p)/integral(f_c)`                                                          | research-only       |
| `componentMasses`              | segment-level integral by component                                                                            | research-only       |
| `fingerprintStats`             | entropy, concentration, bid/ask share, active/order share and peak mode count                                  | research-only       |
| `liquidityFingerprint`         | explicit-time-basis hybrid density + segment weights by numerical integration                                  | research-only       |
| `lambertW`                     | Halley iteration for principal Lambert W branch                                                                | implemented query   |
| `ammCurve`                     | constant-product `xy=k` plus Lambert comparison curve                                                          | research-only       |
| `ammLambertCurve`              | standalone Lambert curve samples                                                                               | research-only       |
| `numoenSnapshot`               | reverse-engineered Numoen invariant snapshot                                                                   | protocol-unverified |
| `capitalEfficiency`            | CK endpoint-ratio CE at range geometric midpoint, plus arithmetic-center CE, slope and curvature               | research-only       |
| `capitalEfficiencyAtPrice`     | `2/(2-sqrt(P/Pb)-sqrt(Pa/P))` for an actual mark inside the range                                              | research-only       |
| `resolveArithmeticRangeSpec`   | one validation path for `0 < rangeWidth < 1`, non-negative skew and explicit arithmetic reference              | implemented query   |
| `ckCapitalEfficiencyReference` | exact symmetric CK point `x*=sqrt(5+2sqrt(10))/4`; marginal CE-loss optimum, not probability/PnL optimum       | theorem/reference   |
| `capitalEfficiencyFrontier`    | numerical frontier for a requested skew; never reuses fixed `±84.13%` when skew differs                        | research-only       |

## Funding / Carry / Fusion

| Function                         | Formula / meaning                                                                                                   | Status                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `estimateCumulativeFundingProxy` | `basisFraction=perpTwap/spotTwap-1`; `cumulativeFundingProxy=basis*horizonHours/24`                                 | proxy-only canonical query         |
| `fundingRate`                    | deprecated adapter exposing old basis/funding aliases                                                               | deprecated                         |
| `netCarry`                       | start-to-target directional return plus signed funding cashflow on a common notional/horizon                        | proxy-only                         |
| `legacyNetCarry`                 | rejects old distance/rate inputs that lack side, denominator, notional and horizon                                  | deprecated gate                    |
| `lpResearchAttribution`          | requires explicit `lpIlFraction`, IL model, common capital basis, fee source and horizon before netting return legs | research-only                      |
| `estimateLpPathFees`             | sums volume × fee tier × position share × in-range fraction minus path costs                                        | research-only, missing-input gated |
| `compareFeeCarryToTheta`         | same currency/notional/sign/calendar/interval/as-of fee carry vs Theta; never an identity                           | research-only                      |

## Strategy / Execution Formulas

| Function                          | Formula / meaning                                                                | Status                                      |
| --------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------- |
| `resolveProfile`                  | choose conservative / balanced / aggressive / custom profile                     | implemented                                 |
| `resolveExecutableProfile`        | profile plus market-scaled thresholds                                            | implemented                                 |
| `buildCustomProfile`              | clamp user profile fields to bounded ranges                                      | implemented                                 |
| `scaleProfileToMarket`            | ATR/vol-scaled edge, momentum, risk, exposure, cooldown thresholds               | implemented                                 |
| `buildDecisionGraph`              | execution query combining market, GetDelta, account and profile                  | implemented                                 |
| `buildEntryTiming`                | cost band + GetDelta band + momentum/cost-slope trigger logic                    | implemented                                 |
| `signalStrength`                  | `1 - 2*(1-Phi(abs(z)))` normal-reference extremeness from z-score                | implemented; not confidence/win probability |
| `minEdge`                         | `max(atr*edgeAtr, profile.minEdge)`                                              | implemented                                 |
| `buyEdge` / `sellEdge`            | relative distance from cost anchor to mark                                       | implemented                                 |
| `buildPositionPlan`               | risk budget, exposure cap, first notional, stop/target                           | simulation-only                             |
| `riskBudget`                      | `equity*riskBudgetPct`                                                           | simulation-only                             |
| `riskBudgetPct`                   | linear interpolation from `riskMin` to `riskMax` by normal-reference extremeness | simulation-only heuristic                   |
| `exposureCap`                     | equity-scaled exposure bound                                                     | simulation-only                             |
| `maxNotional`                     | min cash/exposure/risk for buy; min base value/exposure for sell                 | simulation-only                             |
| `buildExecutionPlan`              | three-level ladder using `LADDER_WEIGHTS=[0.2,0.3,0.5]`                          | simulation-only                             |
| `orderTargetPrice`                | buy target max of reference and `price*(1+exitTargetReturn)`                     | implemented                                 |
| `expectedProfit`                  | buy `(target-price)*amount`, sell `(price-target)*amount`                        | scenario arithmetic, not expectancy         |
| `buildFormulaStrategyComposition` | explanation model for executable formula chain                                   | implemented                                 |
| `buildFormulaBasis`               | GetDelta variable basis for UI/audit                                             | implemented                                 |

## Replay / Account Simulation

| Function                      | Formula / meaning                                                                                                  | Status              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `buildDailyReplay`            | bounded spot replay around strategy graph                                                                          | partial implemented |
| `replayQueryEligibility`      | per-row gate over the visible prefix: cost, volatility, target-specific horizon and GetDelta must all be available | implemented         |
| `replayStartIndex`            | account start date constrained by causal warmup                                                                    | implemented         |
| `accountExit`                 | target / stop / momentum cut / expiry exit rules                                                                   | implemented         |
| `resolveLongLotExit`          | open-gap first; ambiguous intrabar double hit uses conservative stop-first; honors eligibleExitIndex               | implemented proxy   |
| `closeAccountPosition`        | proceeds, realized PnL, return rate                                                                                | implemented         |
| `resolveNextSessionLimitFill` | next-session open price on favorable gap; otherwise boundary price on limit touch                                  | implemented         |
| `rebindFormulaHorizonAtFill`  | recomputes recovery fraction and target-specific horizon from the actual fill price                                | implemented         |
| `fillPendingOrder`            | delegates fill-price resolution, fill-time q/H rebinding and account mutation in that order                        | implemented         |
| `applyFill`                   | cash/base/costBasis update with explicitly supplied replay fee                                                     | implemented         |
| `initialExitPlan`             | target/stop; explicit-scenario expiry uses ceil for an existing base                                               | implemented         |
| `orderExitPlan`               | target/stop/target-bound expiry plus next-complete-bar exit eligibility after fill                                 | implemented         |
| `mergeExitPlan`               | appends immutable lot-level target/stop/expiry/horizon bindings; no target averaging                               | implemented         |
| `summarize`                   | total/realized PnL, drawdown, win rate; used notional is peak concurrent open cost basis                           | implemented         |
| `feeRate`                     | validates an explicitly supplied non-negative aggregate replay drag; missing input keeps replay off                | implemented gate    |

## Research / Workbench Queries

| Function                  | Formula / meaning                                                                                  | Status            |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ----------------- |
| `buildResearchSnapshot`   | gathers option, LP, funding, portfolio research outputs                                            | research-only     |
| `optionLegPnL`            | scenario option PnL inside LP portfolio curve                                                      | research-only     |
| `buildLiquidityRackModel` | density and simulated-order rack; full visible prefix unless viewport is explicit, with windowSpec | research-only     |
| `buildTraderChecklist`    | status aggregation over market, trigger, account, orders, option, LP, funding                      | implemented query |

## Dynamic Horizon / Screening Queries

| Function                                                                                                                          | Formula / meaning                                                                                                 | Status                  |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `deriveRecoveryHorizon`                                                                                                           | target-specific `H=HL*log2(1/(1-recoveryFraction))`; rejects `q<=0` or `q>=1`                                     | implemented query       |
| `meanReversionHalfLife`                                                                                                           | AR(1) canonical outputs `arCoefficient`, `arDecayRatePerStep`, `halfLifeSessions`                                 | implemented query       |
| `deriveShortHoldWindow`, `deriveStructuralHoldWindow`                                                                             | legacy-compatible query shells that now require a target-derived recovery fraction and have no hidden holding cap | implemented query       |
| `deriveDynamicHoldingState`, `deriveDrawdownFeatures`, `classifyPhase`                                                            | dynamic state from causal drawdown, AR half-life and structural targets                                           | implemented query       |
| `buildMilestones`, `buildHoldingPlan`, `buildExpectation`                                                                         | maps target-specific horizons into research plans without fixed day buckets                                       | implemented query       |
| `normalizeProfiles`, `DEFAULT_DYNAMIC_HOLDING_PROFILES`                                                                           | target-order profile normalization; legacy min/max day fields are ignored                                         | implemented query       |
| `emptyDynamicState`, `phaseLabel`, `unique`                                                                                       | explicit missing-state and presentation-safe domain helpers                                                       | implemented query       |
| `buildScoreConfig`, `computeBuyScore`, `generateRecommendedStockPool`                                                             | canonical dimension configuration, diagnostic scoring and pool grouping                                           | implemented query       |
| `deriveRecommendedStockDecisionMetrics`                                                                                           | AR/sample-quality plus target-derived horizon projection for pool candidates                                      | implemented query       |
| `capitalEfficiencySlope`, `capitalEfficiencySecondDerivative`, `sampleCapitalEfficiencyCurve`, `CK_CAPITAL_EFFICIENCY_INFLECTION` | CK frontier derivatives, samples and exact symmetric reference                                                    | research-only / theorem |
| `netLpEfficiency`                                                                                                                 | compatibility wrapper over basis-gated same-horizon LP attribution                                                | research-only           |

## Latent-liquidity Research Pilot

| Function                                                                                                            | Formula / meaning                                                                          | Status              |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------- |
| `deriveAdaptiveWindows`, `buildAdaptiveMarketStatePath`                                                             | prefix-only square-root window rule and causal state path                                  | research-only pilot |
| `deriveCkFrontier`, `estimateCkSkewAt`                                                                              | exact CK Part 2 geometry plus an explicitly separate sample-to-scenario alpha bridge       | research-only pilot |
| `deriveRecoveryCycle`, `deriveCycleHorizonAt`, `buildDynamicCycleOutcome`                                           | target-specific cycle algebra, point-in-time horizon and mature/right-censored outcome     | research-only pilot |
| `recoverySessions`, `recoveryFractionAtSessions`, `DEFAULT_CYCLE_HORIZON_CONFIG`                                    | inverse recovery identities and dynamic-cycle configuration without a calendar fallback    | research-only pilot |
| `deriveRecurrenceCycleAt`                                                                                           | empirical kNN state recurrence with exit-to-reentry intervals and KM/Greenwood uncertainty | research-only pilot |
| `buildLatentLiquidityPath`, `classifyLatentLiquidityAt`, `buildForwardOutcome`                                      | latent-state classifier and historical outcome helper                                      | research-only pilot |
| `expectedDirectionForState`, `actionForState`, `LATENT_LIQUIDITY_SCOPE`, `DEFAULT_LATENT_LIQUIDITY_CONFIG`          | state semantics and non-executable research scope                                          | research-only pilot |
| `blockBootstrapComparison`                                                                                          | deterministic date-block resampling comparison                                             | research-only pilot |
| `attachPrequentialCalibration`, `evaluateLatentLiquidityUniverse`, `summarizeEvents`, `DEFAULT_VALIDATION_PROTOCOL` | causal resolution-aware calibration and universe evaluation                                | research-only pilot |

## Not Counted As Formula Source

UI formatters such as `fmt`, `pct`, `f4`, CSS geometry helpers such as `sx/sy`, and Vue computed wrappers are not formula sources unless they introduce a new business calculation. They must not be used as hidden formula locations.
