# Market Lab 公式语义契约

这份文档是公式的人类可读契约；机器事实源是 [`formula-semantic-registry.json`](./formula-semantic-registry.json)，已知错误和修复进度见 [`ERRATA.md`](./ERRATA.md)，函数级索引见 [`formula-inventory.md`](./formula-inventory.md)。

本契约的核心不是“多列公式”，而是确保任何输出都能回答：**算的是什么、什么时候知道、在哪些条件下成立、能推出什么、绝不能推出什么**。

## 1. 四层判定，禁止跨层升级

| 层     | 问题                                     | 例子                                                     |
| ------ | ---------------------------------------- | -------------------------------------------------------- |
| 数学层 | 公式在定义和假设下是否成立？             | CK 拐点、v3 库存、BSM 价格是条件恒等式                   |
| 输入层 | 输入是观测、样本估计、校准估计还是情景？ | 历史 realized sigma 是 sample estimate，不是 market IV   |
| 结果层 | 本次输出属于哪一 claim class？           | 样本 alpha 代入精确 CK 几何，应用结果仍是 scenario proxy |
| 权限层 | 产品和执行能否消费？                     | research-only 公式不能绕过 OrderPlan 门禁                |

允许的 claim class 只有：

- `exact-identity`：在明确变量和条件下的代数、协议或会计恒等式。
- `sample-estimate`：来自声明样本，但没有充分持出、稳定性或覆盖验证。
- `calibrated-estimate`：有目标标签、校准方法、不确定性、失效门禁和持出/前向证据。
- `scenario-proxy`：假设输入下的确定性情景结果，不是市场观测或预测。
- `missing-input`：诚实计算所需输入缺失。

一个 exact formula 不会自动产生 exact market conclusion。例如：CK 方程是 exact identity，但历史涨跌幅估出的 `ckSkewAlpha` 是 sample estimate，把它代回 CK 后只是 scenario proxy。

## 2. 规范变量表

短符号只允许出现在局部公式中。跨模块、JSON、store、UI 和报告必须使用规范字段。

| 局部符号     | 规范字段                 | 单位                     | 唯一含义                                    | 禁止混用                                  |
| ------------ | ------------------------ | ------------------------ | ------------------------------------------- | ----------------------------------------- |
| `S`          | `markPrice`              | quote/base               | 当前标的或池价格                            | `entryPrice`、`strikePrice`               |
| `P`          | `entryPrice`             | quote/base               | GetDelta 或交易情景入场坐标                 | `markPrice`、`costAnchor`                 |
| `C`          | `costAnchor`             | quote/base               | 前缀成交路径成本锚                          | 账户真实成本、做市商成本                  |
| `K`          | `strikePrice`            | quote/base               | 期权行权价或明确 payoff 参数                | LP 建仓基准                               |
| `S0`         | `startPrice`             | quote/base               | LP/对冲估值起点                             | `entryPrice`                              |
| `T`          | `formulaHorizonSessions` | sessions                 | 公式推导周期                                | 隐藏 30/60/90 默认                        |
| `T_exp`      | `timeToExpirySessions`   | sessions                 | 期权合约自身的剩余交易会话数                | 修复周期、AR 半衰期                       |
| `tau`        | `timeToExpiryYears`      | years                    | `timeToExpirySessions/tradingDaysPerYear`   | 修复周期、未换算的交易会话数              |
| `sigma`      | `annualVol` / `marketIv` | annual fraction          | 年化波动率，来源必须分开                    | 未标来源的 `iv`                           |
| `d`          | `deltaSlope`             | fraction                 | GetDelta 入场处局部 payoff 斜率             | `exitTargetReturn`                        |
| `rho_AR`     | `arCoefficient`          | dimensionless            | AR(1) 样本系数                              | option Rho                                |
| `theta_AR`   | `arDecayRatePerStep`     | 1/session                | AR 衰减率                                   | option Theta                              |
| `Theta_opt`  | `optionThetaPerSession`  | currency/trading-session | 期权模型每交易会话时间敏感度                | 自然日 Theta、AR 衰减率、费用收入         |
| `Delta_opt`  | `optionDelta`            | underlying units         | 期权 Delta                                  | GetDelta `deltaSlope`、LP inventory delta |
| `Gamma_opt`  | `optionGamma`            | underlying units/price   | 期权 Delta 对标的价格的一阶变化             | LP 曲率、Dollar Gamma                     |
| `Vega_opt`   | `optionVegaPerPct`       | currency/vol-point       | 年化波动率变化 1 个百分点的模型价值变化     | normal-vol Vega、未除以 100 的 Vega       |
| `Rho_opt`    | `optionRhoPerPct`        | currency/rate-point      | 年化无风险利率变化 1 个百分点的模型价值变化 | AR coefficient                            |
| `Delta_LP`   | `inventoryDeltaToken0`   | token0                   | v3 价值对价格的一阶库存敏感度               | 期权 Delta                                |
| `q_recovery` | `recoveryFraction`       | fraction                 | 目标修复距离占起点至锚点差距比例            | CK 端点根                                 |
| `side_H`     | `horizonSide`            | enum                     | 结构周期的 long/short 方向                  | 订单方向的隐式推断                        |
| `P_H`        | `horizonTargetPrice`     | quote/base               | 本次周期代数实际到达的冻结终点              | OrderPlan 的其他退出目标                  |
| `u_CK`       | `endpointFourthRoot`     | dimensionless            | CK 端点价格比的四次方根                     | 修复比例                                  |
| `alpha_CK`   | `ckSkewAlpha`            | dimensionless            | CK 上行/下行算术宽度比                      | 做市商方向参数                            |
| `F_quote`    | `feeIncomeQuote`         | quote currency           | 已归属到头寸的手续费金额                    | `feeTierFraction`                         |
| `g_exit`     | `exitTargetReturn`       | fraction                 | 仓位退出的情景收益目标                      | profile 门槛、固定情景目标                |
| `g_min`      | `minimumGrossReturn`     | fraction                 | profile 接受结构目标的最低毛收益            | 退出目标                                  |
| `g_fixed`    | `fixedTargetReturn`      | fraction                 | 显式固定情景的目标收益                      | 公式推导目标                              |

