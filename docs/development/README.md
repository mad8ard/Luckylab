# Developer Guide

Market Lab is a pure static Vue 3 workbench for market path inspection, formula research, replay, and candidate order planning. The production artifact is `dist/`; there is no backend service in the runtime path.

中文辅助：这是工作台，不是 blog。开发文档解释系统边界、代码职责和维护流程；长文章和研究日志不要塞进主界面。

## Local Setup

```bash
pnpm install
pnpm run dev
```

The dev server runs Vite after generating bundled market data modules.

Common commands:

```bash
pnpm test
pnpm run verify:domain
pnpm run check:data
pnpm run check:generated-data
pnpm run check:size
pnpm run build
```

Run this when Pine files change:

```bash
pnpm run verify:pine
```

## Code Map

```txt
src/
  domain/                  pure formulas, market state, planning, replay, research models
  stores/                  Pinia ViewModel facade
  composables/             UI commands, persistence, data loading, replay, overlays
  components/              compact workbench views and controls
  canvas/                  formula graph canvas
  styles/                  CSS split by interface domain
  data/                    sample index and generated bundled CSV modules

public/data/               source CSV datasets used by the static build
scripts/                   build checks, data refresh, audits, Pine verification
docs/                      developer docs, formula evidence, handoffs
```

## Development Workflow

1. Start from a narrow feature or hotfix branch.
2. Identify the owner before editing: domain, ViewModel, component, data pipeline, script, or docs.
3. Add or update the smallest useful test or verification gate.
4. Run focused checks while iterating.
5. Run `pnpm test` and `pnpm run build` before merge.
6. Update this docs tree when commands, data flow, architecture, or release behavior changes.

## Maintenance Principles

- Domain logic goes into `src/domain/` before it reaches store or UI.
- Vue components should show state and emit user intent; they should not own business formulas.
- Store and composables are the ViewModel and command layer.
- Query functions stay pure and testable.
- Commands such as data import, mode switch, cursor change, and replay trigger stay outside pure domain modules.
- Default order conclusions may only consume explicitly modeled domain query outputs.
- Research visualizations must label source and status, and must not rewrite the executable plan.
- Keep source files under 500 lines when possible; `pnpm run check:size` enforces this for `src/`.

## Read Next

1. [Contribution Workflow](./contributing.md)
2. [Architecture](./architecture.md)
3. [Domain Boundaries](./domain-boundaries.md)
4. [Data Pipeline](./data-pipeline.md)
5. [Quality Gates](./quality-gates.md)
6. [Troubleshooting](./troubleshooting.md)
7. [Release and GitFlow](./release-gitflow.md)
