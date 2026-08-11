# Latent Liquidity Cost Band（LLCB）

这是与主应用隔离的研究实现。它检验一个可证伪的弱命题：仅凭信号时点以前的日线 OHLCV，能否识别对后续路径有稳定增量信息的“有效流动性成本状态”。

它不能从日线唯一识别做市商身份、真实成本、库存或方向；所有输出均为 `research-only`，不能直接生成订单。

> **旧快照口径勘误（保留证据，不回写）**：`results/**` 是 2026-08-09 早期实现生成的历史证据，JSON 仍使用 `halfLifeDays`、`modelHorizonDays`、`recurrencePeriodDays`、`blockDays` 等旧字段，并把 A 股、港股、美股都写成 `tradingDaysPerYear=252`。当前主链已统一为 `*Sessions`，且运行脚本必须通过项目 `inferTdpy` 显式写入市场年化交易会话基数（A 股/港股 242，美股 252）。因此下方数字只能按“旧协议 discovery 快照”引用，不能冒充当前协议复算结果；需要新结论时应另建新结果目录，不覆盖这些旧证据。

## 四个不能混用的量

| 名称                 | 定义                               | 含义                         |
| -------------------- | ---------------------------------- | ---------------------------- |
| `recoveryFraction`   | `q_t=(P*_t-E_{t+1})/(A_t-E_{t+1})` | 本次结构目标占锚距的修复比例 |
| `endpointFourthRoot` | `u=((1-x)/(1+alpha*x))^(1/4)`      | CK 端点比四次根              |
| `ckRangeWidth`       | `x`                                | CK 下侧算术价格宽度          |
| `skewAlpha`          | 上侧算术宽度 / 下侧算术宽度        | CK 非对称范围参数            |

代码不输出裸字段 `q`，防止把前三类量或概率分位数混成同一个参数。

## CK 精确结论

