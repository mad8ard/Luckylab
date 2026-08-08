# Implementation Roadmap

## Phase 1: Evidence First

- 新增 `src/domain/formulas/evidence.js`，导出 `formulaEvidenceCatalog` 和查询函数。
- 让 `formulaStages`、`formulaSourceAudit`、`formulaEvidenceCatalog` 的 id 对齐。
- 不改 UI，不改图表，不改公式数值。
- 增加 `source_coverage_audit.py` 文档对应的最小脚本。

验收：

- `pnpm test`
- `pnpm run verify:domain`
- `uv run python scripts/source_coverage_audit.py`

## Phase 2: Semantic Split

- 把 `targetReturn` 拆成 `deltaSlope` 与 `exitTargetReturn`。
- `getDeltaBands()` 只消费 `deltaSlope`。
- `buildDecisionGraph()` 的默认目标仍以成本锚为主，`exitTargetReturn` 只作为账户退出目标补充。
- `buildDailyReplay()` 只用 `exitTargetReturn` 处理退出，不再把 GetDelta 的 `d` 当收益目标。
- UI label 改为：`目标增量 d` 与 `退出目标%` 两个不同控件。

验收：

- 添加回归测试：`deltaSlope=0.3` 不会默认生成 `+30%` 退出目标。
- 添加兼容测试：旧输入只带 `targetReturn` 时可以迁移为 `deltaSlope`。

## Phase 3: LP and Funding Corrections

- 新增真实 v3 hedged position 查询：消费 `markPrice/startPrice/lowerPrice/upperPrice/liquidity/hedgeSize/fees`。
- 原 `uniswapV3Payoff()` / 对称 payoff 保留，但 evidence status 标成 `symmetric-approx`。
- Funding 拆成 basis estimate、funding proxy、cumulative funding estimate。
- `netCarry()` 消费同周期累计 funding，不能再次乘持仓天数。

验收：

- skew 区间测试：`skew !== 1` 时真实 v3 lower/upper 不被折成对称区间。
- funding 测试：8 小时 proxy 与 30 天 proxy 分别只累计一次。

## Phase 4: Formula Path Coverage

- 扩展 `buildFormulaPath()`，输出所有可画曲线字段。
- 为每个字段声明 `formulaId`、单位、status、pane。
- 当前 K 线 hover 只读取 `rows/costPath/formulaPath` 同 index 数据。

验收：

- `verify:domain` 检查 `formulaPath` 覆盖所有 chart series。
- `chart_formula_audit.py` 检查曲线元数据和非空覆盖。

## Phase 5: Chart Rollout

- 重构 overlay 分组为 `priceBands/greeksPane/lpPane/carryPane/executionMarkers/researchMarkers`。
- 主图只展示价格类曲线。
- 风险类曲线进入子图，默认关闭。
- research/proxy/protocol 状态必须显示在 legend 或 marker。

验收：

- BTC/NVDA/TSLA 全部曲线可打开。
- 图表不在组件内写业务公式。
- research-only 不会被显示成执行信号。

