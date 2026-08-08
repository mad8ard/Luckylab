---
name: china-stock-selection
description: Use this skill for beginner-friendly stock selection workflows in Market Lab focused on mainland China and Hong Kong market data, including A-share or HK watchlist screening, domestic CSV refresh checks, and source-labeled candidate pool reports. Trigger when the user asks to choose, screen, rank, or explain stocks using China-market data in this repo.
metadata:
  short-description: Screen China-market stock candidates in Market Lab
---

# China Stock Selection

Use this skill to help entry-level Market Lab users build a source-labeled watchlist for domestic market scenarios. Keep the output as research and observation, not financial advice or a buy/sell command.

## Runtime Entry Points

- Codex: `.agents/skills/china-stock-selection`
- Claude Code: `.claude/skills/china-stock-selection`
- OpenClaw / generic agents: `skills/china-stock-selection`
- Keep the script logic canonical in `.agents/skills/china-stock-selection/scripts`; the other roots provide runtime-compatible wrappers.

## Core Rules

- Work from data first: use `src/data/stock-index.json`, `public/data/*.csv`, and the data refresh flow in `docs/development/data-pipeline.md`.
- Use the whole Market Lab formula map as the selection frame. Formula stages that cannot be truthfully evaluated from domestic OHLCV must still appear as `research-only`, `proxy-only`, or `missing-inputs`, not silently disappear.
- Do not use RSI, KDJ, EMA, or MA for stock selection, ranking, entry, exit, holding-period, or status decisions. These are outside this skill's decision model.
- Prefer A-share and HK instruments by default. Include US or crypto only when the user asks for cross-market comparison.
- Every conclusion must show source, market, data-through date, and whether the data is current enough for the requested task.
- Do not invent fundamentals, news, prices, sectors, market caps, or trading calendar facts. If those are needed and not in local data, refresh or explicitly say they are missing.
- Treat the result as a candidate pool: `观察`, `等待`, `剔除`, or `需刷新数据`. Avoid wording like guaranteed upside or direct buy instruction.
- Keep beginner-facing explanations short: signal, risk, why it made or missed the list, and what to verify next.
- If RSI/KDJ/EMA/MA appear in user text, screenshots, or external data, label them as ignored external references. Never cite them as reasons a stock is selected or rejected.

## Quick Workflow

1. Check repo state and data coverage:

```bash
git status --short
pnpm run check:data
pnpm run check:generated-data
```

2. For a local formula-assisted screen, run:

```bash
node skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股,港股 --top 20
```

Useful variants:

```bash
# 基础用法
node skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股 --top 30

# 恢复各类排除（默认全部开启）
node skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股 --exclude-alcohol false
node skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股 --exclude-banks false
node skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股 --exclude-realestate false
node skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股 --exclude-northeast false
node skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股 --require-shebao false

# 其他格式
node skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market 港股 --top 15 --format json
node skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股,港股 --top 30 --format json
node skills/china-stock-selection/scripts/screen-cn-stocks.mjs --market A股 --top 15 --min-rows 240
```

3. If data is stale or missing, use the project pipeline:

```bash
pnpm run plan:market-data
pnpm run refresh:market-data
```

4. Summarize as a watchlist, not a final trade:

```text
范围: A股/港股, daily OHLCV, source ...
数据截至: ...
筛选逻辑: 成本锚(30) + 合成LP分位数主导(45,含3年比值检测) + z-score(15) + 数据质量(10)
排除: 酒水/银行/地产/东三省, 仅社保Q1持仓, 无RSI/KDJ/EMA/MA
候选池: symbol, name, dataThrough, status, score, 成本锚, LP(合成,含3年比值xN), z-score
持仓成本: halfLifeDays, firstTargetDays, recoveryDays, timeAdjustedReturn, opportunityCostFlag
JSON模式: --format json 含全量公式字段
剔除/等待: ...
下一步验证: cost anchor stabilization, industry/sector, fundamentals/news if required
```

## Name Resolution

Local `stock-index.json` may only contain codes as labels. The screening script reads `references/stock-names.json` for local convenience names and emits `name` plus `nameSource`.

- If `nameSource` is `local-name-overrides`, say it is a local helper label and verify before publishing.
- If `nameSource` is `unresolved-local-index`, do not guess the name; ask to refresh data or verify from a current market source.
- If the user asks "实际股票名称是什么", answer from the script output first, then verify externally only when exact current names matter.

