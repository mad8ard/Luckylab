# Formula Reference

这份文档写公式本体。每个公式必须先有明确输入、输出、状态和边界，再进入 `src/domain/` 或图表。

## 变量命名边界

| Symbol  | Code field                                    | Meaning                                    |
| ------- | --------------------------------------------- | ------------------------------------------ |
| `S`     | `markPrice`                                   | 当前标的价格                               |
| `P`     | `entryPrice`                                  | GetDelta 入场价                            |
| `C`     | `costAnchor`                                  | 市场成本锚                                 |
| `K`     | `strikePrice`                                 | 期权行权价                                 |
| `S0`    | `startPrice`                                  | LP / hedge 建仓基准价                      |
| `T`     | `formulaHorizonSessions / tradingDaysPerYear` | 年化时间；公式周期必须有来源               |
| `sigma` | `marketIv` / `annualVol`                      | 年化波动率；市场 IV 与历史实现波动必须分开 |
| `d`     | `deltaSlope`                                  | GetDelta 局部斜率约束                      |
| `g`     | `exitTargetReturn`                            | 账户退出收益目标                           |
| `L`     | `liquidity`                                   | LP 流动性规模                              |
| `H`     | `hedgeSize`                                   | 线性对冲规模                               |

`d` 和 `g` 不能共用字段。`d` 进入 GetDelta；`g` 进入退出计划。

## 1. Path / Market Data

### Log return

```txt
r_t = ln(close_t / close_{t-1})
```

Inputs: `close_t`, `close_{t-1}`  
Outputs: `logReturn`  
Status: executable input  
Chart: 可用于波动率、回归和审计，不直接画主图。

### Typical price

```txt
typical_t = (high_t + low_t + close_t) / 3
```

Inputs: `high`, `low`, `close`  
Outputs: `typicalPrice`  
Status: executable input

### VWAP / equal-weight fallback

```txt
VWAP = sum(typical_t * volume_t) / sum(volume_t)
```

If all volumes are zero:

```txt
Cost_equal = average(typical_t)
```

Boundary: fallback 必须标注为等权 typical price，不能伪装成真实 VWAP。

## 2. Market Cost

### Rolling cost anchor

```txt
C_t = weightedTypicalCost(rows[t-window+1 ... t])
```

### Cost distance

```txt
costDistance_t = (close_t - C_t) / C_t
```

### Cost band

```txt
dailySigma = std(logReturn_window)
bandWidth = max(dailySigma * sqrt(recentWindow), minBand)
costLow_t = C_t * (1 - bandWidth)
costHigh_t = C_t * (1 + bandWidth)
```

Inputs: OHLCV window  
Outputs: `costAnchor`, `costLow`, `costHigh`, `costDistance`  
Status: executable  
Chart: 主图成本锚和上下沿。

## 3. Volatility / ATR

### Annualized volatility

```txt
sigma_ann = std(r_t) * sqrt(tradingDaysPerYear)
```

### True range

```txt
TR_t = max(
  high_t - low_t,
  abs(high_t - close_{t-1}),
  abs(low_t - close_{t-1})
)
```

### ATR percent

```txt
ATR_t = average(TR_window)
ATR%_t = ATR_t / close_t
```

Status: executable input  
Chart: 可作为 volatility 子图或状态，不直接给交易结论。

## 4. GetDelta Price Band

Source: blog / Desmos `943334771f`

### Time-wave term

```txt
e_T = sqrt(formulaHorizonSessions / (tradingDaysPerYear * 2 * pi))
a = sigma * e_T
```

Invalid when:

```txt
a >= 1
```

### Ratio

```txt
r_T = ((1 + a) / (1 - a))^2
```

Optional z scaling:

```txt
R = r_T * z
```

### Long band cost center

```txt
K_long = P * (d * R - d + 1)^2 / R
```

### Long band bounds

```txt
longHigh = K_long * R
longCost = K_long
longLow = K_long / R
```