### 绝对禁止的兼容语义

- 不再允许 `targetReturn -> deltaSlope`。
- 不再允许裸 `q` 同时表示 recovery fraction 和 CK endpoint root。
- 不再允许裸 `theta` 同时表示 AR decay 和 option Theta。
- 不再允许裸 `rho` 同时表示 AR coefficient 和 option Rho。
- 不再允许 `fees` 在一个函数里是 fraction、另一个函数里是 quote amount。
- 不再允许 `impermanentLoss` 不说明 v2/v3、范围和对照资产。
- 不再允许一个 long/costLower 周期驱动 short 侧信号，或驱动另一个 targetPrice 的到期。
- 不再允许 `targetReturn` 同时表示退出目标、profile 门槛和固定情景目标。
- 不再允许期权 `timeToExpirySessions` 从修复周期、AR 半衰期或任意固定 30/60/90 回退。
- 不再允许把缺失的 `feeIncomeQuote` 当作零费用收入。
- 不再允许把未实现或缺失的 Greek 经 `?? 0` 改写成零敏感度。
- 不再允许用 `tradingDaysPerYear` 换算后却把每交易会话 Theta 标成“自然日 Theta”。
- 不再允许流动性模型在波动率或 `tradingDaysPerYear` 缺失时静默注入 35% 或 365。

## 3. 时间、窗口与未来数据契约

### 3.1 前缀不变性

任何历史索引 `t` 的 query 必须满足：

```text
F(rows[0..t]) == F(rows[0..T])[t]    for every T >= t
```

其中窗口也是 `rows[0..t]` 的函数。用最终 `rows.length` 为所有历史点选择窗口会产生未来泄漏，即使计算公式本身没有显式读取未来价格。

### 3.2 日线可知时点

```text
T close     : T 日 OHLCV、成本锚、结构目标和前缀样本估计可知
T+1 open    : 下一交易日开盘价首次可知
path after  : 触达、实现费用、再平衡成本、实际等待逐步可知
```

历史回放可用真实 T+1 open 模拟填充，但必须写 `availableAt=T+1:open`，不能把它作为 T close 的已知预测参数。

### 3.3 周期来源

优先顺序只有两种合法模式：

1. `formula-derived`：由当时可见前缀、冻结结构目标和公式得到。
2. `explicit-scenario`：用户明确选择的压力测试期限，必须携带来源和标签。

缺周期时返回 `missing-input`。30、60、90、5、10 等数字可用于测试夹具或显式情景，但不得作为隐藏默认、持有期下限或全市场上限。

### 3.4 周期方向、终点和实际起点绑定

每个公式周期都必须携带下列完整上下文：

```text
horizonSide
cycleStartPrice
costAnchor
horizonTargetPrice
horizonTargetSource
frozenAt
availableAt
```

周期只能被同方向、同终点的 query 消费。例如，long 侧从折价起点修复到 `costLower` 的周期，不能直接当成到 `costAnchor` 的周期，也不能被上侧 sell 信号使用。终点或方向不同时必须重算；没有对应模型则返回 `missing-input`。

如果交易在 T+1 才成交，T 收盘的 horizon 只是 signal-context 研究值。真正进入回放的 q/H 必须在 fill 后以实际成交价重算。

### 3.5 Replay 前缀不变性

前缀不变性同样约束 replay warmup、eligible set 和起始索引。不得用最终 `rows.length` 选择历史起点。合法的 warmup 必须是逐点样本充足条件，或事前冻结、可追溯的 calibration split。外部注入的 `marketStates` 只校验数组长度不够；只有 canonical 前缀构建器生成、provenance fingerprint 与内容仍匹配的路径可以复用，否则内部重算。

### 3.6 Replay 批次、K 线内成交与收益分母

- 每次买入形成独立 lot，并冻结该批次的 `targetPrice`、`stopPrice`、`formulaHorizonSessions`、`horizonBinding`、`expiresAt` 与 `eligibleExitIndex`。组合加仓不得用均价目标或最大到期日覆盖旧批次。
- 新 fill 使用同一根日线的完整 high/low 会混入成交前路径，因此日线引擎显式采用 `defer-to-next-complete-bar-after-fill`；这不是港股/美股的结算规则，T+0 日内路径需要分钟级引擎。
- 开盘已经越过目标/止损时，开盘是最早已知事件，先按 open 成交；只有开盘位于两阈值之间而同一根 K 线随后同时触及时，才采用 `open-gap-first-then-stop-first-when-intrabar-order-unknown`。
- 非跳空的盘中首次触及按阈值成交。这仍是日线代理，不是逐笔成交证明。
- `returnOnUsedNotional = totalPnl / peakOpenCostBasis`。成交额 `totalNotional` 只描述换手，不能作为投入资本分母。

