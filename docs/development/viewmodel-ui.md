# ViewModel and UI

The UI is a compact workbench. It should prioritize charts, tables, controls, source labels, status signals, and risk hints. It is not a place for long explanations.

## Pinia Facade

Primary file: `src/stores/labStore.js`

The store composes:

- planning inputs and feature flags
- data loader state
- observation date and cursor state
- trading-days-per-year inference and overrides
- market state
- replay side channel
- planning graph
- research graph
- execution brief
- chart overlays and panel state

The store may compose domain outputs, but formulas and trading rules should remain in `src/domain/`.

## Composables

Use composables for UI-side commands and infrastructure:

- `useDataLoader`: generated data loading, import, retry, parse errors
- `useMarketState`: bridge from rows and cursor to market state queries
- `usePlanning`: user planning input, feature flags, panel commands
- `useReplay`: explicit replay query orchestration
- `useChartOverlays`: chart overlay controls
- `usePersisted`: local persistence wrappers

Do not let composables become hidden domain modules. If a calculation needs independent tests or domain vocabulary, move it to `src/domain/`.

## Components

Components should:

- accept props or use the store facade
- render compact controls and status
- emit user intent
- keep labels short
- show source and state for research outputs
- avoid direct sibling state reads

Components should not:

- parse market data
- run hidden planning formulas
- rewrite plan outputs
- fetch production data policies
- run unbounded replay loops in render or hot computed paths

## UI Copy Rules

Use labels, units, status, source markers, risk hints, and blocked reasons. Avoid long prose in the main interface.

Good:

```txt
Source: Yahoo Finance
Replay: spot path only
Blocked: missing account size
Risk: cost anchor below mark price
```

Avoid:

```txt
Long educational paragraphs explaining how the entire formula family works.
```

Put deeper explanation in `docs/` or a separate blog.

## Chart and Layout Notes

- `lightweight-charts` belongs to UI components, not domain.
- Research panes should consume `src/domain/research-visualization/` models.
- Stable control dimensions matter; chart controls should not resize on hover or dynamic state text.
- Keep cards for repeated items, modal-like surfaces, or genuinely framed tools; avoid nested card composition.
