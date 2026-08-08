# Formula Inventory

这份清单是“当前实现中所有公式函数 / 派生公式”的索引。`formula-reference.md` 写核心数学推导；本文件负责防漏项。

## Scope

- `stage`：产品公式阶段，来自 `formulaStages` / `formulaEvidenceCatalog`。
- `formula/query`：具体实现函数或派生量，可能一个 stage 下有多个公式。
- `status`：`implemented` 表示 domain 已实现；`research-only` 表示只用于研究展示；`proxy-only` 表示缺外部真实制度；`protocol-unverified` 表示协议机制未验证。

## Probability / Numeric Primitives

| Function | Formula / meaning | Status |
| --- | --- | --- |
| `normalPdf` | `n(x)=exp(-x^2/2)/sqrt(2pi)` | implemented |
| `normalCdf` | Abramowitz-Stegun erf approximation for `N(x)` | implemented |
| `inverseNormalCdf` | Acklam-style inverse normal approximation | implemented |
| `integrateTrapezoid` | trapezoid numerical integral `sum((y_i+y_{i+1})/2)*dx` | implemented |
| `clamp` | bounded scalar projection | implemented |
| `erfApprox` | local erf approximation inside order timing confidence | implemented |

## Market Path / Cost / Volatility

| Function / field | Formula / meaning | Status |
| --- | --- | --- |
| `deriveWindows` | adaptive `cost/recent/vol` windows from sample length | implemented |
| `buildMarketStatePath` | log returns, true range, rolling market state | implemented |
| `buildMarketState` | latest point from `buildMarketStatePath` | implemented |
| `buildCostPath` | rolling cost anchor and cost band path | implemented |
| `weightedTypicalCost` | `sum(((H+L+C)/3)*volume)/sum(volume)`, equal-weight fallback | implemented |
| `costDistance` | `(close-costAnchor)/costAnchor` | implemented |
| `momentumAt` | `close_t/close_{t-n}-1` | implemented |
| `rollingAnnualVol` | rolling `std(logReturn)*sqrt(tradingDaysPerYear)` for formula path | implemented |
| `vixFix` | `(highestClose-low)/highestClose` | implemented |

## Formula Path / Chart Curve Metadata

| Export / field | Formula / meaning | Status |
| --- | --- | --- |
| `buildFormulaPath` | unified chart path from market rows + formula inputs | implemented |
| `FORMULA_PATH_FIELDS` | complete field schema with source/unit/pane/status/drawable flags | implemented |
| `FORMULA_PATH_CURVES` | source/unit/pane/status metadata for chart curves | implemented |
| `costAnchor`, `costUpper`, `costLower` | cost band outputs carried by `formulaPath` | implemented |
| `deltaLower`, `deltaCost`, `deltaUpper` | GetDelta chart band outputs | implemented |
| `optionDelta`, `optionGamma`, `optionThetaDaily` | BS Greeks chart outputs | research-only |
| `lpLowerPrice`, `lpUpperPrice`, `lpValue`, `lpInventoryDelta`, `lpNormalizedDelta` | v3 LP chart outputs | research-only |
| `capitalEfficiency`, `impermanentLoss`, `netLpEfficiency` | LP research outputs | research-only |
| `fundingBasis`, `fundingProxy`, `netCarry`, `breakEvenFunding` | carry research outputs | proxy-only |

## Input Semantics

| Function | Formula / meaning | Status |
| --- | --- | --- |
| `resolveDeltaSlope` | non-negative GetDelta `d`, fallback from legacy `targetReturn` | implemented |
| `resolveExitTargetReturn` | non-negative execution exit target `g` | implemented |

## GetDelta / Option Formulas

