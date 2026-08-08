# Formula Reference

这份文档写公式本体。每个公式必须先有明确输入、输出、状态和边界，再进入 `src/domain/` 或图表。

## 变量命名边界

| Symbol  | Code field                         | Meaning               |
| ------- | ---------------------------------- | --------------------- |
| `S`     | `markPrice`                        | 当前标的价格          |
| `P`     | `entryPrice`                       | GetDelta 入场价       |
| `C`     | `costAnchor`                       | 市场成本锚            |
| `K`     | `strikePrice`                      | 期权行权价            |
| `S0`    | `startPrice`                       | LP / hedge 建仓基准价 |
| `T`     | `holdingDays / tradingDaysPerYear` | 年化时间              |
| `sigma` | `iv` / `annualVol`                 | 年化波动率            |
| `d`     | `deltaSlope`                       | GetDelta 局部斜率约束 |
| `g`     | `exitTargetReturn`                 | 账户退出收益目标      |
| `L`     | `liquidity`                        | LP 流动性规模         |
| `H`     | `hedgeSize`                        | 线性对冲规模          |

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
e_T = sqrt(T_days / (tradingDaysPerYear * 2 * pi))
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

Inputs: `entryPrice`, `holdingDays`, `iv`, `deltaSlope`, `tradingDaysPerYear`  
Outputs: `deltaLower`, `deltaCost`, `deltaUpper`, `localSlopeAtEntry`  
Status: executable price-band input  
Chart: 主图 GetDelta 上下沿和成本线。

## 5. Black-Scholes Vanilla Option

Source: Black and Scholes 1973

```txt
tau = holdingDays / tradingDaysPerYear
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

Vega:

```txt
Vega = S * exp(-q*tau) * n(d1) * sqrt(tau) / 100
```

Rho:

```txt
Rho_call = K * tau * exp(-r*tau) * N(d2) / 100
Rho_put = -K * tau * exp(-r*tau) * N(-d2) / 100
```

Status: research-only unless real option leg is configured  
Chart: Greeks 子图 `optionDelta`, `optionGamma`, `optionThetaDaily`。

## 6. Bachelier / Normal Vol

Source: Bachelier 1900

```txt
tau = holdingDays / tradingDaysPerYear
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

Inputs: `markPrice`, `startPrice`, `liquidity`, `hedgeSize`, `fees`  
Outputs: `lpPnl`, `inventoryDelta`, `neutralHedgeAtStart`  
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
inventoryDelta = token0
normalizedDelta = token0 * markPrice / lpValue
```

Real v3 hedged PnL must use actual `lowerPrice` and `upperPrice`:

```txt
lpPnl = value(markPrice, lowerPrice, upperPrice, L)
      - value(startPrice, lowerPrice, upperPrice, L)
hedgePnl = -H * (markPrice - startPrice)
combined = lpPnl + hedgePnl + fees
```

Status: protocol math; research-only until real LP position exists  
Chart: LP 子图 and LP range on main chart.

## 9. Impermanent Loss

Classic v2 ratio form:

```txt
priceRatio = Pt / P0
IL = 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
```

Current inventory-value form:

```txt
lpValue = 2L * sqrt(Pt)
holdValue = L * sqrt(P0) + (L / sqrt(P0)) * Pt
IL = (lpValue - holdValue) / holdValue
```

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
f_logLaplace(price) = f_laplace(ln(price))
```

Hybrid fingerprint mixture:

```txt
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

Segment weight:

```txt
weight_i = integral(lower_i, upper_i, f_fingerprint) / integral(lower, upper, f_fingerprint)
componentMass_i,c = integral(lower_i, upper_i, f_component_norm_c)
dominantComponent_i = argmax_c(componentMass_i,c)
entropy = -sum_i(weight_i * ln(weight_i)) / ln(segmentCount)
```

Status: research-only target distribution  
Chart: liquidity rack / LP pane. `inputMode=model-only` when only base distribution exists; `hybrid-model` when cost/price/range/order components are present. Still not market depth, real ticks, or wallet LP NFT composition.

## 11. Capital Efficiency

Source: Hayden / Lambert style range geometry

```txt
lower = 1 - rangeWidth
upper = 1 + skew * rangeWidth
CE = 1 / (1 - (lower / upper)^(1/4))
```

Frontier slope approximation:

```txt
slope = abs(
  (-skew - 1) /
  (4 * (upper^(1/4) - lower^(1/4))^2 * lower^(3/4) * upper^(3/4))
)
```

Status: research-only range geometry  
Chart: LP / efficiency pane.

## 12. Funding Proxy

Current proxy:

```txt
basisEstimate = perpTwap / spotTwap - 1
cumulativeFundingEstimate = basisEstimate * (hours / 24)
```

Boundary:

```txt
status = proxy-only
missing = exchange schedule, clamp/cap, settlement history
```

Net carry must consume the same-period cumulative proxy:

```txt
fundingCost = abs(cumulativeFundingEstimate)
netCarry = abs(costDistance) - fundingCost
breakEven = fundingCost
```

Do not multiply the cumulative estimate by `holdingDays / tradingDaysPerYear` again.

## 13. Portfolio Research

Research composition:

```txt
Portfolio(S) = LP(S) + Option(S) + Hedge(S) + Fees - Funding
```

Current curve form:

```txt
combined(S) = lpPnl(S)
            + optionWeight * optionValue(S)
            + hedgePnl(S)
            + fees
            - fundingCost
```

Status: research-only until leg lifecycle exists  
Missing: option expiry, LP rebalance, fee accrual, funding settlement, hedge adjust.

## 14. Deviation Score

```txt
periodVol = annualVol * sqrt(holdingDays / tradingDaysPerYear)
z = costDistance / periodVol
regressionProbProxy = Phi(abs(z))
```

Status: executable filter / heuristic  
Boundary: it is signal strength, not a probability guarantee.

## 15. Mean Reversion Half-Life

AR(1):

```txt
x_t = rho * x_{t-1} + epsilon_t
theta = -ln(abs(rho))
halfLife = ln(2) / theta
```

The implementation reports the raw through-origin AR(1) coefficient. The half-life is defined only for `abs(rho) < 1`; a negative coefficient is an oscillating decay, while `abs(rho) >= 1` is non-stationary and returns no half-life. Status: research-only speed estimate.

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
