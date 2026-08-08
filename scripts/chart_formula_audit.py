#!/usr/bin/env python3
"""Check chart formula-path fields have pane/source/unit metadata and non-empty data."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def node_summary() -> dict:
    code = """
      import { readFile } from 'node:fs/promises'
      import { buildMarketState } from './src/domain/market-data/cost.js'
      import { FORMULA_PATH_FIELDS, buildFormulaPath } from './src/domain/market-data/formulaPath.js'
      import { formulaEvidenceCatalog } from './src/domain/formulas/evidence.js'
      import { parseCsvText } from './src/domain/market-data/ohlcv.js'
      const rows = parseCsvText(await readFile('./public/data/600519-1d.csv', 'utf8')).slice(-220)
      const market = buildMarketState(rows)
      const lpOnchainSnapshot = {
        hasPool: true,
        hasPosition: false,
        pool: { label: 'A股 模拟聚合池' },
        pools: [],
        quoteRoutes: [],
        poolCoverage: { reserveUsd: 1000000, volumeUsd24h: 240000, topPoolReserveShare: 0.68 },
        quotePrice: market.markPrice,
        quoteSymbol: 'CNY',
      }
      const input = {
        entryPrice: market.markPrice,
        holdingDays: 30,
        iv: market.annualVol,
        deltaSlope: 0.3,
        exitTargetReturn: 0,
        strikePrice: market.markPrice * 1.05,
        riskFreeRate: 0.04,
        optionType: 'put',
        startPrice: market.costAnchor,
        rangeWidth: 0.1,
        skew: 1,
        liquidity: 1,
        perpTwap: market.markPrice * 1.0002,
        spotTwap: market.markPrice,
        lpOnchainSnapshot,
      }
      const path = buildFormulaPath(rows, input)
      const fallbackPath = buildFormulaPath(rows.slice(-80), { ...input, perpTwap: null, spotTwap: null, lpOnchainSnapshot: null })
      const summary = {}
      for (const key of Object.keys(path[0] ?? {})) {
        summary[key] = path.filter((row) => Number.isFinite(row[key])).length
      }
      console.log(JSON.stringify({
        fields: FORMULA_PATH_FIELDS,
        evidenceIds: formulaEvidenceCatalog.map((entry) => entry.id),
        length: path.length,
        summary,
        statuses: [...new Set([...path, ...fallbackPath].flatMap((row) => row.status ?? []))]
      }))
    """
    result = subprocess.run(["node", "--input-type=module", "-e", code], cwd=ROOT, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def main() -> int:
    data = node_summary()
    failures = []
    fields = data["fields"]
    evidence_ids = set(data["evidenceIds"])
    chart_source = (ROOT / "src/components/MainChart.vue").read_text()
    if data["length"] <= 0:
        failures.append("formulaPath is empty")
    for field, meta in fields.items():
        if not meta.get("source") or not meta.get("unit") or not meta.get("pane") or not meta.get("status"):
            failures.append(f"{field}: missing metadata")
        if meta.get("source") not in evidence_ids and meta.get("source") != "formula-path":
            failures.append(f"{field}: source {meta.get('source')} has no evidence entry")
        if meta.get("numeric", True) and data["summary"].get(field, 0) <= 0:
            failures.append(f"{field}: no finite chart data")
        if meta.get("drawable") and field not in chart_source:
            failures.append(f"{field}: MainChart does not consume formulaPath field")
    for required_status in ["proxy-only", "research-only", "missing-input", "fallback-input"]:
        if required_status not in data["statuses"]:
            failures.append(f"status marker missing: {required_status}")
    if failures:
        print("chart formula audit failed", file=sys.stderr)
        for failure in failures:
            print(failure, file=sys.stderr)
        return 1
    drawable = sum(1 for meta in fields.values() if meta.get("drawable"))
    print(f"chart formula audit passed: {len(fields)} fields covered, {drawable} drawable curves")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