| Function | Formula / meaning | Status |
| --- | --- | --- |
| `GET_DELTA_SOURCE` | Desmos/blog source id and implementation status for GetDelta | implemented metadata |
| `getDeltaBands` | `e_T=sqrt(T/(tdpy*2pi))`, `R=((1+sigma e_T)/(1-sigma e_T))^2`, long/short bands | implemented |
| `getDeltaBandValue` | piecewise payoff value inside GetDelta band | implemented |
| `getDeltaBandSlope` | local payoff slope, audited against `deltaSlope` | implemented |
| `blackScholes` | vanilla option price and Greeks with dividend yield | research-only |
| `asianOption` | geometric Asian approximation via adjusted BS vol/carry | research-only |
| `bachelierOption` | normal-vol option price/Delta/Gamma | research-only |
| `riskSurface` | BS Greeks sampled across a price band | implemented query, no execution |

## Option Portfolio

| Function | Formula / meaning | Status |
| --- | --- | --- |
| `optionLegsFromTemplate` | single / straddle / strangle / vertical / collar leg expansion | research-only |
| `normalizeOptionLegs` | sanitize option leg definitions | research-only |
| `buildOptionPortfolio` | aggregate signed leg value, PnL, Greeks, scenario and expiry curves | research-only |
| `priceLeg` | signed leg value `direction*qty*multiplier*optionPrice` | research-only |
| `aggregateLegs` | sum value, entryCost, PnL, Delta, Gamma, Theta, Vega, Rho | research-only |
| `scenarioLegPnl` | model PnL under scenario price | research-only |
| `expiryLegPnl` | intrinsic-value PnL at expiry | research-only |
| `classifyOptionPortfolio` | delta/gamma class label | research-only |

## LP / AMM / Liquidity

| Function | Formula / meaning | Status |
| --- | --- | --- |
| `uniswapV2Inventory` | simplified v2 LP payoff and hedge delta | research-only |
| `uniswapV3Inventory` | real v3 token0/token1/value by lower/upper/current price | research-only |
| `uniswapV3Payoff` | symmetric approximation payoff retained for comparison | research-only |
| `uniswapV3HedgedInventory` | symmetric approximate hedged v3 payoff | research-only |
| `uniswapV3HedgedPosition` | real lower/upper v3 hedged PnL | research-only |
| `impermanentLoss` | v2 ratio/value IL | research-only |
| `hedgedLpPortfolioCurve` | LP + option + hedge + fees - funding scenario curve | research-only |
| `portfolioValue` | `lpValue + optionValue - fundingCost` | research-only |
| `laplaceDensity` | asymmetric Laplace density | research-only |
| `normalDensity` | Gaussian anchor bump density `exp(-z^2/2)/(sqrt(2pi)*sigma)` | research-only |
| `logLaplaceDensity` | Laplace density on `log(price)` | research-only |
| `coveredCallFit` | covered-call-fit density proxy using inverse normal CDF | research-only |
| `buildDensityComponents` | builds base / active / cost / order / range density components | research-only |
| `normalizeComponents` | integrates each component and normalizes mixture weights | research-only |
| `componentDensity` | per-component contribution `w_c f_c(p)/integral(f_c)` | research-only |
| `componentMasses` | segment-level integral by component | research-only |
| `fingerprintStats` | entropy, concentration, bid/ask share, active/order share and peak mode count | research-only |
| `liquidityFingerprint` | hybrid component density + segment weights by numerical integration | research-only |
| `lambertW` | Halley iteration for principal Lambert W branch | implemented query |
| `ammCurve` | constant-product `xy=k` plus Lambert comparison curve | research-only |
| `ammLambertCurve` | standalone Lambert curve samples | research-only |
| `numoenSnapshot` | reverse-engineered Numoen invariant snapshot | protocol-unverified |
| `capitalEfficiency` | range geometry efficiency and frontier slope | research-only |

## Funding / Carry / Fusion

| Function | Formula / meaning | Status |
| --- | --- | --- |
| `fundingRate` | `basisEstimate=perpTwap/spotTwap-1`, `cumulativeFundingEstimate=basis*h/24` | proxy-only |
| `netCarry` | `abs(costDistance)-abs(cumulativeFundingEstimate)` | proxy-only |
| `deviationScore` | `z=costDistance/(annualVol*sqrt(T/tdpy))`, proxy regression strength | implemented |
| `netLpEfficiency` | `(CE-1)+IL+CE*feeRate` | research-only |
| `meanReversionHalfLife` | AR(1) rho, `theta=-ln(abs(rho))`, `halfLife=ln(2)/theta` | implemented query |
| `gammaPnl` | `0.5*gamma*positionSize*priceChange^2` | implemented query |
| `volConfidence` | `SE=sigma/sqrt(2n)`, `CI=sigma +/- z*SE` | implemented query |