### 3.7 可视窗口与历史结果来源

成交量价格分布在未给显式 viewport 时消费截至当前时点的完整可见前缀；显式 viewport 才能截取窗口，并输出 `windowSpec.mode`、`visiblePrefixRows`、`requestedWindowSessions`、`appliedRows` 与 `futureRowsUsed=false`。历史 screen/replay 结果的 freshness、rows、dataThrough 和 candidateStatus 也必须来自该历史信号前缀，不能读取最终数据集元数据。

数据质量分显式拆成三个可观察分量：

```text
freshnessScore = staleDays<=10 ? 5 : 0
evidenceDepthScore = min(3,max(0,floor(log2(max(totalRows/minimumRequiredRows,1)))))
annualCoverageScore = min(2,max(0,floor(sqrt(totalRows/tradingDaysPerYear))))
score = freshnessScore + evidenceDepthScore + annualCoverageScore
```

这里的 10 是数据新鲜度产品阈值，不是持有期。`staleDays>10` 后该分量已经为零，不再保留无效的 `>30` 二次扣分。

## 4. 公式总表

| Formula ID                                 | 使用场景                      | 数学/结果类别                           | 产品状态         | 周期模式               | 执行权限   |
| ------------------------------------------ | ----------------------------- | --------------------------------------- | ---------------- | ---------------------- | ---------- |
| `market.cost-prefix-state`                 | 成本结构、动态目标            | exact aggregation / sample estimate     | production query | formula-derived window | gate input |
| `market.trading-days-per-year`             | 年化换算                      | model convention / scenario proxy       | production query | none                   | gate input |
| `volatility.realized-log-return`           | 波动尺度、研究 sigma          | exact scaling / sample estimate         | production query | formula-derived window | gate input |
| `volatility.iid-normal-confidence`         | 波动率样本不确定性近似        | approximate estimator / sample estimate | research-only    | none                   | none       |
| `getdelta.local-price-band`                | 局部斜率价格带                | exact model / scenario proxy            | production query | formula-derived        | plan query |
| `mean-reversion.ar1-half-life`             | 条件衰减尺度                  | exact transform / sample estimate       | production query | formula-derived        | gate input |
| `holding.structural-recovery-cycle`        | 每标的动态周期                | exact transform / scenario proxy        | production query | formula-derived        | gate input |
| `holding.no-hidden-fixed-horizon`          | 禁止隐藏固定持有期            | governance identity / missing input     | production query | formula-derived        | gate input |
| `holding.side-target-horizon-binding`      | 防止周期跨方向/跨终点复用     | governance identity / missing input     | production query | formula-derived        | gate input |
| `replay.actual-fill-horizon`               | T+1 fill 后重算 q/H           | exact timing rule / scenario proxy      | production query | formula-derived        | none       |
| `replay.prefix-causal-warmup`              | 回放起点与 eligible set       | governance identity / missing input     | production query | formula-derived        | none       |
| `replay.lot-specific-exit-binding`         | 每批仓位独立目标、失效与到期  | accounting identity                     | production query | formula-derived        | none       |
| `replay.ohlc-intrabar-policy`              | 日线内目标/止损冲突与跳空成交 | explicit scenario policy                | research-only    | path-observed          | none       |
| `replay.used-notional-return`              | 峰值占用本金收益率            | accounting identity                     | research-only    | path-observed          | none       |
| `market.adaptive-drawdown-features`        | 自适应回撤速度与阶段          | exact transform / sample estimate       | production query | formula-derived window | gate input |
| `market.volume-profile-prefix-window`      | 成交量价格分布可见窗口        | exact aggregation / scenario proxy      | research-only    | path-observed          | none       |
| `data.historical-signal-prefix-provenance` | 历史结果 freshness 与来源     | governance identity / missing input     | production query | path-observed          | none       |
| `data.freshness-evidence-score`            | 新鲜度与证据深度可解释评分    | exact rule / scenario proxy             | production query | none                   | none       |
| `option.black-scholes-greeks`              | 期权研究和 Greeks             | exact model / scenario proxy            | research-only    | expiry-derived         | none       |
| `lp.uniswap-v3-inventory`                  | v3 库存、LP Delta             | protocol identity / scenario proxy      | research-only    | none                   | none       |
| `lp.fee-income-quote`                      | 路径费用、组合台账            | cashflow identity / missing input       | research-only    | path-observed          | none       |
| `lp.impermanent-loss-v2`                   | v2 形状比较                   | exact identity / scenario proxy         | research-only    | same-horizon           | none       |
| `lp.impermanent-loss-v3-range`             | v3 同区间 IL                  | specified identity / missing input      | research-only    | same-horizon           | none       |
| `lp.il-attribution-model-basis`            | IL 模型与对照基准门禁         | accounting identity / missing input     | research-only    | same-horizon           | none       |
| `ck.capital-efficiency-symmetric-frontier` | CK 对称几何                   | exact identity                          | research-only    | none                   | none       |
| `ck.capital-efficiency-skew-frontier`      | CK 偏斜几何                   | exact law / scenario application        | research-only    | none                   | none       |
| `liquidity.fingerprint-model-mass`         | 流动性形状                    | exact normalization / scenario proxy    | research-only    | none                   | none       |
| `funding.basis-cumulative-proxy`           | carry 情景                    | exact arithmetic / scenario proxy       | proxy-only       | same-horizon           | none       |
| `semantics.exit-target-return`             | 退出目标、门槛与固定情景分离  | governance identity / scenario proxy    | production query | explicit-scenario      | gate input |
| `semantics.canonical-alias-migration`      | AR/Funding/退出字段迁移       | governance identity / missing input     | production query | none                   | none       |
| `economics.fee-theta-comparison`           | 风险经济类比                  | scenario proxy                          | research-only    | same-horizon           | none       |
| `deviation.extremeness-not-probability`    | 极端度与尾部                  | exact transform / sample estimate       | production query | formula-derived        | gate input |
| `recurrence.empirical-radius-rank`         | 状态稀有度                    | exact rank / sample estimate            | research-only    | none                   | none       |
| `recurrence.kaplan-meier-return-wait`      | 复现等待分布                  | exact estimator / sample estimate       | research-only    | path-observed          | none       |
| `portfolio.single-ledger-pnl`              | 组合损益归因                  | accounting identity / missing input     | research-only    | same-horizon           | none       |
| `governance.pine-single-canonical`         | Pine 单一权威与旧脚本隔离     | governance identity                     | production query | none                   | none       |
| `governance.semantic-evidence-audit`       | 勘误、来源、路径与状态防假绿  | governance identity                     | production query | none                   | none       |

