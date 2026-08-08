# Data Pipeline

Market Lab is static, so market data must be available at build time. Production must not depend on runtime CSV routes working correctly.

## Source Layout

```txt
public/data/*.csv
  source CSV datasets

src/data/stock-index.json
  instrument index used by scripts and UI metadata

src/data/generated/*
  generated JS modules created from CSV files

src/data/lp-onchain-snapshots.json
  aggregated crypto pool snapshots for the liquidity fingerprint layer
```

The generated JS modules let Vite own data delivery in the bundled app. This avoids hosted static fallback problems where `/data/*.csv` can be served as SPA HTML instead of CSV.

## Load Path

```txt
sample.url
  -> src/composables/useDataLoader.js
  -> loadMarketCsv(sample.url)
  -> generated JS CSV text when present
  -> fetch(sample.url) fallback only when generated asset is missing
  -> parseCsvText()
  -> rows + source + cursor
```

## Refreshing Data

Install Python requirements when refreshing market data locally:

```bash
python3 -m pip install -r scripts/requirements-market-data.txt
```

Preview provider plan:

```bash
pnpm run plan:market-data
```

Fetch, convert, generate, and validate:

```bash
pnpm run refresh:market-data
```

Manual step breakdown:

```bash
pnpm run fetch:market-data
node scripts/convert-stocks-xlsx.mjs data/workbooks/stocks_latest.xlsx
pnpm run generate:data
pnpm run check:data
pnpm run check:generated-data
```

`scripts/convert-stocks-xlsx.mjs` defaults to merge mode for `src/data/stock-index.json`. This keeps existing instruments when a provider returns only a partial workbook. Use `--replace-index` only when intentionally rebuilding the full index from the workbook.

Daily coverage policy:

- Prefer data from `2021-01-01` through the current refresh date.
- If the instrument has no data that far back, keep the latest two years.
- `--rows` is only a hard cap; by default it is `0`, so the coverage policy decides the range.

LP on-chain refresh:

```bash
pnpm run fetch:lp-data
```

`scripts/fetch-lp-pool-aggregate.mjs` reads public GeckoTerminal pool aggregates for WETH related pools. The static snapshot keeps pool reserve, 24h volume, trade count, quote price, pair, protocol, and fee where available. Domain code then builds USDT/USDC quote routes from all matching direct pools and WETH-routed pools, so the research layer shows an aggregate pool signal instead of one single ruler.

When Position NFT level detail is needed, run the lower-level RPC script directly:

```bash
pnpm run fetch:lp-uniswap-rpc
```

`scripts/fetch-lp-onchain-data.mjs` reads Uniswap v3 pool state through Ethereum JSON-RPC. Set `ETH_RPC_URL` to use a private RPC and `UNISWAP_V3_POSITION_IDS=123,456` to include actual position NFT snapshots.

## Validation Rules

- Every indexed sample should have a matching CSV.
- Every production CSV should be represented in generated JS data.
- CSV parsing must reject empty or invalid OHLCV rows.
- Source metadata should preserve provider, label, symbol, interval, and URL.
- Build should fail when generated data is stale or missing.

## Provider Notes

The current refresh script uses provider fallbacks for different markets:

- BaoStock for A-shares where available.
- yfinance / akshare for Hong Kong instruments.

Provider behavior can drift. Treat data refresh failures as pipeline issues first, not UI issues.

## Deployment Rule

Do not fix production data misses by adding runtime rescue fetches as the primary path. Fix the build artifact so data exists in `dist/` through generated JS modules.