[CK Part 1](https://medium.com/@med456789d/uniswap-v3-math-insights-part-1-of-6-f85e1597b411) 的资本效率曲线为：

```text
CE_alpha(x) = 1 / (1 - ((1-x)/(1+alpha*x))^(1/4))
```

令 `CE_alpha''(x)=0`：

- 对称 `alpha=1`：`x*=sqrt(5+2*sqrt(10))/4=84.1299416%`。
- [CK Part 2](https://medium.com/@med456789d/uniswap-insights-part-2-of-6-568632aa4d8) 的单边 `alpha=0`：`u=3/5`，`x*=1-(3/5)^4=87.04%`。

这解释了“约 87%”的记忆来源。`87.5%=1-2^-3` 属于 AR 修复公式：只有某个明确目标刚好位于锚距的 `7/8` 时，才对应三个半衰期；它不是 CK 常数，也不再是默认参数。

CK 的 `x*` 是资本效率边际几何，不是概率覆盖、手续费最优、PnL 最优、止盈价或持有期。

## 动态算法

### 1. 因果成本状态

时点 `t` 只有前缀样本数 `n_t`。局部统计带宽自动取：

```text
w_t = floor(sqrt(n_t))
r_t = floor(sqrt(w_t))
```

因此带宽随可得证据增长，且 `w_t/n_t -> 0`；没有固定日历窗口。成本锚仍是局部成交量加权典型价，只能称为有效成本代理。

量能、真实波幅、收盘位置中心和成本斜率均使用同一时点的自动带宽。`absorption` / `reprice` 只表示可回放的价量状态，不表示参与者意图。

### 2. 结构目标周期

T 日收盘冻结成本锚 `A_t`、成本下沿 `P*_t` 和 AR(1) 系数 `rho_t`（生产字段 `arCoefficient`）。T+1 开盘得到周期起点 `E_{t+1}` 后：

```text
HL_t = ln(2) / -ln(rho_t)
q_t  = (P*_t - E_{t+1}) / (A_t - E_{t+1})
H_t  = HL_t * log2(1 / (1-q_t))
```

仅当 `0<rho_t<1`、目标严格位于周期起点与锚之间、且 `0<q_t<1` 时有效。`positionEntryPrice` 与 `cycleStartPrice` 被明确分离；已有持仓成本不会替代当前周期起点。

`HL_t`、`H_t`、首次命中、recurrence 与 bootstrap 区块均以已观测交易会话计数；生产 JSON 使用 `*Sessions`，不再用 `*Days` 暗示自然日。

### 3. CK-inspired recurrence pilot

`recurrenceCycle.js` 使用 `k=ceil(sqrt(N))` 搜索当前 `costDistance` 状态的历史邻居，并把连续命中合并成 episode；只有“离开后再次进入”才形成 recurrence interval。

它只估计“相似状态再访节奏”，不估计回锚目标，也不生成 recovery `q` 或持仓 `H`。kNN 半径的 OOD rank、episode 离散度会被报告，但 survival 右删失校准尚未完成，因此状态固定为 `pilot-unpromoted`。

### 4. 每标的 CK 偏斜

用结构周期形成因果权重：

```text
w_{i,t} = 2^(-(t-i)/H_t)
```

分别估计正负收益的加权条件中位尺度，并精确转换到 CK 的算术价格坐标：

```text
alpha_t = (exp(m_{+,t})-1) / (1-exp(-m_{-,t}))
```

给定 \(\alpha_t\) 后，CK frontier 方程是 `exact-identity`；但由收益不对称桥接到 LP 范围不对称仅是 `scenario-proxy`。输出包含两侧 ESS 和 log-alpha 标准误，不把几何边界写成执行目标。

## 无未来数据协议

1. 每个历史状态只消费当时前缀；尾部追加极端未来行情不改变过去输出。
2. T 冻结锚、目标和 \(\rho\)；T+1 open 机械确定 \(q_t/H_t\)。
3. 每个事件使用自身 \(H_t\) 评分，数据不足则右删失。
4. 同标的下一事件不得与上一事件的动态路径重叠。
5. prequential 校准只消费在当前信号日前已经结算的旧事件。
6. 日期区块 bootstrap 长度取比较样本中 \(H_i\) 的 p90，不使用固定周期。
7. 公式周期只按自身分位数做诊断分层；分层边界不进入信号。

## 历史本地快照（旧序列化与 TDPY 口径）

| 市场 | 标的 | 成熟公式事件 | H min / median / p90 / max | q 中位数 | recurrence 中位数 | alpha 中位数 | alpha 较小侧 ESS 中位数 | 状态         |
| ---- | ---: | -----------: | -------------------------- | -------: | ----------------: | -----------: | ----------------------: | ------------ |
| A 股 |  316 |       31,739 | 1 / 3 / 7 / 39             |   28.23% |                15 |         0.64 |                    2.79 | not-promoted |
| 港股 |   21 |        1,632 | 1 / 3 / 7 / 96             |   28.69% |                14 |         0.66 |                    2.81 | not-promoted |
| 美股 |   95 |        6,258 | 1 / 3 / 7 / 66             |   28.10% |                12 |         0.64 |                    3.21 | not-promoted |

这些数字是当前静态股票池的 discovery 快照，不是总体参数。结构 \(H_t\) 与 recurrence period 的终点不同，不能平均或互相替换。alpha 的有效样本量很低、log-alpha 标准误中位数约为 1，因此当前动态 CK 偏斜尤其不能作为执行参数。

详见 [A 股报告](results/latest-report.md)、[港股报告](results/hk/latest-report.md)、[美股报告](results/us/latest-report.md) 和 [本轮发现](FINDINGS.md)。

## 运行

```bash
node --test research/latent-liquidity-lab/test/latentLiquidity.test.mjs
node research/latent-liquidity-lab/scripts/run-walk-forward.mjs --market=A股 --write
node research/latent-liquidity-lab/scripts/run-walk-forward.mjs --market=港股 --write
node research/latent-liquidity-lab/scripts/run-walk-forward.mjs --market=美股 --write
```

新版 `--write` 默认写入 `results/latent-liquidity-sessions-v4/<tdpy-basis>/`；脚本会拒绝把输出直接写回旧版 `results/`、`results/hk/` 或 `results/us/` 证据目录。

进一步识别真实流动性供给者至少需要点时可得的逐笔成交方向、L1/L2 深度、撤单、涨跌停/停牌、公司行为和复权数据；库存或账户结论还需要可信头寸数据。