### Short band

Current implementation mirrors with:

```txt
shortRatio = 1 / R
K_short = P * (d * shortRatio - d + 1)^2 / shortRatio
shortHigh = K_short / shortRatio
shortCost = K_short
shortLow = K_short * shortRatio
```

### Payoff curve used for local slope audit

Piecewise:

```txt
low = K / R
high = K * R

g(x) = x                                      if x <= low
g(x) = (2 * sqrt(x * K * R) - x - K) / (R-1) if low < x < high
g(x) = K                                      if x >= high
```

Slope inside range:

```txt
g'(x) = (sqrt(K * R / x) - 1) / (R - 1)
```

At `x = P`, expected:

```txt
g'(P) ~= d
```

Inputs: `entryPrice`, `formulaHorizonSessions`, `iv`, `deltaSlope`, `tradingDaysPerYear`
Outputs: `deltaLower`, `deltaCost`, `deltaUpper`, `localSlopeAtEntry`  
Status: executable price-band input  
Chart: 主图 GetDelta 上下沿和成本线。

## 5. Black-Scholes Vanilla Option

Source: Black and Scholes 1973

```txt
tau = timeToExpirySessions / tradingDaysPerYear
d1 = (ln(S/K) + (r - q + sigma^2/2) * tau) / (sigma * sqrt(tau))
d2 = d1 - sigma * sqrt(tau)
```

Call:

```txt
C = S * exp(-q*tau) * N(d1) - K * exp(-r*tau) * N(d2)
```

Put:

```txt
P_put = K * exp(-r*tau) * N(-d2) - S * exp(-q*tau) * N(-d1)
```

Delta:

```txt
Delta_call = exp(-q*tau) * N(d1)
Delta_put = exp(-q*tau) * (N(d1) - 1)
```

Gamma:

```txt
Gamma = exp(-q*tau) * n(d1) / (S * sigma * sqrt(tau))
```

Theta 的规范时间单位：

```txt
optionThetaAnnual = dV/dtau
optionThetaPerSession = optionThetaAnnual / tradingDaysPerYear
```

Vega:

```txt
Vega = S * exp(-q*tau) * n(d1) * sqrt(tau) / 100
```

Rho:

```txt
Rho_call = K * tau * exp(-r*tau) * N(d2) / 100
Rho_put = -K * tau * exp(-r*tau) * N(-d2) / 100
```

`timeToExpirySessions` is an independent option-expiry input. It must not be copied from the strategy recovery horizon; a real contract should derive it from valuation and expiry timestamps. `optionThetaPerSession` 是每交易会话，不是自然日；Vega/Rho 的规范字段分别为 `optionVegaPerPct`、`optionRhoPerPct`。Status: research-only unless a real option leg is configured.
Chart: Greeks 子图 `optionDelta`, `optionGamma`, `optionThetaPerSession`。

## 6. Bachelier / Normal Vol

Source: Bachelier 1900

```txt
tau = timeToExpirySessions / tradingDaysPerYear
std = normalVol * sqrt(tau)
d = (S - K) / std
discount = exp(-r * tau)
```

Call:

```txt
C = discount * ((S - K) * N(d) + std * n(d))
```

Put:

```txt
P = discount * ((K - S) * N(-d) + std * n(d))
```

Delta:

```txt
Delta_call = discount * N(d)
Delta_put = discount * (N(d) - 1)
```

Gamma:

```txt
Gamma = discount * n(d) / std
```

当前实现未给 Bachelier Theta/Rho，规范输出为 `null`。组合聚合必须传播该缺失，不能将其当作零敏感度。

Status: research-only payoff fit  
Chart: formula drawer / research panel only unless explicitly enabled.

## 7. Uniswap v2 Simplified LP Payoff

Source: blog LP risk map

```txt
V(S) = 2L * (sqrt(S) - sqrt(S0)) - H * (S - S0) + F
```

