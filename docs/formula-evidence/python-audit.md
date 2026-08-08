# Python Offline Audit

Python 只做离线审计和报告，不进入前端运行时。项目习惯：

- `uv` 管虚拟环境和执行入口。
- Poetry 是依赖事实管理源。
- 默认脚本尽量只用标准库；如果必须引入 pandas/numpy，要先写进 `pyproject.toml` 并说明原因。

## 目录约定

```txt
scripts/
  formula_audit.py
  chart_formula_audit.py
  source_coverage_audit.py
docs/formula-evidence/
  *.md
tmp/formula-audit/       # git ignored, 离线输出
```

## pyproject 约定

建议新增最小 `pyproject.toml`：

```toml
[project]
name = "market-lab-audit"
version = "0.1.0"
description = "Offline formula audit tools for Market Lab"
authors = [{ name = "Market Lab" }]
requires-python = ">=3.12,<3.15"
dependencies = []

[tool.poetry]
package-mode = false

[build-system]
requires = ["poetry-core>=2.0.0"]
build-backend = "poetry.core.masonry.api"
```

## 命令约定

```bash
uv run --no-project --with poetry poetry check
uv run --no-project python scripts/source_coverage_audit.py
uv run --no-project python scripts/formula_inventory_audit.py
uv run --no-project python scripts/formula_wiring_audit.py
uv run --no-project python scripts/chart_formula_audit.py
uv run --no-project python scripts/formula_audit.py
pnpm run audit:formulas
```

`pnpm run audit:formulas` 只作为手动审计命令，不加入默认 `pnpm run build`。

## formula_audit.py

职责：

- 读取固定样本：BTC、NVDA、TSLA。
- 用 Python 独立重算 GetDelta、Black-Scholes、Bachelier、LP v3 inventory、IL、CE、funding proxy。
- 读取 JS 导出的 audit JSON 或通过固定 fixture 对比。
- 输出差异：`formulaId/date/field/jsValue/pythonValue/absError/relError/tolerance`。

不做：

- 不改写 `public/data/`。
- 不生成前端运行时依赖文件。
- 不替代 Vitest。

## chart_formula_audit.py

职责：

- 检查每条 chart series 是否有 formula id、单位、pane、status。
- 检查 `formulaPath` 上对应字段是否存在并有非空覆盖。
- 检查 research-only/proxy-only/protocol-unverified 是否能在 chart legend 或 marker 上显示。

## source_coverage_audit.py

职责：

- `formulaStages` 中每个 id 必须能在 `formulaEvidenceCatalog` 找到。
- `formulaSourceAudit` 中每个 id 必须能映射到 evidence entry。
- 所有 `research-only` / `proxy-only` / `protocol-unverified` 必须有 `boundary` 或 `missingInputs`。
- 所有 `executable: true` 必须有测试覆盖说明。
