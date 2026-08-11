# Formula Evidence Coverage

Market Lab 的公式层要从“公式展示”升级成“公式证据编排”。本目录记录实现前的约束和交付蓝图，所有后续代码改动应先对齐这里的边界。

## 目标

- 保持 Market Lab 是纯静态工作台：运行时仍是 Vue + Vite + Pinia + lightweight-charts。
- 公式必须先进入 `src/domain/`，再由 store/composable 映射到 UI。
- 默认挂单只消费经过 domain 明确建模的执行查询结果。
- 研究层公式可以展示在 K 线上，但必须带来源、状态和缺失条件。
- Python 只做离线审计和报告，不进入浏览器运行时。

## 文档结构

- `formula-semantic-registry.json`：机器可读公式语义事实源；记录单位、时点、claim class、状态轴和执行权限。
- `formula-contract.md`：面向人的详细公式表；逐项写使用场景、意义、范围、约束、成因、可推出和不能推出。
- `ERRATA.md`：已确认错误、正确口径、修复状态和升为 `verified` 的验收条件。
- `evidence-catalog.md`：公式证据模型、来源等级、当前公式覆盖表。
- `formula-reference.md`：公式本体、变量语义、输出字段和图表落点。
- `formula-inventory.md`：当前实现里的公式函数、派生量和执行公式完整索引。
- `wiring-audit.md`：逐项接线审计矩阵，防止 catalog-only / 空实现。
- `implementation-roadmap.md`：分阶段实现顺序和文件边界。
- `chart-coverage.md`：类 TradingView 曲线、pane、marker 和 overlay 分组。
- `python-audit.md`：`uv` 虚拟环境 + Poetry 依赖事实源 + 离线脚本约定。
- `academic-sources.md`：论文、白皮书、技术文档进入 evidence 层的规则。

## 核心原则

1. `deltaSlope` 是 GetDelta 里的 `d`，不是退出收益目标。
2. `exitTargetReturn` 是账户退出计划的收益目标，不能反向改写 GetDelta 价格带。
3. `markPrice`、`entryPrice`、`costAnchor`、`strikePrice`、`startPrice` 必须分开。
4. LP v3 真实区间模型必须消费 `lowerPrice / upperPrice / liquidity / currentPrice`。
5. Funding 在未接真实交易所结算制度前只能标记为 `proxy-only`。
6. 所有图表曲线必须来自统一 `formulaPath` 或明确的 domain query model，组件不临时写公式。
7. 公式正确、输入可靠、结果已校准和允许执行是四个独立判断；不得跨层升级。
8. 历史 query 必须满足前缀不变性；全局不得用 30/60/90 等隐藏固定周期。
9. 期权 Greek 必须带资产和时间单位；缺失 Greek 传播 `null`，不能汇总成零风险。
10. 流动性模型的波动率和年交易会话基准必须显式输入；归一化 mass 在校准前不是概率。
