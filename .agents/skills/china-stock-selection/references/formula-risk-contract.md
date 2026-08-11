# Formula and Risk Contract

Read this reference before using CK, LP, AMM, option, Greek, volatility, fee, funding, carry, or portfolio fields.

## Claim Classes

Every nontrivial output belongs to one class:

- `exact-identity`: algebraic or protocol identity under explicit variable definitions.
- `sample-estimate`: estimated from a declared sample/window without sufficient holdout or stability evidence; expose sample size, method, and failure gates.
- `calibrated-estimate`: a sample estimate with declared calibration target, uncertainty, failure gates, and holdout or forward/window-stability evidence.
- `scenario-proxy`: deterministic output under hypothetical inputs; not a market observation or forecast.
- `missing-input`: the requested conclusion cannot be computed honestly.

Do not promote a scenario proxy to a sample estimate, a sample estimate to a calibrated estimate, or a calibrated estimate to an execution claim. The current stock screen's deviation, empirical-rank, realized-volatility, cost-anchor, and AR diagnostics are sample estimates or reference diagnostics, not calibrated probabilities.

## Formula Layer Map

| Layer                                             | Stock-screen input mode                                 | Permitted interpretation                                       |
| ------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| OHLCV, cost anchor/band, ATR, realized volatility | observed local history                                  | dated market-path diagnostics                                  |
| normal-reference deviation                        | sample/reference diagnostic                             | standardized extremeness, not reversion probability            |
| empirical percentile/tails                        | sample estimate                                         | sample-relative extremeness                                    |
| AR coefficient / half-life                        | sample estimate from an AR(1)-through-origin diagnostic | only positive monotonic decay passes the mean-reversion gate   |
| CK local Delta band                               | scenario coordinate                                     | local-slope price-band diagnostic                              |
| BSM/Asian/Bachelier and Greeks                    | scenario proxy using historical realized sigma          | model sensitivity, not quoted option value                     |
| synthetic CK/Uniswap-v3 geometry                  | unit-liquidity scenario proxy                           | normalized shape diagnostic                                    |
| liquidity fingerprint                             | model allocation mass                                   | target/model weight, not price probability or order-book depth |
| capital efficiency / full-range v2 IL proxy       | geometry diagnostics                                    | leverage/shape only, not a v3 range return                     |
| funding/carry for A/H stocks                      | missing input                                           | keep `null`; do not fabricate a proxy                          |
| dynamic holding / order plan                      | domain query                                            | research gate; still needs account and execution inputs        |

## CK Symmetric Capital-efficiency Theorem

For arithmetic endpoints `Pa=P0(1-x)` and `Pb=P0(1+x)`, CK's endpoint-ratio curve is:

```text
CE(x) = 1 / (1 - ((1-x)/(1+x))^(1/4))
J(x) = 1 / (-dCE/dx)
J'(x)=0  <=>  CE''(x)=0
CE''(x)=0  <=>  256*x^4 - 160*x^2 - 15 = 0
x* = sqrt(5 + 2*sqrt(10)) / 4
   = 0.8412994160945599
CE(x*) = 1/2 + 2*x* = 2.1825988321891194
```

This is an exact analytic marginal-efficiency frontier under the declared objective. It is not an empirical fit.

Critical basis rule: the endpoint-ratio `CE` is valued at the range geometric midpoint `sqrt(Pa*Pb)`. At `x*`, that midpoint is approximately `0.5405694*P0`. If arithmetic-coordinate `P0` is the actual current price, compute current-price CE separately:

```text
CE(P0) = 2 / (2 - sqrt(P0/Pb) - sqrt(Pa/P0))
```

At `x*` this current-price value is approximately `2.3130`, not `2.1826`.

The theorem is not:

- probability coverage
- a default price range
- a fee optimum
- a PnL optimum
- valid unchanged for a skewed range