`plan query` 也不等于 executable order。OrderPlan 仍须通过数据、账户、风险、流动性、结算和成本门禁。

## 5. 市场成本与波动

### 5.1 成本锚

```text
typical_i = (high_i + low_i + close_i) / 3
costAnchor_t = sum(typical_i * volume_i) / sum(volume_i)
costDistance_t = (close_t - costAnchor_t) / costAnchor_t
```

若窗口内所有成交量为零，只允许显式退化为 `equal-weight typical mean`。

- 使用：样本成交重心、成本带、动态目标的结构锚。
- 意义：描述数据样本的量价聚合中心。
- 范围：价格必须为正；`costDistance` 可正可负。
- 约束：窗口因果、数据源成交量口径可见、零量回退可见。
- 成因：成交量较大的价格区间对聚合中心贡献更大。
- 可推出：当前价相对该样本锚的位置。
- 不能推出：真实做市商成本、机构仓位、未来价格回归。

### 5.2 实现波动率与 ATR

```text
r_t = ln(close_t / close_(t-1))
annualVol = std(r_window) * sqrt(tradingDaysPerYear)

TR_t = max(high-low, abs(high-prevClose), abs(low-prevClose))
ATR = mean(TR_window)
ATR% = ATR / close
```

- 使用：历史波动状态、GetDelta/期权研究情景、偏离标准化。
- 意义：样本历史离散程度和价格区间尺度。
- 范围：正价格；样本量必须输出。
- 约束：A/H 年化基准 242、美股 252、加密 365；未知市场返回 `missing-input`。数值只来自 `inferTdpy`、按 symbol 的可追溯覆盖或显式情景。下游缺失时不得用 `||365` 重猜；精确到期另用交易所日历。
- 成因：历史价格变动的样本统计。
- 可推出：同口径下历史波动相对大小。
- 不能推出：未来波动、market IV、正态性、可成交期权价格。

`volConfidence` 是另一条独立公式，不属于 realized-vol 年化恒等式：

```text
standardErrorApprox = annualVol / sqrt(2 * sampleSize)
nominalInterval = annualVol +/- z(confidenceLevel) * standardErrorApprox
```

- 使用：给历史波动样本估计附加一个可见的不确定性尺度。
- 意义：仅在 IID、近似正态收益和局部常波动假设下的渐近近似。
- 范围：`annualVol>0`、`sampleSize>=5`、`0<confidenceLevel<1`；下界截断为 0。
- 约束：输出必须同时披露 `assumptions`、样本量、名义水平和 `isRobustConfidenceInterval=false`。
- 成因：正态样本标准差的渐近抽样误差近似。
- 可推出：在声明假设内，估计值对有限样本误差的大致敏感度。
- 不能推出：厚尾、自相关或波动聚类下的稳健覆盖率、未来波动区间或胜率。需要这些结论时，必须另做 block bootstrap、HAC 或波动模型校准。

### 5.3 自适应市场与回撤特征

```text
windowSpec_t = W(rows[0..t].length)
drawdownDepth_t = close_t / prefixPeak_t - 1
drawdownSpeedFast_t = drawdownDepth_t - drawdownDepth_(t-fastLag_t)
drawdownSpeedSlow_t = drawdownDepth_t - drawdownDepth_(t-slowLag_t)
```

- 使用：成本斜率、动量、回撤扩张/修复阶段。
- 意义：以当时可见样本自动选择 fast/slow 观测尺度。
- 范围：需输出有效样本数、滞后会话数和 minimumRequired。
- 约束：追加未来行不改变已有特征；显式 lookback 必须标 `explicit-scenario`。
- 成因：样本越长，可以在不固定全市场日历周期的前提下增加平滑尺度。
- 可推出：同一窗口函数下的样本动量和回撤速度。
- 不能推出：固定 5/20 日周期、真实主力节奏、未来反转。