## Formula Coverage

The screening uses the full Market Lab formula stack. All LP/AMM formulas run in **synthetic mode** (liquidity=1, rangeWidth from ATR) — no on-chain data dependency.

Hard exclusion:

- RSI, KDJ, EMA, MA are forbidden in this skill's decision path.
- Do not use them as filters, weights, tie-breakers, confirmations, entry/exit triggers, holding-period adjustments, or risk labels.
- Do not mix this skill with `bl-marketlab-pool` scoring semantics; that separate recommended-pool skill has different dimensions and may contain KDJ/RSI fields.
- If a report includes those fields for comparison, write: `RSI/KDJ/EMA/MA: ignored, not part of this skill's model`.

Complete formula stack:

| 模块                  | 公式                                           | 模式                    |
| --------------------- | ---------------------------------------------- | ----------------------- |
| 价格路径 → 市场成本   | costAnchor, costBand, costDistance, costSlope5 | real                    |
| 波动口径              | annualVol, atrPercent                          | real                    |
| Δ 成本带              | GetDelta bands (long/short)                    | real                    |
| 期权 Greeks           | blackScholes delta/gamma/theta                 | synthetic               |
| 亚式近似              | asianOption price                              | synthetic               |
| LP 库存曲线           | uniswapV3Inventory (V3)                        | **synthetic**           |
| 流动性指纹            | liquidityFingerprint (混合密度)                | **synthetic**           |
| AMM 几何              | ammCurve (xy=k)                                | **synthetic**           |
| 资本效率              | capitalEfficiency                              | **synthetic**           |
| 偏离强度              | deviationScore (z-score)                       | real                    |
| 风险曲面              | riskSurface                                    | synthetic               |
| Gamma PnL             | gammaPnl                                       | synthetic               |
| LP 净效率             | netLpEfficiency                                | **synthetic**           |
| 波动率置信            | volConfidence                                  | real                    |
| 均值回归              | meanReversionHalfLife                          | real                    |
| VIX Fix               | vixFix                                         | real                    |
| 订单决策              | buildDecisionGraph                             | real                    |
| 资金费率 / 持仓净收益 | fundingRate / netCarry                         | fallback (no perp data) |

Second-order reporting rules:

- `meanReversion.rho` is the raw AR(1) coefficient from the cost-distance series. Only `abs(rho) < 1` has a defined decay half-life; `rho < 0` means alternating-sign decay, and `abs(rho) >= 1` must be reported as non-stationary rather than clipped into a slow half-life.
- `dynamicHolding.phase = post-anchor-extension` means price is already above the long-side cost anchor. Keep it as `等待 / review-extension`; never relabel it as insufficient history and never invent a mean-reversion target beyond the anchor.
- `gammaConvexity.positionGamma = gamma * positionSize`; `dollarGamma = positionGamma * markPrice^2`. Absolute-price Gamma PnL is `0.5 * positionGamma * priceChange^2`, equivalent to `0.5 * dollarGamma * (priceChange / markPrice)^2`. For the A-share screen this remains a unit-size synthetic option scenario, not actual RMB PnL.
- `volConfidence.standardErrorPct` uses `SE(sigma) = sigma / sqrt(2n)` under the normal-return approximation. The interval uses the requested two-sided confidence level and must disclose sample size, critical z, standard error, and relative uncertainty.

## Screening Semantics

Three-pillar scoring with LP percentile as the dominant signal:

### 成本锚 (30 points)

- **锚方向**: rising ↑ = full points, flattening → = partial, declining ↓ = low
- **价格位置**: within or near cost band scores highest
- Interpretation: anchor direction is the confirmation signal; a declining anchor means wait even if LP/z are aligned

### 合成 LP (45 points)

- **lpValue 分位数 (0-30)**: P<5% = 30, P<10% = 25, P<25% = 18, P<50% = 10
  - P<5% means LP inventory value at 1-year extreme low — LP accumulated maximum stock at cheapest prices