CK Part 2 publishes the directional/skewed geometry
([article](https://medium.com/@med456789d/uniswap-insights-part-2-of-6-568632aa4d8),
[calculator](https://www.desmos.com/calculator/0l7i8kmukx)). For
`Pa=P0(1-x)`, `Pb=P0(1+alpha*x)` and
`u=((1-x)/(1+alpha*x))^(1/4)`, its frontier condition is:

```text
3*alpha*u^5 - 5*alpha*u^4 - 5*u + 3 = 0
x = (1-u^4) / (1+alpha*u^4)
```

For a declared `alpha`, the equation is an `exact-identity`; numerical root solving does
not turn it into an empirical fit. `alpha=0` gives `u=3/5` and `x=0.8704` exactly, so
`87.5%` is not this theorem's exact constant. What belongs to this project is the bridge
that estimates an `alpha` from historical up/down move scales. That `alpha` remains a
`sample-estimate`, and substituting it into the exact CK geometry produces only a
`scenario-proxy`. It does not reveal a market maker's intent or authorize a range.

There is a separate exact half-life identity:
`q(H)=1-2^(-H/halfLifeSessions)`, hence an explicitly selected
`H=3*halfLifeSessions` gives `q=7/8=0.875`. Do not attribute that conditional time
coordinate to the CK skew optimum, and do not use it as an instrument-wide default q.

## Deviation and Mean Reversion

`deviationPercentile` and `twoSidedTailProbability` describe extremeness under a normal reference. Empirical percentile/tails describe rank in a declared historical sample. Neither is the probability of a price rise, target hit, or reversion.

The current AR coefficient is an AR(1)-through-origin sample diagnostic. It has no intercept, confidence interval, stationarity test, residual diagnostic, parameter-stability test, or out-of-sample calibration. Half-life is usable as a conditional path coordinate only when the fitted process passes all declared gates, including positive `rho`, `rho<1`, `isMeanReverting=true`, and `decayMode=monotonic-decay`. Negative rho is oscillatory decay, not the same trading thesis. Non-stationary estimates stay blocked.

`expectedSessions` and `expectedReturn*` assume the fitted decay continues with zero future shocks while the signal-day structural state is frozen. They are scenario-path projections, not forecasts, expected realized returns, or live sizing inputs; fixed monthly-session conversions are forbidden.

`orderPlan.signalStrength = 1 - twoSidedNormalTail(|z|)` is a normal-reference extremeness transform. It is not confidence, win probability, or calibrated edge. Profile-scaled risk budgets and notionals derived from it are simulation-only.

## Options and Volatility

- Historical realized volatility used by the stock screen must be labelled `historical-realized-scenario`; `isMarketIv=false`.
- `timeToExpirySessions` is the option contract's remaining tenor, not
  `formulaHorizonSessions`, an AR half-life, or a structural-repair period. The screen
  computes option scenarios only when `--option-tenor-sessions` is explicitly supplied;
  otherwise option values, Greeks, and Gamma PnL remain `null` with
  `claimClass=missing-input`.
- A blank or unknown option premium remains `null`. Explicit zero is a distinct value.
- `isMarketIv` must be verified from the input source and cannot be inferred safely from a descriptive string. Multi-leg templates are incomplete while any leg premium, quote, or contract input is missing.
- Model price is not entry cashflow. Without market quote/bid-ask, do not report executable PnL.
- Gamma PnL in the screen uses a unit-size, one-ATR scenario. It is not RMB portfolio PnL.
- A complete option promotion requires option-chain quotes, bid/ask and timestamp, contract multiplier, exercise/settlement rules, expiry/calendar, rates/dividends or carry, market IV/surface, transaction costs, and position/account inputs.

## LP, Fees, and Theta

- A real v3 inventory claim requires token order/decimals, current price, lower/upper ticks or prices, liquidity, and a timestamp/block-consistent position source.
- Aggregate pool quotes or a few quote points cannot establish real tick liquidity or a probability distribution.
- Fee tier is a rate, not revenue. Path fee income requires volume path, fee tier, position liquidity share, active liquidity, in-range state/fraction, and costs such as gas/rebalance.
- `estimateLpPathFees()` currently substitutes `inRangeFraction=1` when omitted. Such output remains a full-in-range `path-scenario`; it is not calibrated or realized fee income.
- Capital efficiency and IL cannot be added across dimensions. Use `lpResearchAttribution()` to keep geometry separate from same-horizon returns.
- The CK endpoint-ratio efficiency is valued at the range geometric midpoint, while the screen's normalized synthetic geometry compares current value with anchor value. Preserve `efficiencyValuationBasis` and never aggregate or rank them as if they shared one basis.
- The screen's `fullRangeV2IlProxyPct` is a constant-product v2 current-price-versus-anchor proxy. It does not consume the synthetic v3 range bounds. Never rename or interpret it as relative IL for that v3 range; a v3 claim needs same-range, same-capital entry and mark valuation.
- `fee ≈ theta` is an analogy, not an identity. Compare only after currency, notional, sign, and accrual horizon are aligned.
- A complete LP/market-making promotion additionally needs tick liquidity, position NFT state, fee growth or defensible volume attribution, gas/rebalance rules, hedge fills, funding settlement, latency/slippage, and liquidation constraints where leverage is used.

## Portfolio Ledger

Use one valuation ledger:

```text
PnL = current mark value - entry cashflow + realized cashflows - costs
```

LP PnL, option model price, hedge PnL, fee income, and funding cannot be summed unless currency, notional, sign, and horizon are aligned. Keep `scenarioTotal` separate. Formal `totalPnl` remains `null` while required entry cashflows, premiums, path fees, funding settlement, or valid LP range inputs are missing. After combining chain, quote, or leg results, recompute the status from the final union of `missingInputs`; never trust a status calculated before that merge.

## Execution Promotion Checklist

Before changing `research-only` or `calibration-required` to an executable conclusion, verify:

1. complete timestamped market inputs and identity
2. compatible units, currency, notional, sign, and horizon
3. account equity, margin/leverage, loss budget, and liquidation rules
4. bid/ask, depth/liquidity, fill model, fees/taxes, and slippage
5. settlement/exercise/rebalance rules
6. sensitivity and stress scenarios
7. out-of-sample or forward validation appropriate to the claim

If any item is absent, list it under `missingInputs` and keep the execution gate closed.
