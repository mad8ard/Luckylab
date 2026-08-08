# Architecture

Market Lab follows DDD, MVVM, high cohesion, low coupling, and CQRS. These are implementation constraints, not labels.

## Runtime Shape

```txt
User interaction
  -> Vue component
  -> composable or Pinia command
  -> pure domain query / state builder
  -> UI-ready ViewModel state
  -> chart, table, control, status signal
```

The deployed app is static:

```txt
public/data/*.csv
  -> scripts/csv2js.mjs
  -> src/data/generated/*
  -> Vite build
  -> dist/
```

## Layer Rules

| Layer | Owns | Must not own |
| --- | --- | --- |
| `src/domain/` | formulas, market state, planning, replay, research query models | Vue, Pinia, DOM, chart APIs, browser fetch |
| `src/stores/` | ViewModel facade and cross-domain orchestration | hidden formulas or silent plan overrides |
| `src/composables/` | commands, persistence, data loading, UI-side orchestration | pure business rules that should be tested in domain |
| `src/components/` | compact views, controls, status labels, events | implicit formulas, data fetching policy, cross-component state peeking |
| `src/styles/` | visual layout and interface domains | behavior |
| `scripts/` | build checks, audits, data preprocessing | runtime application state |

## CQRS Rule

Query side:

- Pure calculations in `src/domain/`.
- Deterministic inputs and outputs.
- Test with Vitest without mounting Vue.
- No writes to persisted UI state.

Command side:

- User input mutation, cursor changes, data import, sample selection, replay toggles, and panel state live in store or composables.
- Commands may call domain queries, then publish derived ViewModel state.
- Commands should not hide failed data, missing inputs, or invalid formulas behind default success.

## Dependency Direction

Use [Bounded Context Map](../bounded-context-map.md) as the authority. In short:

```txt
Workbench UI -> domain query models
StrategyPlanning -> MarketData + executable formula primitives
ReplayAccount -> MarketData + StrategyPlanning
ResearchVisualization -> MarketData + FormulaResearch + StrategyPlanning
```

Forbidden:

```txt
domain/* -> Vue / Pinia / DOM / chart library
MarketData -> StrategyPlanning
FormulaResearch -> StrategyPlanning default conclusions
ResearchVisualization -> StrategyPlanning writes
```

## Change Placement

Before adding behavior, choose one owner:

- Formula math: `src/domain/formulas/`
- Factual market state: `src/domain/market-data/`
- Candidate plan and account requirements: `src/domain/strategy-planning/`
- Replay path: `src/domain/replay/`
- Research-only snapshot or chart model: `src/domain/formula-research/` or `src/domain/research-visualization/`
- UI command or persistence: `src/composables/` or `src/stores/`
- Visual control: `src/components/`

If a change needs two owners, create a pure query result in the domain owner and map it in the ViewModel layer.
