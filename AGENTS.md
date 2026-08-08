# Agent Guide

## 项目形态

- 这是独立的纯静态 Market Lab，使用 Vue 3、JavaScript、Vite、Pinia、lightweight-charts 和 pnpm。
- 保持静态部署：`pnpm run build`，发布 `dist/`。
- 这不是 blog。长解释、研究笔记、公式文章和日志放回 blog。

## 架构

- `src/domain/`：纯公式、市场、计划和回放逻辑，不引入 Vue。
- `src/stores/`：Pinia ViewModel，只负责把 domain 输出接到 UI 状态。
- `src/components/`：紧凑工作台组件，优先图表、表格、控件和状态信号。
- `src/styles/`：按界面域拆 CSS。
- `public/data/`：静态数据集。

## 架构约束

- 整体实现必须满足 DDD、MVVM、高内聚、低耦合和 CQRS。
- DDD：公式、市场状态、挂单计划、回放、账户模拟等业务规则必须先沉到 `src/domain/`，用明确输入输出表达领域概念；组件和 store 不写隐式业务公式。
- MVVM：Vue 组件只负责视图和交互，Pinia store / composable 承担 ViewModel 编排，把 domain 结果映射成 UI 可消费状态。
- 高内聚：同一模块只处理一个稳定职责；新增行为前先判断应放在公式、市场、计划、回放、ViewModel 还是展示组件里。
- 低耦合：`src/domain/` 不依赖 Vue、Pinia、DOM、图表库或浏览器 API；组件之间不要互相读取内部状态，通过 props、emit、store 或 domain 输出连接。
- CQRS：计算/查询路径和命令/修改路径分开。查询函数保持纯计算和可测试；导入数据、修改输入、切换模式、触发回放等命令集中在 store/composable 层。
- 默认挂单结论只能消费经过 domain 明确建模的查询结果；研究层可视化必须标注来源和状态，不能绕过 CQRS 直接改写计划。

## 产品规则

- Lab 是工作台，不是文章。
- 主界面不要放长段落。
- 前端文字以标签、单位、状态、风险提示和来源标记为主。
- 公式关系必须先成为结构化输入输出，再进入 UI。
- 不要混用 `markPrice`、`entryPrice`、`costAnchor`、`strikePrice` 和 `startPrice`。

## 公式规则

- `GetDelta(price, T, iv, profit)` 是任意入场价和持仓时间上的价格带引擎。
- `OrderPlan` 必须消费公式带和市场成本状态，不能另起一套无关梯度公式。
- Black-Scholes、LP 库存、funding、资本效率默认属于风险层和组合层。
- 回放和账户模拟必须有边界或异步执行，不要在热 computed 里跑无界历史计算。

## 文件尺寸

- 源文件尽量保持在 500 行以内。
- 增加行为前先按职责拆文件。

## GitFlow

- `main` 只放可发布的静态版本；不要在 `main` 上直接堆功能改动。
- 日常开发从 `main` 拉 `feature/<scope>` 分支；修线上问题用 `hotfix/<scope>`；发布整理用 `release/<version>`。
- 每个分支只处理一个明确主题，提交前跑 `pnpm test` 和 `pnpm run build`；涉及 Pine 时补跑 `pnpm run verify:pine`。
- 合并回 `main` 前确认工作区只包含本次主题文件；截图、页面快照、临时检查日志不要提交。
- 合并后推送 `main`，并保留清楚的提交信息：`feat:`、`fix:`、`docs:`、`build:`、`test:`。