- **zone (0-10)**: range = 10, token0 + low percentile = 10 (best entry setup: LP holds stock at historical low), token0 alone = 4
- **净效率 (0-5)**: netLpEfficiency positive = 5
- **3年比值惩罚 (-20)**: 若 LP 在 3 年内从未达到当前值的 1.5 倍以上 → 价值陷阱, -20 分
  - 比值 ×2.0 表示 LP 曾翻倍后回落，是周期低点
  - 比值 < 1.5 表示 LP 长期趴窝，再便宜也不碰
- Interpretation: token0 zone at P<5% + 3年 LP 曾大幅高于现在 = 周期底部囤货，不是价值陷阱。锚企稳是最佳确认信号。

### z-score (15 points)

- **回归概率 (0-8)**: prob ≥ 95% = 8, ≥ 85% = 6, ≥ 70% = 4, ≥ 55% = 2
  - Higher probability = stronger mean-reversion signal
- **折价深度 (0-7)**: z ≤ -3 = 7, ≤ -2 = 6, ≤ -1 = 4
  - Deeper discount = stronger regression potential. Extreme z IS the signal, not noise.

### 公式买点/卖点/持仓周期

基于纯公式计算，不给主观建议：

- **买点**：现价 ≤ Delta 带 long 上沿即可进场，不需要等更低。价格已在折价区间时，再等"更低"可能错过回归
- **第一卖点**：成本带下沿（锚站稳确认信号）
- **第二卖点**：成本锚（全部回归完成）
- **持仓周期**：均值回归半衰期 × 2 = 覆盖 ~75% 距离偏差；半衰期 × 3 = 到成本锚
  - z-score 只说明偏离强度和回归概率，不直接缩短半衰期；不要写成"z 极端会加速 HL"
  - 短周期策略（1-3月）：强 z + 强 LP 可盖过锚未企稳，不等锚直接靠回归拉回
  - 长周期策略（6月+）：锚方向权重加大，锚 ↓ 时即使 z/LP 强也必须等锚走平

### 持仓成本 / 时间损耗

每个候选都必须回答"占用资金多久、这段时间是否值得"。不要只看折价空间和分数。

基础计算：

- `firstTargetDays = halfLifeDays * 2`：第一卖点或成本带下沿的时间窗口，不是保证日期
- `recoveryDays = halfLifeDays * 3`：回到成本锚的长窗口，只用于情景说明
- `firstTargetReturn = (costLow - close) / close`，若 price 已高于 costLow，则改用 Delta/成本带给出的下一目标
- `timeAdjustedReturn = firstTargetReturn / max(firstTargetDays, 1) * 21`，用于比较月化效率

解释规则：

- HL ≤ 30 天：短周期，资金周转友好；若 LP/z 同时强，可接受锚未完全走平
- 30 < HL ≤ 60 天：中周期，需要写清第一卖点和复核条件
- HL > 60 天：长周期，必须标注"时间成本高"，除非 timeAdjustedReturn 明显优于前排候选
- HL > 90 天或锚持续 ↓：默认降级为等待；只给观察，不给积极措辞
- 锚 ↓ 时，第一卖点用成本带下沿，不能把成本锚当确定卖点；锚 →/↑ 时才讨论等到成本锚
- `volConfidence` 低或数据短时，半衰期只作参考，需加缓冲或标注不可信
- "接飞刀"只解除锚下降的硬等待，不解除时间成本；z ≤ -1.5 且回归概率 ≥ 85% 仍要看 HL 和月化效率

输出时至少给一行：

```text
时间成本: HL {x}天；第一窗口约 {2x}天；完整回归约 {3x}天；第一目标空间 {y}%；月化效率约 {z}%；结论: 周转友好/可接受/时间成本高
```

### 数据质量 (10 points)

- Data freshness (stale > 10d penalized) + history depth (500+/1000+ rows bonus)

### 排除规则 (全部默认开启)

| 类别     | 数量       | 排除标的                                                                                                               | 关闭参数                     |
| -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 酒水     | 9          | 茅台/五粮液/泸州老窖/洋河/今世缘/酒鬼酒/汾酒/古井贡/水井坊                                                             | `--exclude-alcohol false`    |
| 银行     | 22         | 平安/浦发/华夏/民生/招商/兴业/北京/农业/交通/工商/光大/建设/中国/中信/宁波/江苏/杭州/南京/上海/浙商/成都/邮储/渝农商行 | `--exclude-banks false`      |
| 地产     | 3          | 万科A/保利发展/招商蛇口                                                                                                | `--exclude-realestate false` |
| 东三省   | 3          | 长春高新/恒力石化/中航沈飞                                                                                             | `--exclude-northeast false`  |
| 社保持仓 | 80只白名单 | 仅保留 Q1 2026 前十大流通股东含社保基金的标的                                                                          | `--require-shebao false`     |