`drawdownSpeed5/20`、`momentum5/20`、`costSlope5` 仅为迁移别名，其数字后缀不再描述真实固定滞后，新消费者必须读取 canonical fast/slow/recent 字段。

## 6. GetDelta 与动态周期

### 6.1 GetDelta 局部带

```text
e_T = sqrt(T / (tdpy * 2*pi))
a = annualVol * e_T                 require a < 1
R = ((1+a)/(1-a))^2
K_long = entryPrice * (deltaSlope*R-deltaSlope+1)^2 / R
```

局部 payoff 斜率校验：

```text
g'(x) = (sqrt(K*R/x)-1)/(R-1)
g'(entryPrice) ~= deltaSlope
```

- 使用：任意入场价和公式周期下的价格带、OrderPlan 公式基底。
- 意义：指定 payoff 几何在入场点的局部敏感度。
- 范围：`entryPrice>0`、`T>0`、`annualVol>=0`、`deltaSlope>=0`、`a<1`。
- 约束：`deltaSlope` 不得读取 `targetReturn`；T 不得有固定回退。
- 成因：从带 payoff 在入场点的一阶导约束反解带中心。
- 可推出：模型带上下沿、成本中心和局部 slope。
- 不能推出：Black-Scholes Delta、触达概率、退出收益目标、买卖保证。

### 6.2 AR(1) 条件半衰

```text
x_t = arCoefficient * x_(t-1) + epsilon_t
arDecayRatePerStep = -ln(abs(arCoefficient))
halfLifeSessions = ln(2) / arDecayRatePerStep
```

- 使用：动态周期、因果半衰权重、非平稳门禁。
- 意义：冻结样本、零未来冲击路径的条件衰减时间。
- 范围：半衰代数要求 `abs(rho)<1`；动态修复还要求 `0<rho<1`。
- 约束：当前拟合 through-origin，无截距、残差诊断、参数稳定性、置信区间或持出校准。
- 成因：一阶线性衰减每步保留固定比例。
- 可推出：样本诊断的单调、振荡或非平稳类别。
- 不能推出：实际持仓时间、必然回归、因果 OU 参数。

### 6.3 结构修复周期

对 long 场景：

```text
recoveryFraction = (targetPrice-cycleStartPrice) / (costAnchor-cycleStartPrice)
H = halfLifeSessions * log2(1/(1-recoveryFraction))
recoveryFraction(H) = 1 - 2^(-H/halfLifeSessions)
```

- 使用：每个标的、每个事件的动态持有研究坐标。
- 意义：在冻结目标和估计衰减下，零冲击路径修复指定比例所需步数。
- 范围：目标必须严格处于起点和锚之间，即 `0<recoveryFraction<1`。
- 约束：若起点是 T+1 open，H 只能在该开盘后完整计算；锚点本身 `q=1` 的时间渐近无穷。
- 成因：每经过一个 half-life，剩余锚距减半。
- 可推出：同一状态下不同结构目标的条件时间关系；若显式取 `H=3*halfLifeSessions`，则 `recoveryFraction=7/8=87.5%`，这是条件恒等式。
- 不能推出：目标触达概率、承诺持有期、全局 30 日下限，或把 87.5% 当作每个标的自动校准出的 q / CK 偏斜通解。

### 6.4 退出目标与 profile 门槛

`exitTargetReturn`、`minimumGrossReturn` 和 `fixedTargetReturn` 是三个不同量。第一个是仓位退出情景，第二个是选择结构 milestone 的门槛，第三个只属于显式固定情景。任一量改变了 horizon target，都要重算周期，不得仅改变显示目标。

## 7. 期权模型

### 7.1 Black-Scholes

```text
timeToExpiryYears = timeToExpirySessions / tradingDaysPerYear
tau = timeToExpiryYears
d1 = (ln(S/K) + (r-dividendYield+sigma^2/2)*tau) / (sigma*sqrt(tau))
d2 = d1 - sigma*sqrt(tau)
call = S*exp(-dividendYield*tau)*N(d1) - K*exp(-r*tau)*N(d2)
```

- 使用：欧式模型价、`optionDelta`、`optionGamma`、`optionThetaPerSession`、`optionThetaAnnual`、`optionVegaPerPct`、`optionRhoPerPct` 情景曲线。
- 意义：在 BSM 假设下的模型值和局部敏感度。
- 范围：`S,K,sigma,tau>0`，rates 有限。
- 约束：`timeToExpirySessions` 必须由真实合约到期日或明确期权情景给出，不能复用标的修复周期；Theta 必须注明 per-trading-session/annual；Vega/Rho 明确为每 1 个百分点；premium 缺失不同于零。
- 成因：连续对冲和无套利 PDE 的条件解。
- 可推出：同一假设下的模型内相对敏感性。
- 不能推出：bid/ask、可成交价、波动率曲面、跳跃与离散对冲成本。

### 7.2 Asian / Bachelier

