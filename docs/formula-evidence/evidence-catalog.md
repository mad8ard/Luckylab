# Formula Evidence Catalog

## 证据模型

后续新增 `formulaEvidenceCatalog`，作为公式来源和执行边界的统一事实源。建议字段：

```js
{
  id,
  sourceTier,       // blog-source | desmos-source | paper | protocol-whitepaper | heuristic | implementation
  status,           // implemented | research-only | proxy-only | protocol-unverified | planned
  executable,       // 是否允许进入默认挂单/回放结论
  queryOnly,        // 是否只能作为查询/展示
  inputs,
  outputs,
  assumptions,
  invalidWhen,
  missingInputs,
  chartSeries,
  sources,
}
```

`formulaStages` 负责 UI 和能力分组，`formulaSourceAudit` 负责当前代码审计，`formulaEvidenceCatalog` 负责来源等级和约束。三者必须通过离线脚本做覆盖检查。

## 来源等级

| Tier | 用途 | 进入执行条件 |
| --- | --- | --- |
| `blog-source` | 本项目公式源头、产品语义、边界描述 | 需要 domain 查询和测试覆盖 |
| `desmos-source` | 历史公式图和推导草稿 | 需要转成结构化输入输出 |
| `paper` | 学术公式、统计模型、风险解释 | 只能补充对照，不能直接替换执行策略 |
| `protocol-whitepaper` | 协议数学，如 Uniswap v3 | 可用于协议状态计算，但不能替代真实仓位数据 |
| `heuristic` | 经验近似，如 probability-of-touch proxy | 默认 research-only |
| `implementation` | 纯工程约束，如 file size、chart pane | 不代表市场公式 |

## 当前公式覆盖目标

| Formula id | 当前状态 | Evidence 状态 | 执行边界 |
| --- | --- | --- | --- |
| `path` | implemented | `implementation` + `blog-source` | 只提供共同 OHLCV 路径 |
| `cost` | implemented | `blog-source` | 可进入默认挂单 |
| `volatility` | implemented | `blog-source` + `desmos-source` | 可进入价格带和风控阈值 |
| `delta-band` | implemented | `blog-source` + `desmos-source` | 可进入默认挂单，但 `d` 只叫 `deltaSlope` |
| `option-greeks` | research-only | `paper` + `desmos-source` | research-only，除非配置真实 option leg |
| `asian-option` | research-only | `paper` + `desmos-source` | payoff fit，不进默认挂单 |
| `lp-inventory` | implemented | `protocol-whitepaper` + `paper` + `desmos-source` + `ethereum-json-rpc` | 已接 Uniswap v3 pool 链上快照；没有 Position NFT 时仍是 research-only |
| `liquidity-fingerprint` | research-only | `desmos-source` + `paper` | 模型目标仓，不是盘口 |
| `amm-geometry` | protocol-unverified | `desmos-source` | 协议未验证，不进执行 |
| `capital-efficiency` | research-only | `paper` + `desmos-source` | 只描述区间几何 |
| `funding` | proxy-only | `paper` + `heuristic` | 未接真实 schedule 时 `proxy-only` |
| `portfolio` | research-only | `paper` + `desmos-source` | 缺真实 leg lifecycle 前不进回放 |
| `order-plan` | implemented | `implementation` + `blog-source` | 只消费 cost / delta-band / account |
| `deviation-score` | implemented | `heuristic` | 可作为执行过滤，不是收益承诺 |
| `risk-surface` | implemented | `paper` | Greeks 研究图，不改写挂单 |
| `net-lp-efficiency` | research-only | `heuristic` | 必须标注缺手续费和再平衡规则 |
| `net-carry` | proxy-only | `heuristic` | 必须消费同周期累计 funding proxy |
| `mean-reversion` | implemented | `heuristic` | 历史衰减速度，不是预测 |
| `gamma-pnl` | implemented | `paper` | convexity research-only |
| `vol-confidence` | implemented | `heuristic` | 样本不确定性展示 |

## 必须修正的语义

- 新输入字段：`deltaSlope`，默认 `0.3`，只传给 `getDeltaBands()`。
- 新输入字段：`exitTargetReturn`，默认 `0`，只传给账户退出和回放目标。
- 旧 `targetReturn` 只允许作为迁移兜底，不再出现在新 UI label 中。
- `fundingRate()` 输出应拆为 `basisEstimate`、`fundingProxy`、`cumulativeFundingEstimate`。
- `netCarry()` 应消费同周期累计 funding，不再二次乘 `holdingDays / tradingDaysPerYear`。