Derivative:

```txt
dV/dS = L / sqrt(S) - H
```

Neutral hedge near entry:

```txt
H = L / sqrt(S0)
```

Inputs: `markPrice`, `startPrice`, `liquidity`, `hedgeSize`, `feeIncomeQuote`

Outputs: `lpPnl`, `lpInventoryDeltaToken0=L/sqrt(markPrice)`, `netInventoryDeltaToken0=lpInventoryDeltaToken0-hedgeSize`, `neutralHedgeAtStart`。旧裸 `delta` 只允许作为带 `deprecated/legacyAliasOf` 的兼容别名。
Status: research-only simplification  
Chart: LP 子图。

## 8. Uniswap v3 Inventory

Source: Uniswap v3 whitepaper / Atis Elsts

Given:

```txt
sqrtP = sqrt(markPrice)
sqrtA = sqrt(lowerPrice)
sqrtB = sqrt(upperPrice)
```

When price below range:

```txt
token0 = L * (1/sqrtA - 1/sqrtB)
token1 = 0
```

When price above range:

```txt
token0 = 0
token1 = L * (sqrtB - sqrtA)
```

When price inside range:

```txt
token0 = L * (1/sqrtP - 1/sqrtB)
token1 = L * (sqrtP - sqrtA)
```

Value:

```txt
lpValue = token0 * markPrice + token1
inventoryDeltaToken0 = token0
normalizedDelta = token0 * markPrice / lpValue
```

Real v3 hedged PnL must use actual `lowerPrice` and `upperPrice`:

```txt
lpPnl = value(markPrice, lowerPrice, upperPrice, L)
      - value(startPrice, lowerPrice, upperPrice, L)
hedgePnl = -H * (markPrice - startPrice)
combined = lpPnl + hedgePnl + feeIncomeQuote
```

`feeIncomeQuote` is a quote-currency amount. `feeTierFraction` is a rate and
must never be passed through the same field. The current migration is tracked
by E-003 in `ERRATA.md`.

Status: protocol math; research-only until real LP position exists  
Chart: LP 子图 and LP range on main chart.

## 9. Full-range v2 Impermanent Loss Proxy

Classic v2 ratio form:

```txt
priceRatio = Pt / P0
fullRangeV2IlProxy = 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
```

Current inventory-value form:

```txt
lpValue = 2L * sqrt(Pt)
holdValue = L * sqrt(P0) + (L / sqrt(P0)) * Pt
fullRangeV2IlProxy = (lpValue - holdValue) / holdValue
```

This does not consume a v3 lower/upper range. A v3 claim requires the same
range, same entry inventory and same initial capital for LP and HODL. The
generic implementation-name correction is tracked by E-008.

Status: research risk label  
Chart: LP pane or formula panel.

## 10. Liquidity Fingerprint

Asymmetric Laplace:

```txt
s = sign(x - mu)
f_laplace(x) = (lambda / (kappa + 1/kappa))
              * exp(-(x - mu) * lambda * s * kappa^s)
```

Equivalent implementation branch:

```txt
if x >= mu:
  f = norm * exp(-abs(x-mu) * lambda * kappa)
else:
  f = norm * exp(-abs(x-mu) * lambda / kappa)
```

Log-Laplace:

```txt
f_logLaplace(price) = f_laplace(ln(price)) / price
```

Hybrid fingerprint mixture:

```txt
sessionVolatility = annualVolatility / sqrt(tradingDaysPerYear)
sigma = max(declaredMinimum, declaredScale * sessionVolatility)

components = {
  base: f_logLaplace(price),
  active: Normal(ln(price); ln(activePrice), sigma),
  cost: Normal(ln(price); ln(costAnchor), 1.35*sigma),
  orders: sum_j sqrt(notional_j/maxNotional) * Normal(ln(price); ln(orderPrice_j), 0.7*sigma),
  range: 1 if price in [rangeLow, rangeHigh], else normal-decay outside range
}

f_component_norm_c(price) = weight_c * f_c(price) / integral(lower, upper, f_c)
f_fingerprint(price) = sum_c f_component_norm_c(price) / sum_c weight_c
```