- Geometric Asian：通过调整波动和 carry 进入 BSM，只是特定几何平均近似。
- Bachelier：正态绝对波动模型，`std=normalVol*sqrt(tau)`；`normalVol` 的单位是 price/year-root，不得与 lognormal annual fraction 混用。
- 当前 Bachelier 路径未实现 Theta/Rho 时必须返回 `null`。多腿组合只要有一个有效腿缺某项 Greek，组合该项也返回 `null/missing-input`，不能把未知风险加成零。
- 两者均为 `research-only`；没有真实合约条款、报价和结算规则时执行权限为 `none`。

## 8. AMM、LP 与 IL

### 8.1 Uniswap v3 库存

令 `sqrtP=sqrt(markPrice)`、`sqrtA=sqrt(lowerPrice)`、`sqrtB=sqrt(upperPrice)`：

```text
inside:
  token0 = L*(1/sqrtP - 1/sqrtB)
  token1 = L*(sqrtP - sqrtA)

valueQuote = token0*markPrice + token1
inventoryDeltaToken0 = token0
```

- 使用：区间内外库存、LP value、库存 Delta、对冲几何。
- 意义：协议平方根价格空间中的库存恒等式。
- 范围：`0<lower<upper`、`markPrice>0`、`L>=0`。
- 约束：token 顺序、decimals、价格方向、ticks、L 和 block 必须一致。
- 成因：集中流动性把恒定乘积曲线平移并限制到指定区间。
- 可推出：给定区间和 L 的 token 数量与价值。
- 不能推出：价格概率、真实 NFT 头寸、手续费、股票做市商仓位。

### 8.2 手续费金额

```text
feeIncomeQuote = sum(
  volumeQuote_i
  * feeTierFraction
  * positionLiquidityShare_i
  * inRangeFraction_i
) - pathCostsQuote
```

- 使用：路径回放、LP 归因、组合台账。
- 意义：头寸在已观察或明确情景路径上归属的 quote 现金流。
- 范围：份额与比例在 `[0,1]`；所有金额同币种。
- 约束：`feeTierFraction` 不是收入；`feeIncomeQuote` 不得再次乘价格；缺失费用不等于显式零；缺 in-range 时若用 1 必须标 full-in-range scenario。
- 成因：LP 只按在区间内的活跃流动性份额获得成交费用。
- 可推出：完整路径输入下的费用现金流。
- 不能推出：静态 TVL 的收入、费率即收益率、未来手续费。

### 8.3 v2 与 v3 IL

v2 全范围、无费用静态比率：

```text
priceRatio = markPrice/startPrice
fullRangeV2IlProxy = 2*sqrt(priceRatio)/(1+priceRatio)-1
```

v3 指定区间定义：

```text
rangeV3Il = (lpMarkValue-holdEntryInventoryAtMark)/holdEntryInventoryAtMark
```

- 使用：同一机制和对照资本下的反事实相对价值。
- 意义：LP 相对“持有入场库存不动”的无费用差。
- 范围：起点和标记价格为正；v3 还需合法范围和同一 L。
- 约束：v2 proxy 不能命名为 v3 IL；绝对 PnL、IL fraction、净收益分开。
- 成因：AMM 路径会机械改变库存配比，HODL 对照不变。
- 可推出：同机制、同范围、同资本、无费用下的相对差。
- 不能推出：净收益、费后表现、跨范围收益比较。

### 8.4 IL 归因边界

进入组合/净 LP 归因的 IL 输入必须附带 `ilModel`、范围、起点、mark、入场库存或资本基准、费用处理和周期。裸 `impermanentLoss` 不得进入主路径。零入场资本时 IL ratio 未定义，结果必须是 `missing-input`，而不是 0。

## 9. CK 资本效率

### 9.1 对称边界不是经验公式

算术区间端点：

```text
Pa = P0*(1-x)
Pb = P0*(1+x)
CE(x) = 1/(1-((1-x)/(1+x))^(1/4))
```

CK 选择的目标是 CE 曲线的边际效率拐点：

```text
CE''(x)=0
<=> 256*x^4-160*x^2-15=0
x* = sqrt(5+2*sqrt(10))/4
   = 0.8412994160945599
```

- 使用：CK 几何基准、范围宽度与资本效率的边际权衡。
- 意义：声明目标下的解析定理，不是历史拟合。
- 范围：`0<x<1`，保证 `Pa>0`。
- 约束：端点比 CE 的估值基准是 `sqrt(Pa*Pb)`；若 `P0` 是实际现价要另算 `capitalEfficiencyAtPrice(P0)`。
- 成因：范围扩大降低资本效率，拐点描述局部新增范围/效率损失权衡的转折。
- 可推出：对称算术区间下的精确 `±84.1299%` 边界。
- 不能推出：84% 概率覆盖、收益最优、费用最优、默认股票区间或执行目标。

### 9.2 偏斜边界同样来自 CK

令上行宽度为 `alpha*x`，下行宽度为 `x`，并定义：

```text
u = ((1-x)/(1+alpha*x))^(1/4)
3*alpha*u^5 - 5*alpha*u^4 - 5u + 3 = 0
x = (1-u^4)/(1+alpha*u^4)
```

`alpha=0` 时：

```text
u=3/5
x=1-(3/5)^4=0.8704
```

- 使用：非对称区间几何、方向宽度比敏感性。
- 意义：CK Part 2 的精确条件方程；数值求根不改变其 exact-identity 属性。
- 范围：`alpha>=0`、`0<x<1`。
- 约束：从历史正负涨跌尺度估计 alpha 是本项目的 sample estimate，必须和 CK 方程分层。
- 成因：固定上/下宽度比后，求同一资本效率曲线拐点。
- 可推出：给定 alpha 的理论下行和上行宽度。
- 不能推出：alpha 是做市商方向、87.5% 是普适常数、区间是概率覆盖、可直接执行。

