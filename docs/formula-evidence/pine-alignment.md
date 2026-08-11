# Pine ↔ Domain 因果对齐凭证

> Domain 真相源：`src/domain/**`
> Canonical Pine：`bl-esw-pinbar-market-lab.pine`
> 独立 JS twin：`scripts/verify-pine-equivalence.mjs`
> 自动断言：`src/test/pine-equivalence.test.js`

## 1. 时间单位契约

Pine 的一根 bar、本地日线的一行和公式中的一步都是一个交易会话（trading session），不是自然日。

| 意义           | Pine 生产字段                  | JS twin 生产字段               | Domain canonical                 |
| -------------- | ------------------------------ | ------------------------------ | -------------------------------- |
| 每年交易会话数 | `trading_sessions_per_year`    | `trading_sessions_per_year`    | `tradingDaysPerYear`（年化约定） |
| AR(1) 半衰期   | `half_life_sessions`           | `half_life_sessions`           | `halfLifeSessions`               |
| 未取整恢复周期 | `formula_horizon_raw_sessions` | `formula_horizon_raw_sessions` | `modelHorizonRaw` / session unit |
| 可消费恢复周期 | `formula_horizon_sessions`     | `formula_horizon_sessions`     | `formulaHorizonSessions`         |

Canonical Pine 和 JS twin 不输出 `half_life_days` 或 `formula_horizon_days`。旧 day 名称不得进入数值比较、信号或执行链。

## 2. Prefix-causal 窗口

每个历史点只使用当时可见前缀：

```text
prefix_n = bar_index + 1
cost_window = max(5, floor(sqrt(prefix_n)))
recent_window = max(3, floor(sqrt(cost_window)))
vol_window = cost_window
ATR window = recent_window
```

追加未来 K 线不能改写历史窗口或历史成本状态。`cost_window` 未填满时只使用当时已观测会话，不填充未来值。

## 3. 动态周期公式

```text
rho = sum(x_t * x_(t-1)) / sum(x_(t-1)^2)
half_life_sessions = ln(2) / -ln(rho)
side = close > cost_anchor ? short : long
target = side == long ? cost_low : cost_high
direction = side == long ? 1 : -1
q = ((target - cycle_start) * direction) / ((cost_anchor - cycle_start) * direction)
formula_horizon_raw_sessions = half_life_sessions * log2(1 / (1 - q))
formula_horizon_sessions = ceil(formula_horizon_raw_sessions)
```

其中 `rho` 是 expanding、through-origin 的前缀样本估计。`cycle_start` 先取当前自适应成本窗口内的 low（long）或 high（short）极值；若当前目标不严格位于该极值和成本锚之间，则从当前点向前回扫最近一次 `low < 当日动态 cost_low`（long）或 `high > 当日动态 cost_high`（short），并以当前 `target / cost_anchor` 重新验证严格结构。回扫比较是逐日边界穿越，不是要求相邻 K 线发生 crossover/crossunder。

只有以下条件全部成立时才输出 GetDelta、z 和信号：

- `0 < rho < 1`
- long 满足 `cycle_start < cost_low < cost_anchor`，或 short 满足 `cycle_start > cost_high > cost_anchor`
- `0 < q < 1`
- `formula_horizon_sessions > 0`
- 至少 5 个因果对数收益观测且年化波动率为正
- GetDelta `wave` 严格位于 `(0, 1)`

`rho` 是样本估计，`H` 是冻结目标下的条件情景坐标，两者都不是对实际持有时间的保证。

## 4. 公式节点对齐

| Pine 节点                                      | Domain 真相源                      | 对齐方式                                                               |
| ---------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `cost_anchor`                                  | `weightedTypicalCost` in `cost.js` | typical price × volume / Σvolume；零成交量回退等权 typical             |
| `cost_low / cost_high`                         | `rollingCost.lower/upper`          | 同 prefix 窗口、sample stdev 和 0.5% 最小带宽                          |
| `annual_vol`                                   | `buildMarketState.annualVol`       | prefix sample stdev × √`trading_sessions_per_year`                     |
| `atr_pct`                                      | `buildMarketState.atrPercent`      | `recent_window` 内 simple-mean TR / close                              |
| `rho / half_life_sessions`                     | `meanReversionHalfLife`            | expanding AR(1)-through-origin                                         |
| `recovery_fraction / formula_horizon_sessions` | `buildFormulaPath`                 | 同一双边动态目标、窗口极值/动态边界回扫和恢复恒等式                    |
| `long_cost / long_high / long_low`             | `buildFormulaPath.delta*`          | `entryPrice=cost_anchor`、实现波动率、`delta_slope`                    |
| `z_score / match_pct`                          | `deviationScore`                   | 同 `formula_horizon_sessions` 周期化；match 是偏离极端度，不是回归概率 |

## 5. 自动验证

`pnpm run verify:pine` 同时执行：

1. 静态契约：禁止固定 holding/cost/recent/vol 输入、day 单位字段和 `targetReturn` 别名。
2. 窗口与周期恒等式：检查 prefix/sqrt 窗口、recent ATR、双边目标、窗口极值、动态边界回扫和 `rho/q` 双门禁。
3. 数值等价：对 GOOG、AAPL、600519、BTCUSDT 比较 JS twin 与 `buildMarketState` 的最新前缀。
4. 动态周期：对每个标的最近可用前缀比较 side、target、cycle start/source、`rho`、`half_life_sessions`、`q`、`formula_horizon_sessions`、GetDelta 和 z；另锁定 long/short × 窗口极值/边界回扫四条分支。
5. 失效路径：周期门禁不成立时，确认 GetDelta、z 和信号为空。

JS twin 是独立复刻，不直接调用 `cost.js` 或 `formulaPath.js` 的被测函数，避免循环自证。自动比较使用 `1e-10` 相对容差，目的是阻止代码口径漂移，不代表 TradingView 与本地数据源会完全同步。

## 6. 边界与废弃项

- TradingView 是连续数据，网站是静态 CSV 快照；数据截止时点不同时不能把数值差异归因于公式。
- `auto_adapt` 和 `relax_mode` 是默认关闭的 Pine 显式扩展；开启后信号门槛会偏离 Domain，但不能绕过周期有效性门禁。
- `bl-esw-pinbar-market-lab-cdx.pine`、`*-pro-cc.pine` 和 `*-pro-osc-cc.pine` 现在是无输出、无信号、无告警的兼容占位脚本；完整旧源码已隔离到 `research/archive/pine/`，只作历史审计，不具公式或执行权限。
- 本次未保留 day 命名的输出 adapter；如日后必须兼容，只能在独立 deprecated adapter 中标明 `legacyAliasOf`，且测试不得消费该 adapter。

## 7. 维护契约

修改 canonical Pine 计算链时必须同步 JS twin、静态 verifier、equivalence test 和本文档，并在提交前运行 `pnpm run verify:pine`。
