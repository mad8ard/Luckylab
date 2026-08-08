# Troubleshooting

Use this page for repo-local symptoms before assuming the browser or hosted runtime is wrong.

## Right-Side Market List Looks Incomplete

Check the index and CSV counts:

```bash
pnpm run check:data
node -e "const x=require('./src/data/stock-index.json'); console.log(x.length)"
find public/data -name '*.csv' | wc -l
```

Expected shape:

- `src/data/stock-index.json` contains indexed stock and ETF samples.
- `public/data/*.csv` matches the indexed A-share and Hong Kong samples.
- `src/App.vue` merges `lab.marketSamples` with `src/data/stock-index.json` for the right panel.

Common causes:

- A partial workbook was converted with replace semantics.
- `src/data/stock-index.json` was edited without matching CSV files.
- Generated JS modules are stale after changing CSV files.
- The right panel is showing collapsed groups; group counts may still be correct.

Fix path:

```bash
node scripts/convert-stocks-xlsx.mjs data/workbooks/stocks_latest.xlsx
pnpm run generate:data
pnpm run check:data
pnpm run check:generated-data
```

`scripts/convert-stocks-xlsx.mjs` defaults to merge mode. Use `--replace-index` only when a complete workbook should intentionally replace the whole index.

## Hosted App Cannot Load CSV Data

Do not rely on runtime `/data/*.csv` fetches as the primary production path. Hosted static routing can return SPA fallback HTML for data URLs.

Expected production path:

```txt
public/data/*.csv
  -> scripts/csv2js.mjs
  -> src/data/generated/*
  -> Vite bundle
  -> dist/
```

Checks:

```bash
pnpm run generate:data
pnpm run check:generated-data
pnpm run build
```

If local CSV files exist but production still fails, inspect whether generated data modules were built and deployed before changing runtime fetch logic.

## Market Data Refresh Fails

First verify the plan without provider imports:

```bash
pnpm run plan:market-data
```

Then install Python requirements and fetch:

```bash
python3 -m pip install -r scripts/requirements-market-data.txt
pnpm run fetch:market-data
```

Provider notes:

- BaoStock is the primary A-share source.
- yfinance and akshare cover Hong Kong and US samples.
- Alpha Vantage is optional and requires `ALPHA_VANTAGE_API_KEY`.

Provider failures can be partial. A partial workbook should update available samples without shrinking the index.

## Build Fails With Missing Node Packages

If hosted Amplify fails with missing packages such as `rolldown` or `picomatch` while install claims everything is current, suspect cached `node_modules` corruption.

The intended hosted build behavior is:

```txt
preBuild:
  install pinned pnpm
  remove node_modules
  pnpm install --frozen-lockfile
```

Keep `node_modules` out of hosted cache unless the cache issue has been revalidated.

## Formula Output Looks Wrong

Before touching UI:

```bash
pnpm run verify:domain
pnpm run audit:formulas
```

Then inspect:

- `docs/formula-evidence/` for source and status.
- `src/domain/formulas/` for math primitives.
- `src/domain/strategy-planning/` for executable plan rules.
- `src/domain/formula-research/` for research-only outputs.

Do not patch a component to correct a domain formula. Fix the query model and tests first.

## Replay Freezes Or Feels Heavy

Replay must be bounded or explicitly triggered. Check for historical loops inside hot computed paths.

Expected ownership:

- Replay behavior: `src/domain/replay/`
- Replay orchestration: `src/composables/useReplay.js`
- UI rendering: components only consume prepared replay state

If portfolio behavior is needed, model option, LP, hedge, funding, fee, and rebalance legs explicitly before calling it a portfolio backtest.