来源：[CK Part 1](https://medium.com/@med456789d/uniswap-v3-math-insights-part-1-of-6-f85e1597b411)、[CK Part 2](https://medium.com/@med456789d/uniswap-insights-part-2-of-6-568632aa4d8)、[对称 Desmos](https://www.desmos.com/calculator/ysv2j74j6k)、[偏斜 Desmos](https://www.desmos.com/calculator/0l7i8kmukx)。

## 10. 流动性模型不等于概率

```text
componentNormalized_c(p) = weight_c*f_c(p)/integral(f_c)
fingerprint(p) = sum(componentNormalized_c(p))/sum(weight_c)
segmentMass_i = integral(segment_i,fingerprint)/integral(fullRange,fingerprint)
```

- 使用：价格架上的形状可视化、组件贡献、模型质量分配。
- 意义：声明模型中的非负归一化 mass。
- 范围：正价格区间、可积密度、非负权重。
- 约束：必须输出 `inputMode`；linear price 与 log price 坐标不能忽略 Jacobian；真实池需要 tick liquidity。
- 时间基：若模型 bump 宽度消费年化波动，必须显式传入 `annualVolatility` 与 `tradingDaysPerYear`，先换成每交易会话波动；任一缺失时返回 `missing-input/null`，不得回退 35% 或 365。
- 成因：把多个假设密度或结构组件归一化后混合。
- 可推出：模型内部哪些区间被赋予更多质量。
- 不能推出：未来价格概率、回归概率、订单簿深度、做市商库存或意图。

要把 model mass 升级为概率，至少需要：可观测结果标签、训练/校准分离、严格前缀特征、持出或前向概率校准、覆盖/可靠性曲线、漂移失效门禁。在此之前保持 `scenario-proxy`。

## 11. Funding、Carry 与 fee-theta

### 11.1 Funding 三层语义

```text
basisFraction = perpTwap/spotTwap - 1
cumulativeFundingProxy = basisFraction * (hours/24)

long grossRecoveryReturn = targetPrice/cycleStartPrice - 1
short grossRecoveryReturn = (cycleStartPrice-targetPrice)/cycleStartPrice
fundingCashflowReturn = fundingPositionSide == long ? -cumulativeFundingProxy : cumulativeFundingProxy
fundingNetCostReturn = -fundingCashflowReturn
netCarryProxy = grossRecoveryReturn + fundingCashflowReturn
breakEvenFundingNetCostReturn = grossRecoveryReturn
```

- 使用：缺真实结算时的 carry 压力情景。
- 意义：简化线性累计代理。
- 范围：`spotTwap>0`、`hours>=0`。
- 约束：累计值已经包含 horizon，不能二次乘期限；cycle start、target、recovery side、funding position side、notional basis、session-hours/calendar 映射、来源与 `availableAt` 必须齐全；break-even 是令 `netCarryProxy=0` 求出的同名义 funding 净成本阈值，不能用 anchor 分母、绝对值或私加固定 1%；真实 `fundingCashflowQuote` 需要交易所 schedule/cap/clamp/history。
- 成因：用同期 perp-spot 基差近似资金费拖累。
- 可推出：声明简化规则下的同周期量级。
- 不能推出：真实资金费率、已结算现金流、A/H 股票 funding。

### 11.2 `fee ≈ theta` 的唯一合法解释

只有下列六项全部对齐才允许比较：

```text
currency
notional
sign convention
horizon
session calendar and accrual interval
theta as-of timestamp
```

当前比较器要求相同币种和相同名义本金，要求显式
`feeSignConvention=income-positive`、
`optionThetaSignConvention=long-option-value-change`，并要求
`optionTimeToExpirySessions>=feeAccrualSessions`。它先形成
`feeSessionCalendarId=optionSessionCalendarId`、合法的
`feeAccrualStart<feeAccrualEnd`，并要求
`optionThetaAsOf=feeAccrualStart`。随后形成
`feeCarryQuotePerSession=feeIncomeQuote/feeAccrualSessions`，再把单期权单位的
`optionThetaPerSession` 按合约乘数换成 `optionThetaQuotePerSession`，在共同期限上按
Theta 局部不变情景计算：

```text
optionThetaDecayQuote = -optionThetaQuotePerSession * feeAccrualSessions
feeThetaGapQuote = feeIncomeQuote - optionThetaDecayQuote
```

旧的 `*Daily/*PerDay` 名称只是明确标记的迁移别名，不代表自然日口径。
`optionThetaPerSession` 在整个比较期限保持不变是一条公开情景假设，不是实际 Theta
路径。

即便对齐，它仍只是风险经济学类比：LP 可能赚取路径费用并承担库存凸性风险；短期权可能赚取时间价值并承担 Gamma/跳跃风险。两者不是同一个合约、同一个随机过程或同一个现金流公式。

- 可推出：同口径情景下费用 carry 与期权时间衰减的相对量级。
- 不能推出：`fee=theta`、费用稳定、LP 等价短期权、稳赚手续费。

## 12. 极端度、经验排名与复现

### 12.1 偏离极端度

```text
z = costDistance/periodVol
deviationPercentile = 2*Phi(abs(z))-1
twoSidedTailProbability = 2*(1-Phi(abs(z)))
```

- 使用：观测极端度、样本内相对排名、风险提示。
- 意义：当前状态在正态参考或经验样本中有多罕见。
- 范围：`periodVol>0`；percentile/tail 在 `[0,1]`。
- 约束：输出样本数、窗口和 `probabilitySemantics`。
- 成因：把已观察偏离映射到参考分布尾部。
- 可推出：当前观测的参考极端度。
- 不能推出：均值回归概率、上涨概率、目标触达概率、策略胜率。

### 12.2 当前状态邻域

```text
k = ceil(sqrt(N_prefix))
recurrenceRadius = current-state kNN distance
empiricalRadiusRank = (1+count(referenceRadius<=recurrenceRadius))/(N_reference+1)
```

- 使用：状态空间的局部稀疏度和复现 pilot。
- 意义：当前 kNN 半径相对历史半径参考的经验排名。
- 范围：有效候选至少 4、radius 为正。
- 约束：没有 exchangeability 和覆盖验证时不得叫 `conformalRank`。
- 可推出：在该参考规则下当前状态相对稀疏或密集。
- 不能推出：conformal p-value、覆盖保证、复现概率、锚点修复概率。

### 12.3 leave-then-reentry KM

连续命中组成 episode `[start,end]`，复现等待定义为：

```text
wait_j = episode_(j+1).start - episode_j.end
S(t) = product_(t_i<=t)(1-d_i/n_i)
Greenwood cumulative = sum d_i/(n_i*(n_i-d_i))
```

- 使用：离开当前状态邻域后再进入的经验等待分布。
- 意义：状态复现等待，不是回到成本锚。
- 范围：至少一个完整 leave-then-reentry interval。
- 约束：当前仍在命中 episode 的 age 不是右删失；没有合法删失时 `censoredCount=0`。
- 成因：把已完成等待看作事件时间做非参数生存估计。
- 可推出：该 episode 定义下的样本等待分布和 Greenwood 近似不确定性。
- 不能推出：结构修复周期、未来命中保证、当前 episode 内年龄作为离开后删失。

AR 修复周期和 recurrence period 的端点不同：前者到冻结 `costLower/target`，后者回到“当前状态邻域”。只能作为 `sameQuantity=false` 的诊断比较，不能平均或互相替代。

## 13. 组合统一台账

```text
totalPnlQuote = markValueQuote
              - entryCashflowQuote
              + realizedCashflowsQuote
              - costsQuote
```

- 使用：LP、期权、线性对冲、费用、funding 和成本的统一归因。
- 意义：同一币种、名义、符号、时点和期限的会计恒等式。
- 范围：所有腿都能映射到同一 quote currency。
- 约束：模型价不是 entry premium；`cumulativeFundingProxy` 永远不得进入组合账本；只有带 `fundingCashflowSource` 的 `fundingCashflowQuote` 可进入 `scenarioTotal`，且只有 `observed-settlement` 可解除正式结算门禁；未来 fee/funding 情景不得进入 formal `total`；合并 `missingInputs` 后必须重算状态。
- 成因：不同风险腿只有转成同口径现金流和盯市价值才能相加。
- 可推出：输入完整时的 formal PnL；不完整时已知腿的 scenario total。
- 不能推出：合成 Gamma 或 LP shape 等于账户 PnL、缺 premium 时的正式收益、跨期限相加。

## 14. 执行权限提升清单

任何 `research-only`、`proxy-only` 或 `missing-input` 输出，在以下项目不全时不得变成执行结论：

1. 完整、带时间戳的标的/合约/池身份和市场输入。
2. currency、notional、sign、price direction、decimals、horizon 一致。
3. 账户权益、可用资金、单笔和组合损失预算、保证金/清算约束。
4. bid/ask、深度、流动性、fill、费用税费、滑点。
5. T+1/T+0、期权行权结算、LP 再平衡、funding 结算制度。
6. 跳跃、Gamma、波动、流动性枯竭和相关性压力情景。
7. 与结论等级匹配的持出、前向或稳定性验证。

高分、极端 z、漂亮的 CK 几何、归一化流动性 mass 或正的情景 carry 都不能越过这些门禁。

## 15. 文档与代码维护规则

1. 新公式先在机器主表中分配唯一 `formulaId` 和规范字段，再进入 `src/domain/`。
2. 修改公式语义必须先在 `ERRATA.md` 建条目；不允许只改 UI 文案掩盖 domain 漂移。
3. 组件不得复制业务公式；store/composable 只做 ViewModel 编排。
4. 每个公式至少有有效域、无效域、单位、时点和禁止推论测试。
5. 任何“修复完成”先标 `fixed`；只有定向回归、`audit:formulas` 和 build 全通过后才标 `verified`。
6. 机器输出应携带 claim class、status axes、horizon mode 和 missing inputs；缺失字段不静默补默认。
7. `errataCoverage` 必须覆盖勘误表的连续 E-ID，并映射到存在的 `formulaId`；机器状态必须与勘误表一致。
8. `implementation`、`tests` 与本地 `sources` 必须存在；Markdown fragment 必须命中真实标题，禁止用陈旧锚点制造假绿。
