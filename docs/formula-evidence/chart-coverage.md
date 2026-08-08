# Chart Coverage

目标是用类 TradingView 的方式把公式证据贴到 K 线上：价格类曲线在主图，风险类曲线在子图，状态和缺失条件用 marker/legend 告诉用户。

## Overlay 分组

| Group | 默认 | 内容 |
| --- | --- | --- |
| `priceBands` | on | 成本锚/上下沿、GetDelta 上下沿、入场价 |
| `executionMarkers` | on | 当前信号、挂单目标、失效线、回放成交 |
| `researchMarkers` | on | research-only、proxy-only、protocol-unverified、missing-input |
| `greeksPane` | off | BS/portfolio Delta、Gamma、Theta |
| `lpPane` | off | LP normalized delta、LP value、LP 区间上下沿、CE |
| `carryPane` | off | funding proxy、net carry、break-even |
| `indicatorsPane` | off | KDJ、RSI 等非公式主线指标 |
| `equityPane` | off | 显式开启账户回放后的权益曲线 |

## 主图曲线

所有主图曲线必须来自 `formulaPath` 或 `costPath`，不要在组件内重新算公式。

| Series | Source | Status |
| --- | --- | --- |
| Candle | `rows` | implemented |
| Volume | `rows.volume` | implemented |
| Cost anchor | `costPath.anchor` | executable |
| Cost upper/lower | `costPath.upper/lower` | executable |
| GetDelta upper/lower/cost | `formulaPath.deltaUpper/deltaLower/deltaCost` | executable |
| Entry price | `input.entryPrice` | executable input |
| LP lower/upper | `formulaPath.lpLowerPrice/lpUpperPrice` | research-only |
| Target/stop | `graph.position.targetPrice/stopPrice` | executable when account configured |

## 子图曲线

| Pane | Series | Source |
| --- | --- | --- |
| Greeks | `optionDelta`, `optionGamma`, `optionThetaDaily` | `formulaPath` |
| LP | `lpInventoryDelta`, `lpValue`, `lpNormalizedDelta` | `formulaPath` |
| Carry | `fundingProxy`, `netCarry`, `breakEvenFunding` | `formulaPath` |
| Efficiency | `capitalEfficiency`, `netLpEfficiency` | `formulaPath` |
| Equity | replay equity | `replay.equityCurve` |

## Marker 规则

- `research-only`：蓝灰 marker，说明该曲线只做研究，不进默认挂单。
- `proxy-only`：琥珀 marker，说明缺真实外部制度或结算数据。
- `protocol-unverified`：红棕 marker，说明协议机制未验证。
- `missing-input`：灰 marker，说明公式缺真实 leg、LP position、funding schedule 或 fee model。
- `execution`：绿色/红色 marker，只用于默认挂单和账户回放事件。

## Hover 数据

Crosshair hover 应从同一 index 读取：

- `rows[index]`
- `costPath[index]`
- `formulaPath[index]`
- replay/event map by date

组件只能做格式化，不做业务公式。

