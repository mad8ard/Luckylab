# Market Lab

Market Lab is a static market workbench for inspecting OHLCV paths, cost anchors, volatility bands, formula research outputs, and candidate order plans in one compact interface.

Live site: [https://www.0xff.tools/](https://www.0xff.tools/)

中文简介：Market Lab 是一个纯静态市场路径实验台，用来把 K 线数据、成本锚、波动带、公式研究层和模拟挂单计划放在同一个可检查工作台里。

Market Lab is not a blog, an auto-trading bot, or financial advice. It is a research and pre-execution workbench: charts, controls, state labels, source status, risk hints, and simulated plans belong in the app; long essays, research notes, and derivations belong in `docs/` or the external blog.

## Features

- Three-panel market workbench: instrument/formula navigation, main chart, facts and plan panel.
- Static OHLCV datasets for A-shares and Hong Kong stocks.
- Market state modeling: rolling VWAP cost anchor, cost band, ATR, annualized volatility, momentum, and observation date.
- `GetDelta` price bands from entry price, holding time, IV, and target return.
- Candidate order planning that consumes explicit domain outputs: cost state, formula bands, account inputs, and strategy profile.
- Research-only visualization for option Greeks, LP inventory, funding, AMM geometry, portfolio curves, and liquidity fingerprinting.
- Explicit spot path replay side channel; research metrics do not silently become default trading conclusions.

中文辅助：主界面是工作台，不是文章页；默认计划只能消费经过 domain 明确建模的结果。

## Quick Start

```bash
pnpm install
pnpm run dev
```

Open the Vite dev server URL printed in your terminal.

Common commands:

```bash
pnpm test              # Run Vitest
pnpm run verify:domain # Verify domain-level numeric behavior
pnpm run check:data    # Check static data index consistency
pnpm run check:size    # Enforce src file size limits
pnpm run build         # Full static production build into dist/
pnpm run preview       # Preview the built dist/ output locally
```

When Pine-related files are changed, also run:

```bash
pnpm run verify:pine
```

## Stack

- Vue 3 + JavaScript + Vite
- Pinia as the ViewModel/state layer
- lightweight-charts for the main chart
- d3-dsv for CSV parsing
- Vitest for domain and component tests
- pnpm for package and script management

The project stays fully static. Production output is `dist/`, with no backend service required.

中文辅助：这是 Vue 3 + Vite 的纯静态部署项目，构建产物直接发布 `dist/`。

## Project Structure

```txt
src/
  App.vue                  # Three-panel workbench shell
  main.js                  # Vue / Pinia / style entry
  domain/                  # Pure domain logic; no Vue, Pinia, DOM, or chart dependency
    formulas/              # GetDelta, option, LP, AMM, funding, and related formulas
    market-data/           # OHLCV parsing, tdpy, cost path, market state
    strategy-planning/     # Default condition table, account inputs, candidate orders
    replay/                # Spot path replay query model
    formula-research/      # Research-layer snapshot
    research-visualization/# Research view models
  stores/                  # Pinia facade / ViewModel orchestration
  composables/             # UI commands, persistence, data loading, replay, overlays
  components/              # Workbench components
  styles/                  # CSS split by interface domain
  canvas/                  # Formula graph canvas
  data/                    # Instrument index

public/data/               # Static CSV datasets
docs/                      # Architecture boundaries, formula evidence, design handoffs
scripts/                   # Build checks, formula audits, data preprocessing
```

See [docs/bounded-context-map.md](./docs/bounded-context-map.md) for the bounded context map.

## Architecture Rules

Market Lab is maintained around DDD, MVVM, high cohesion, low coupling, and CQRS:

- `src/domain/` contains pure business rules and query models. It must not import Vue, Pinia, DOM APIs, chart libraries, or browser APIs.
- Vue components handle presentation and interaction only.
- Pinia stores and composables orchestrate ViewModel state and map domain outputs into UI-ready models.
- Query paths stay pure and testable; commands such as importing data, changing inputs, switching modes, and triggering replay live in the ViewModel layer.
- The default order plan can only consume explicitly modeled domain query results. Research visualizations cannot rewrite the executable plan.
- Before adding behavior, place it in the right responsibility bucket: formula, market state, planning, replay, account simulation, ViewModel, or presentation.
- Keep `markPrice`, `entryPrice`, `costAnchor`, `strikePrice`, and `startPrice` semantically separate.

Source files should stay under 500 lines when possible. `pnpm run build` runs size, data, and domain checks before bundling.

中文辅助：领域公式和业务规则先沉到 `src/domain/`；组件不写隐式业务公式，store/composable 负责命令和 ViewModel 编排。

## Data and Formula Status

The static data directory currently contains 160+ CSV samples. Datasets are exposed through `src/data/stock-index.json` and `src/domain/market-data/ohlcv.js`; the build checks that index entries and files stay consistent.

Market data refresh is intentionally offline-first:

```bash
python3 -m pip install -r scripts/requirements-market-data.txt
pnpm run plan:market-data
pnpm run refresh:market-data
```

`scripts/fetch-market-data.py` builds a local OHLCV workbook from real providers: BaoStock first for A-shares, yfinance / akshare for Hong Kong instruments. The default coverage policy keeps daily data from `2021-01-01` to now; instruments without that much history keep the latest two years. `scripts/convert-stocks-xlsx.mjs` converts that workbook into `public/data/*.csv` and merges refreshed entries into `src/data/stock-index.json`, so a partial provider run does not shrink the right-side market list. Use `--replace-index` only when intentionally rebuilding the whole index. `scripts/fetch-lp-onchain-data.mjs` writes Uniswap v3 pool / optional position snapshots into `src/data/lp-onchain-snapshots.json`. `scripts/csv2js.mjs` then bundles the CSV files into `src/data/generated/` so Vite owns data delivery on Amplify instead of relying on runtime `/data/*.csv` fetches.

中文辅助：不要把 CSV 当成线上运行时接口。刷新数据后必须重新跑 `generate:data`，让 Amplify 发布 JS 化的数据资产。

`refresh:market-data` 链路在 `generate:data` 之后会自动运行 `generate:recommended-pool`，按当日 J / RSI / 成本与 LP 关键区域计算 `buyScore`，写出 `src/data/recommended-pools/stock-pool-YYYY-MM-DD.json` 与 `src/data/recommended-pool-latest.json`。页面会把 `recommended-pool-latest.json` 直接渲染到主区域的「今日推荐股票池」模块（DOM 直渲，方便 OpenClaw 抓取后推送企业微信）。手动重新生成可单独运行：

```bash
pnpm run generate:recommended-pool
```

Formula surfaces are split into two categories:

- Executable layer: market path, cost anchor, volatility basis, `GetDelta` bands, default condition table, and candidate order plan.
- Research layer: Black-Scholes, LP inventory, AMM, funding, capital efficiency, portfolio curves, and liquidity fingerprint. Research outputs must carry source, status, and limitation labels; they do not drive default order conclusions.

Formula evidence and audit docs live in [docs/formula-evidence/README.md](./docs/formula-evidence/README.md).

## Deployment

The project is configured for automatic static deployment. The live site is [https://www.0xff.tools/](https://www.0xff.tools/).

The hosting platform reads [amplify.yml](./amplify.yml):

1. Install pnpm.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm run build`.
4. Publish `dist/`.

Before merging to `main`, run:

```bash
pnpm test
pnpm run build
```

中文辅助：自动发布已配置好，合并到 `main` 后会按 `amplify.yml` 构建并发布 `dist/`。

## License

This project is released under `AGPL-3.0-or-later`. See [LICENSE](./LICENSE) for the full legal text.

If you distribute this project, distribute modified versions, build derivative works, or provide a modified version over a network, you must comply with the AGPL source-sharing obligations. For closed-source products, closed-source SaaS, closed internal distribution, or scenarios where AGPL compliance is not possible, obtain separate written permission first.

This README summarizes the licensing posture for collaboration only. The `LICENSE` file is authoritative.

中文辅助：本项目不是宽松许可证项目；闭源集成、闭源 SaaS 或无法履行 AGPL 义务的使用场景需要单独授权。

## Risk Notice

Market Lab provides research, observation, and simulation outputs only. It is not investment advice, trading advice, or a promise of returns. Users must independently verify market data, formula outputs, research indicators, and candidate order plans.

中文辅助：所有数据、公式和模拟挂单都只用于研究与观察，不构成投资建议。