`annualVolatility` 和 `tradingDaysPerYear` 必须显式输入；缺任一项即返回 `missing-input/null`，不得静默使用 35% 或 365。

Segment weight:

```txt
weight_i = integral(lower_i, upper_i, f_fingerprint) / integral(lower, upper, f_fingerprint)
componentMass_i,c = integral(lower_i, upper_i, f_component_norm_c)
dominantComponent_i = argmax_c(componentMass_i,c)
entropy = -sum_i(weight_i * ln(weight_i)) / ln(segmentCount)
```

Status: research-only target distribution  
Chart: liquidity rack / LP pane. `inputMode=model-only` when only base distribution exists; `hybrid-model` when cost/price/range/order components are present. Still not market depth, real ticks, or wallet LP NFT composition.

## 11. CK Capital Efficiency

Source: CK Part 1 / Part 2 and their Desmos derivations. The skewed equation is
also published by CK; estimating `ckSkewAlpha` from market data is the project
extension.

```txt
lower = 1 - rangeWidth
upper = 1 + skew * rangeWidth
CE = 1 / (1 - (lower / upper)^(1/4))
```

The endpoint-ratio CE is valued at the range geometric midpoint. If the
arithmetic reference is an actual mark price, compute the mark-price CE
separately:

```txt
CE_at_mark = 2 / (2 - sqrt(mark/upperPrice) - sqrt(lowerPrice/mark))
```

Symmetric frontier:

```txt
CE''(x)=0
<=> 256*x^4 - 160*x^2 - 15 = 0
x* = sqrt(5+2*sqrt(10))/4
```

Skew frontier with `alpha=skew` and
`u=((1-x)/(1+alpha*x))^(1/4)`:

```txt
3*alpha*u^5 - 5*alpha*u^4 - 5*u + 3 = 0
x = (1-u^4)/(1+alpha*u^4)
```

This is an exact equation under CK's marginal capital-efficiency objective.
Numerical root solving is a numerical representation of that exact condition,
not an empirical fit. At `alpha=0`, `u=3/5` and `x=0.8704`; `0.875` is not the
exact CK result.

`0.875` does have a separate exact meaning in the conditional half-life model:
`recoveryFraction(H)=1-2^(-H/halfLifeSessions)`, so an explicitly selected
`H=3*halfLifeSessions` gives `7/8`. That identity neither calibrates an
instrument-specific recovery target nor changes the CK skew solution above.

Status: research-only range geometry. It is not probability coverage, a fee
optimum, a PnL optimum, or an executable target.

Chart: LP / efficiency pane.

## 12. Funding Proxy

Current proxy:

```txt
basisFraction = perpTwap / spotTwap - 1
cumulativeFundingProxy = basisFraction * (hours / 24)
```

Boundary:

```txt
status = proxy-only
missing = exchange schedule, clamp/cap, settlement history
```

Net carry must bind the recovery side, funding-position side, start notional and
the same declared horizon before comparison:

```txt
longGrossRecoveryReturn = targetPrice/cycleStartPrice - 1
shortGrossRecoveryReturn = (cycleStartPrice-targetPrice)/cycleStartPrice
fundingCashflowReturn = fundingPositionSide == long
  ? -cumulativeFundingProxy
  : cumulativeFundingProxy
fundingNetCostReturn = -fundingCashflowReturn
netCarry = grossRecoveryReturn + fundingCashflowReturn
breakEvenFundingNetCostReturn = grossRecoveryReturn
```

The break-even field is a net-cost threshold on the same cycle-start notional;
it is neither the raw funding proxy nor the already observed funding drag. The
comparison is invalid unless recovery and funding notional bases match and the
declared session-to-hour mapping reproduces `fundingHorizonHours`. Do not
multiply the cumulative estimate by any horizon factor again.

