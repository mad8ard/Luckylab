# Contribution Workflow

This project stays maintainable when every change has a clear owner, a narrow branch, and a matching verification gate.

## Change Routing

| Change type | Primary owner | Required follow-up |
| --- | --- | --- |
| Formula math or market state | `src/domain/` | domain tests or `pnpm run verify:domain` |
| Order planning behavior | `src/domain/strategy-planning/` | tests for triggered, blocked, and invalid states |
| Data refresh or sample metadata | `scripts/`, `public/data/`, `src/data/` | `pnpm run check:data`, `pnpm run check:generated-data` |
| UI control or chart presentation | `src/components/`, `src/styles/` | component or store test when behavior changes |
| ViewModel orchestration | `src/stores/`, `src/composables/` | store or composable tests |
| Pine output | Pine files and verification scripts | `pnpm run verify:pine` |
| Developer workflow | `docs/development/` | update index links if adding pages |

If a feature crosses owners, keep the business rule in the domain owner and map it through the ViewModel. Components should receive structured state instead of reconstructing formulas.

## Branch Scope

Use GitFlow branch names:

```txt
feature/<scope>
hotfix/<scope>
release/<version>
```

Keep one branch to one topic. Do not mix a data refresh, UI redesign, and formula change unless the user explicitly asked for a single coordinated release.

## Before Editing

- Read the nearest owner doc under `docs/development/`.
- Check `git status --short` and preserve unrelated user changes.
- Confirm whether generated data or ignored local artifacts will be touched.
- For data work, remember that `src/data/generated/` is generated and ignored.

## While Editing

- Use domain vocabulary consistently.
- Keep source files under 500 lines when possible.
- Prefer structured parsing and explicit input/output objects over ad hoc string handling.
- Keep commands and queries separate: pure query code should not mutate persisted UI state.
- Add docs close to the behavior changed. The public README should stay concise and user-facing.

## Before Merge

Run:

```bash
pnpm test
pnpm run build
```

Also run focused gates when relevant:

```bash
pnpm run verify:pine
pnpm run audit:formulas
pnpm run refresh:market-data
```

Do not stage screenshots, temporary workbooks, generated local logs, page snapshots, or `dist/`.
