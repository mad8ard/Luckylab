# canvas/ — 暂停维护的画布原型

> 状态：**Deprecated / Frozen**（自 2026-05-28 起）
> 当前未被任何外部模块 import。保留代码以便未来复活画布化公式图功能。

## 内容

- `CanvasShell.vue` — 整个画布外壳，承载多卡片拖拽布局
- `DraggableCard.vue` — 卡片容器，处理拖拽与边界
- `FormulaGraph.vue` — 公式图视图模型 + 节点/连线渲染
- `composables/` — 画布交互复用逻辑

## 为什么保留而不删

- 画布化公式图是项目早期方向，主线切到工作台后被"暂时雪藏"
- 重新启用时这套结构仍然是可行的起点（DraggableCard 的边界与 hit-testing 不易复现）
- 删除后可从 git history 恢复，但团队上下文容易丢

## 被复活的触发条件（任一满足即可重新维护）

1. 主工作台需要"自由布局多个公式 / 多个回放对比"
2. 用户研究 / 教学场景需要拖拽式公式图编辑
3. 决定开"画布模式"作为主入口

## 重新启用步骤

1. 在 `src/App.vue` 或新增的 `CanvasView.vue` 里 import `CanvasShell.vue`
2. 在路由 / 入口切换处增加画布 / 工作台双模式选择
3. 跑 `pnpm test` 与 `pnpm run build` 确认 canvas/ 内的依赖没有腐烂
4. 删除本 README 里的 Deprecated 标记

## 维护策略（在 frozen 状态下）

- ESLint / Prettier / TypeCheck 仍会扫这里，**不要放任 errors**
- 但**不主动重构 / 不投入新功能**（铁律 2：不写投机性代码）
- 如果发现 canvas/ 阻碍主线（例如阻塞 ESLint flat config 升级），优先**整体送回收站**而非局部修补
