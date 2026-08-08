# Formula Wiring Audit

目的：逐项检查公式不是“目录项”或“空实现”。每个公式阶段必须至少满足一条真实接线：

- domain 函数可用固定样本算出有限值或非空曲线。
- 如果进入 K 线图，必须通过 `FORMULA_PATH_CURVES` 声明 source、unit、pane、status，并由 `formulaPath` 输出非空数据。
- 如果只属于研究层，必须有 `research-only` / `proxy-only` / `protocol-unverified` 状态和边界说明。
- 执行层只能消费成本带、GetDelta 带、账户和风险预算。

## Automated Checks

`pnpm run audit:formulas` 现在串行执行：

1. `source_coverage_audit.py`：检查 `formulaStages`、`formulaEvidenceCatalog`、`formulaSourceAudit` id、状态、IO、外部 source 是否一致。
2. `formula_inventory_audit.py`：检查文档清单覆盖实际导出的公式函数和关键派生公式名。
3. `formula_wiring_audit.py`：逐个公式实际调用 domain 函数，检查输出不是 `null`、空数组或非有限值；BTC/NVDA/TSLA 样本会背靠背跑 `formulaPath`。
4. `chart_formula_audit.py`：检查 chart 字段 metadata 来自 `FORMULA_PATH_FIELDS`，每条可画曲线有非空 `formulaPath` 数据，并被 `MainChart` 消费。
5. `formula_audit.py`：Python 独立重算 GetDelta、BS、Bachelier、LP v3、IL、CE、funding proxy，并和 JS tolerance 对比。

## Stage Matrix

| Stage | Domain wiring | Chart wiring | Status gate |
| --- | --- | --- | --- |
| `path` | `buildMarketStatePath()` length + mark/vol finite | K line input | implemented |
| `cost` | `buildCostPath()` anchor/upper/lower finite | `costAnchor/costUpper/costLower` | implemented |
| `volatility` | `buildMarketState()` annualVol/ATR finite | IV input and status | implemented |
| `delta-band` | `getDeltaBands()` low/cost/high finite | `deltaUpper/deltaLower` | implemented |
| `option-greeks` | `blackScholes()` price/Delta/Gamma finite | `optionDelta/optionGamma/optionThetaDaily` | research-only |
| `asian-option` | `asianOption()` + `bachelierOption()` finite | formula drawer/research chart | research-only |
| `lp-inventory` | `uniswapV3Inventory()` token/value finite | `lpValue/lpNormalizedDelta/lpLowerPrice/lpUpperPrice` | research-only |
| `liquidity-fingerprint` | `liquidityFingerprint()` base/active/cost/order/range component density, segment weights, stats non-empty | research chart | research-only |
| `amm-geometry` | `ammCurve()` points + `numoenSnapshot()` finite | research chart | protocol-unverified |
| `capital-efficiency` | `capitalEfficiency()` finite | `capitalEfficiency` | research-only |
| `funding` | `fundingRate()` basis/proxy finite | `fundingProxy` | proxy-only |
| `portfolio` | `hedgedLpPortfolioCurve()` points + `portfolioValue()` finite | research chart | research-only |
| `order-plan` | `buildDecisionGraph()` produces finite orders on triggered sample | execution markers | implemented |
| `deviation-score` | `deviationScore()` z/probability finite | strategy state | implemented |
| `risk-surface` | `riskSurface()` Greek curve points finite | research chart | implemented query, no execution |
| `net-lp-efficiency` | `netLpEfficiency()` totalNet finite | LP pane / research chart | research-only |
| `net-carry` | `netCarry()` finite and no duplicate time multiplier | `netCarry` | proxy-only |
| `mean-reversion` | `meanReversionHalfLife()` returns speed/half-life fields | research chart | implemented query, no execution |
| `gamma-pnl` | `gammaPnl()` finite | research chart | implemented query, no execution |
| `vol-confidence` | `volConfidence()` SE and CI finite | research chart | implemented query, no execution |

## Known Boundaries

- `costPath` can remain as a compatibility prop, but visible cost lines now prefer `formulaPath.costAnchor/costUpper/costLower`.
- `capital-efficiency` is implemented as a formula but gated as `research-only` because it describes range geometry, not profitability or execution.
- `funding` and `net-carry` remain `proxy-only` until real exchange funding schedule and settlement history are wired.
- `liquidity-fingerprint` remains `research-only` and `hybrid-model` when it mixes current price, cost anchor, Delta/LP range and simulated orders. It is still not order book depth, real AMM ticks, or wallet LP NFT composition.
