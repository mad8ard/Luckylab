# Quality Gates

Run the smallest useful gate while developing, then run the full gate before merge.

## Fast Local Checks

```bash
pnpm test
pnpm run verify:domain
```

Use these after domain, store, or component changes.

## Data Checks

```bash
pnpm run generate:data
pnpm run check:data
pnpm run check:generated-data
```

Use these after changing `public/data/`, `src/data/stock-index.json`, or data pipeline scripts.

## File Size Check

```bash
pnpm run check:size
```

This enforces the `src/` file-size rule. If a source file grows past the limit, split by responsibility instead of hiding the warning.

## Domain Boundary Check

```bash
pnpm run check:domain-boundary
```

Enforces the DDD boundary in `AGENTS.md`: `src/domain/` may not import Vue, Pinia, or chart libraries. If a file under `src/domain/` needs framework features, move it to `src/composables/` or `src/stores/` first.

## Full Build Gate

```bash
pnpm run build
```

The build runs:

1. generated data refresh
2. size check
3. domain boundary check
4. data index check
5. generated data check
6. domain verification
7. Vite production build

## Pine Gate

```bash
pnpm run verify:pine
```

Run this when any Pine file or Pine-related output changes.

## Formula Audit

```bash
pnpm run audit:formulas
```

Use this when formula evidence, source status, formula wiring, or chart coverage changes. It depends on the Python audit toolchain declared in the repository.

## Test Placement

- Pure math and planning behavior: `src/domain/__tests__/` or a focused domain test directory.
- Indicators: colocated tests under `src/domain/indicators/__tests__/`.
- Components: `src/components/__tests__/`.
- Composables: `src/composables/__tests__/`.
- Store orchestration: `src/stores/__tests__/`.

## Lint and Format

```bash
pnpm run lint           # ESLint full scan (warnings allowed, 0 errors required)
pnpm run lint:fix       # auto-fix what's auto-fixable
pnpm run format         # Prettier write all files
pnpm run format:check   # Prettier check only
```

Husky pre-commit runs `lint-staged` automatically, scoped to changed files.

## Coverage Gate

```bash
pnpm run test:cov
```

Runs Vitest with V8 coverage, scoped to `src/domain/**`. Writes `coverage/` (text report to terminal, HTML to `coverage/index.html`, JSON summary). Thresholds enforced:

| metric     | threshold |
| ---------- | --------- |
| lines      | 80%       |
| statements | 75%       |
| functions  | 85%       |
| branches   | 60%       |

Drop below any of these and the command exits non-zero. Thresholds sit slightly under the current baseline (lines 82.21% / statements 76.44% / functions 89.11% / branches 64.2% as of 2026-05) so accidents are caught early but normal feature work is not blocked.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every PR:

1. `pnpm install --frozen-lockfile`
2. `pnpm run lint`
3. `pnpm test`
4. `pnpm run build`
5. `pnpm run verify:pine` (only when Pine files changed)

Skipped on commits that only touch `public/data/**`, `src/data/stock-index.json`, `src/data/lp-onchain-snapshots.json`, `docs/**`, or top-level `*.md` files.

## Before Merge

Run:

```bash
pnpm test
pnpm run build
```

Also run:

```bash
pnpm run verify:pine
```

when Pine is touched.