The proxy never becomes a settlement cashflow by multiplying it by total
capital. Portfolio accounting accepts only a signed `fundingCashflowQuote`
(positive receipt, negative payment) with `observed-settlement` or
`explicit-scenario` provenance; only the first can satisfy the formal ledger.

## 13. Portfolio Research

Research composition:

```txt
PnL(S, path) = LP_PnL(S)
             + Option_PnL(S)
             + Hedge_PnL(S)
             + RealizedFees(path)
             + FundingCashflow(path)  // positive receipt, negative payment
             - Costs(path)
```

Each leg uses a ledger shape: `mark`, `entryCashflow`, `pnl`, `currency`, `notional` and `horizon`. The scenario curve may expose known components, but formal `totalPnl` stays `null` until option premium, path fees, funding settlement and costs share the same basis.

Current scenario curve form:

```txt
scenarioTotal(S) = sum(known leg PnL components)
formalTotalPnl(S) = null while required ledger inputs are missing
```

Status: research-only until leg lifecycle exists  
Missing: option expiry, LP rebalance, fee accrual, funding settlement, hedge adjust.

## 14. Deviation Score

```txt
periodVol = annualVol * sqrt(formulaHorizonSessions / tradingDaysPerYear)
z = costDistance / periodVol
deviationPercentile = 2 * Phi(abs(z)) - 1
twoSidedTailProbability = 2 * (1 - Phi(abs(z)))
```

Status: descriptive distribution reference
Boundary: both outputs describe the extremeness of the observed deviation. Neither estimates `P(future reversion | current state)` and neither may independently upgrade an execution state.

`orderPlan.signalStrength` reuses `deviationPercentile`. It is therefore a normal-reference extremeness coordinate, not confidence, win probability, or calibrated edge. Any profile-scaled risk budget, notional, or `expectedProfit` produced from it is a simulation scenario, not an executable position recommendation.

## 15. Mean Reversion Half-Life

AR(1):

```txt
x_t = rho * x_{t-1} + epsilon_t
theta = -ln(abs(rho))
halfLife = ln(2) / theta
```

The implementation reports the raw through-origin AR(1) coefficient. The half-life is defined only for `abs(rho) < 1`; a negative coefficient is an oscillating decay, while `abs(rho) >= 1` is non-stationary and returns no half-life. Only `0 < rho < 1` with `decayMode=monotonic-decay` may enter dynamic holding. There is no intercept, confidence interval, residual diagnostic, parameter-stability gate, or holdout calibration, so this remains a sample diagnostic.

Dynamic-holding `expectedSessions` and `expectedReturn*` assume zero future shocks and a frozen signal-day structure. They are conditional path projections rather than expected realized returns or holding-time forecasts; no fixed monthly-session conversion is produced.

## 16. Gamma PnL

```txt
positionGamma = gamma * positionSize
dollarGamma = positionGamma * markPrice^2
gammaPnl = 0.5 * positionGamma * priceChange^2
         = 0.5 * dollarGamma * (priceChange / markPrice)^2
```

`positionGamma` uses absolute price changes. `dollarGamma` uses relative returns and requires `markPrice`; it is not interchangeable with position Gamma. Status: research-only convexity estimate.

## 17. Volatility Confidence

```txt
SE_sigma = sigma / sqrt(2n)
CI_low = max(0, sigma - z * SE_sigma)
CI_high = sigma + z * SE_sigma
relativeUncertainty = SE_sigma / sigma
z = inverseNormalCdf((1 + confidenceLevel) / 2)
```

The standard-error approximation assumes normally distributed returns. Precision labels use fixed relative-SE thresholds (`<=10%`, `<=20%`, `<=30%`, otherwise unreliable), so the label changes with sample size instead of comparing the error with itself. Status: research-only uncertainty label.
