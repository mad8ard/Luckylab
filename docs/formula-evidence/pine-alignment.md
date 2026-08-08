# Pine ↔ 网站 数值对齐凭证

> 真相源：`src/domain/**`（Vue 项目工作台）
> 对齐文件：`bl-esw-pinbar-market-lab.pine`
> 自动断言：`src/test/pine-equivalence.test.js`
> 双胞胎 JS：`scripts/verify-pine-equivalence.mjs`

## 1. 默认配置一致性

| 项目 | Pine 默认 | JS 默认（src/domain） | 一致性 |
|------|-----------|------------------------|---------|
| `cost_len` | 60 | `deriveWindows(n=500+).cost = 60` | ✓ |
| `recent_len` | 20 | `deriveWindows(n=500+).recent = 20` | ✓ |
| `vol_len` | 60 | `deriveWindows(n=500+).vol = 60` | ✓ |
| `holding_days` | 30 | `holdingDays` UI 默认 30 | ✓ |
| `trading_days` | 365 | `tradingDaysPerYear` 默认 365 | ✓ |
| `target_return_pct` | 30 | `getDeltaBands.targetReturn` 默认 0.30 | ✓ |
| `lp_range_width` | 0.10 | `formulaPath.rangeWidth` 默认 0.10 | ✓ |
| `lp_skew` | 1.0 | `formulaPath.skew` 默认 1.0 | ✓ |
| `auto_adapt` | **false** | JS 不切档 | ✓ |
| `relax_mode` | false | JS 没有 | ✓ |
| `adaptive_cost` | false | JS 用单一 cost 锚 | ✓ |

## 2. 公式对齐节点

| Pine 节点 | JS 真相源 | 对齐方式 |
|-----------|-----------|----------|
| `cost_anchor` | `weightedTypicalCost(rows)` in `cost.js` | 同公式（typical price × volume / Σvolume） |
| `cost_low / cost_high` | `rollingCost.lower/upper` in `cost.js` | 同 `bandWidth` 公式 + sample stdev |
| `lp_lower / lp_upper` | `lpLower / lpUpper` in `formulaPath.js` | 同 `costAnchor × (1 ± rangeWidth × skew)` |
| `annual_vol` | `annualVol` in `cost.js` | sample stdev × √trading_days |
| `atr_pct` | `atrPercent` in `cost.js` | simple-mean of 14 TR / close |
| `long_cost / long_high / long_low` | `getDeltaBands.long.*` in `options.js` | 同 wave 公式（`entryPrice = cost_anchor`，`iv = annual_vol`，可被 `iv_override` 覆盖）|
| `z_score` | `deviationScore.z` in `core.js` | 同 cost_distance / period_vol |
| `match_pct` | `2·Φ(|z|) - 1` 用 `normalCdf` | Pine 用 Abramowitz 7.1.26 erf 近似 |
| `position_label` | `orderPlan.js` 状态字符串 | "高于成本带" / "低于成本带" / "成本带内" |

## 3. 容差表（自动断言）

| 指标 | 容差（相对） | 来源 |
|------|--------------|------|
| `cost_anchor` | < 0.05% | 浮点累加顺序 |
| `cost_low / cost_high` | < 0.10% | stdev 累积浮点误差 |
| `lp_lower / lp_upper` | < 0.05% | 同 cost_anchor |
| `annual_vol` | < 0.20% | sample stdev 浮点误差 |
| `atr_pct` | < 0.30% | TR 序列首尾边界差异 |
| `match_pct` | < 0.50% | Abramowitz 近似 ~7.5e-8 + z_score 累积误差 |
| `long_cost / long_high / long_low` | < 0.30% | 受 annual_vol 传递影响 |

## 4. 已知偏差（可接受范围内）

- 前 60 根 K 线（cost_len 窗口未填满）：Pine 输出 `na`，JS 在 `returnBasis < 5` 时 fallback 全历史，本轮接受
- `volume <= 0`（如指数）：JS 回退等权 typical；Pine `cost_main_anchor_raw` 在 `not has_volume` 时降级到 `ta.sma`，行为对齐
- `wave >= 1`（极高波动）：JS `getDeltaBands` 返回 null；Pine `delta_ok = false`，画线为 na
- **数据时点差**：网站使用静态 CSV 数据集（每日批量刷新），TradingView 是实时连续数据。两端在同一交易日开盘时偏差最小，盘中或刚收盘时网站可能落后 1-2 根 K 线。这会让 60 期 VWAP `cost_anchor` 偏差大致 = `(TV 现价 / 网站现价 - 1) / 60`。AAPL 2026-05-23 实测：网站现价 302.25 vs TV 309.47（+2.39%），`cost_anchor` 268.23 vs 268.97（+0.276%），符合预期传染量级，**不是公式问题**。验证方法：等网站数据集刷新到当日，或在 TV 上用 `Replay` 模式对齐到网站数据集 deadline 那根 bar。

## 5. 扩展开关启用后的偏离方向

| 开关 | 启用后 | 偏离方向 |
|------|--------|----------|
| `auto_adapt` | profile 按 `annual_vol_ratio` 自动切换 | `min_edge / cost_slope_threshold` 在波动率分位数 > 1.25 或 < 0.80 时偏离 JS |
| `relax_mode` | edge_sigma × 0.65、momentum_sigma -0.30、cost_slope_sigma × 0.75 | 信号触发更宽松，**JS 没有等价开关，启用即明确偏离** |
| `adaptive_cost` | cost_fast × 0.35 + cost_main × 0.45 + cost_slow × 0.20 | `cost_anchor` 在三档差异大时偏离 JS 单档；`cost_low/high` 同步偏离 |

## 6. 维护契约

任何修改 `bl-esw-pinbar-market-lab.pine` 计算公式的 PR 必须：

1. 跑 `pnpm run verify:pine` 全绿（包含文本检查 + 数值断言）
2. 同步修改 `scripts/verify-pine-equivalence.mjs` 中的 JS 双胞胎
3. 在 PR 描述里附 TradingView GOOG 1D 截图，对照 `0xff.tools` 网站工作台同标的，证明 `Cost / Ann Vol / ATR% / Position / Match / State / LP Range` 视觉一致
4. 如果引入新的容差，更新本文件 §3 表