Map results:

- `观察` (score ≥ 65): two of three pillars aligned, data current
- `等待` (score ≥ 40): anchor declining or LP not at extreme low, wait for confirmation
- `剔除` (score < 40): data quality issues or no signal alignment
- `需刷新数据`: latest bar > 10 days old

## 交易策略经验

### 持仓周期与选股逻辑

**核心原则：拿着不赚就是亏。** 时间成本是真实的——锚还在跌、等几个月才回本，不如投下一个信号。

**短周期（1-3个月）**：强 z-score + 强 LP 可以盖过锚未企稳。z ≤ -1.5σ 且回归概率 > 85% 时不需等锚走平，回归力道本身就够在 60 个交易日内拉回。

- 弹性优先：**LP 3年比值 > 2.0** = LP 曾翻倍后回落 → 真正的周期低点，反弹空间大
- 确定性优先：**锚已走平（→）** + LP 极端低位 → 稳但弹性小
- 时间回报率：金龙鱼 HL=17天 ×2 → 1个月+8.7% > 长安 HL=69天 ×2 → 5个月+12.3%（月化 8.7% vs 2.5%）
- HL > 60 天的标的标注"长周期"，提醒机会成本；HL > 90 天默认等待，除非用户明确要长周期池
- 比较多个候选时先看 timeAdjustedReturn，再看绝对空间；资金长时间不动就是策略成本

**长周期（6个月以上）**：锚方向权重加大。锚 ↓ 的标的即使 z/LP 强，也要等锚走平再用长仓。汽车股典型周期：锚连跌 2-3 月 → 企稳 → 反弹。

### LP 价值陷阱识别（3年比值）

```
LP 3年比值 = 近3年 LP 最大值 / 当前 LP 值

× > 2.0  → 周期低点（LP 曾翻倍后回落），不是陷阱
× 1.5-2.0 → 中性，需结合 z-score 判断
× < 1.5  → 结构性趴窝（LP 3年内从未翻倍），-20 分惩罚
```

比全历史分位数更准：一只票上市 5 年、前 2 年 LP 很高，后来一路阴跌，全历史 P<20% 是陷阱，但 ×1.2 的 3 年比值直接暴露它"3 年内就没起来过"。

### 行业轮动注意

- **银行股**：锚多数走平，LP 周期低位，但无社保基金加持。高分来自低波动 + 稳定锚，不是弹性标的
- **车企**：周期性最强。长安/上汽/长城 LP ×2.4-3.5，深度折价 z ≤ -1.88σ。3 个月内回归确定性高，但锚 ↓ 期间波动大
- **酒水/地产**：长期逻辑已变，全历史 LP 趴窝，不再纳入筛选

### 政治事件叠加

2026-2027 年重大政策窗口：

- **3月两会**：GDP 目标 4.5-5%，"反内卷"政策升级，科技+消费双主线
- **H2 中央经济工作会议**：定调次年，通常在 12 月
- **十五五规划**：AI 终端普及率 70%+，数字经济核心产业 GDP 占比 12.5%

科技制造（AI/芯片/汽车）政策顺风，传统行业（地产/白酒）逆风。选股时优先政策主线上的标的。

## Output Contract

For stock-selection answers, the markdown table shows:

- Core columns: `symbol`, `name`, `market`, `dataThrough`, `status`, `score`
- Three-pillar columns: `成本锚` (distance + direction + band), `LP(合成)` (zone + value + percentile + net efficiency), `z-score` (σ + regime + regression probability)
- Time-cost columns or notes: `HL`, `第一窗口`, `完整回归`, `第一目标空间`, `月化效率`, `时间成本结论`
- Full formula detail available via `--format json` (includes options, deltaBands, fingerprint, amm, meanReversion, volConfidence, orderPlan)

Never put long market essays into the app UI. If a code change is needed, domain formulas and screening rules belong in `src/domain/`, ViewModel orchestration belongs in `src/stores/` or `src/composables/`, and components should only render compact signals and controls.