## Strategy / Execution Formulas

| Function | Formula / meaning | Status |
| --- | --- | --- |
| `resolveProfile` | choose conservative / balanced / aggressive / custom profile | implemented |
| `resolveExecutableProfile` | profile plus market-scaled thresholds | implemented |
| `buildCustomProfile` | clamp user profile fields to bounded ranges | implemented |
| `scaleProfileToMarket` | ATR/vol-scaled edge, momentum, risk, exposure, cooldown thresholds | implemented |
| `buildDecisionGraph` | execution query combining market, GetDelta, account and profile | implemented |
| `buildEntryTiming` | cost band + GetDelta band + momentum/cost-slope trigger logic | implemented |
| `signalStrength` | `1 - 2*(1-Phi(|z|))` proxy from z-score | implemented |
| `minEdge` | `max(atr*edgeAtr, profile.minEdge)` | implemented |
| `buyEdge` / `sellEdge` | relative distance from cost anchor to mark | implemented |
| `buildPositionPlan` | risk budget, exposure cap, first notional, stop/target | implemented |
| `riskBudget` | `equity*riskBudgetPct` | implemented |
| `riskBudgetPct` | linear interpolation from `riskMin` to `riskMax` by signal strength | implemented |
| `exposureCap` | equity-scaled exposure bound | implemented |
| `maxNotional` | min cash/exposure/risk for buy; min base value/exposure for sell | implemented |
| `buildExecutionPlan` | three-level ladder using `LADDER_WEIGHTS=[0.2,0.3,0.5]` | implemented |
| `orderTargetPrice` | buy target max of reference and `price*(1+exitTargetReturn)` | implemented |
| `expectedProfit` | buy `(target-price)*amount`, sell `(price-target)*amount` | implemented |
| `buildFormulaStrategyComposition` | explanation model for executable formula chain | implemented |
| `buildFormulaBasis` | GetDelta variable basis for UI/audit | implemented |

## Replay / Account Simulation

| Function | Formula / meaning | Status |
| --- | --- | --- |
| `buildDailyReplay` | bounded spot replay around strategy graph | partial implemented |
| `warmupDays` | `min(80,max(20,floor(totalRows*0.03)))` | implemented |
| `replayStartIndex` | account start date constrained by warmup | implemented |
| `accountExit` | target / stop / momentum cut / expiry exit rules | implemented |
| `closeAccountPosition` | proceeds, realized PnL, return rate | implemented |
| `fillPendingOrder` | next-bar low/high limit-fill rule | implemented |
| `applyFill` | cash/base/costBasis update with fee | implemented |
| `initialExitPlan` | target/stop/expiry for existing base position | implemented |
| `orderExitPlan` | target/stop/expiry after order fill | implemented |
| `mergeExitPlan` | base-weighted target and lower stop merge | implemented |
| `summarize` | total PnL, realized PnL, drawdown, win rate, used notional | implemented |
| `feeRate` | non-negative replay fee input, default `0.001` | implemented |

## Research / Workbench Queries

| Function | Formula / meaning | Status |
| --- | --- | --- |
| `buildResearchSnapshot` | gathers option, LP, funding, portfolio research outputs | research-only |
| `optionLegPnL` | scenario option PnL inside LP portfolio curve | research-only |
| `buildLiquidityRackModel` | density and simulated-order rack visualization model | research-only |
| `buildTraderChecklist` | status aggregation over market, trigger, account, orders, option, LP, funding | implemented query |

## Not Counted As Formula Source

UI formatters such as `fmt`, `pct`, `f4`, CSS geometry helpers such as `sx/sy`, and Vue computed wrappers are not formula sources unless they introduce a new business calculation. They must not be used as hidden formula locations.
