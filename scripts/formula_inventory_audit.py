#!/usr/bin/env python3
"""Ensure the human formula inventory names every exported formula/query function."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs/formula-evidence/formula-inventory.md"

SOURCE_FILES = [
    "src/domain/formulas/amm.js",
    "src/domain/formulas/core.js",
    "src/domain/formulas/inputSemantics.js",
    "src/domain/formulas/liquidity.js",
    "src/domain/formulas/lp.js",
    "src/domain/formulas/optionPortfolio.js",
    "src/domain/formulas/options.js",
    "src/domain/formulas/probability.js",
    "src/domain/market-data/cost.js",
    "src/domain/market-data/formulaPath.js",
    "src/domain/strategy-planning/orderPlan.js",
    "src/domain/strategy-planning/strategyProfile.js",
    "src/domain/strategy-planning/formulaStrategy.js",
    "src/domain/replay/dailyReplay.js",
    "src/domain/formula-research/researchSnapshot.js",
    "src/domain/research-visualization/liquidityRackModel.js",
    "src/domain/workbench/traderChecklist.js",
]

EXTRA_REQUIRED_NAMES = [
    "FORMULA_PATH_CURVES",
    "FORMULA_PATH_FIELDS",
    "weightedTypicalCost",
    "costDistance",
    "momentumAt",
    "rollingAnnualVol",
    "priceLeg",
    "aggregateLegs",
    "scenarioLegPnl",
    "expiryLegPnl",
    "classifyOptionPortfolio",
    "signalStrength",
    "minEdge",
    "buyEdge",
    "sellEdge",
    "riskBudget",
    "riskBudgetPct",
    "exposureCap",
    "maxNotional",
    "orderTargetPrice",
    "expectedProfit",
    "warmupDays",
    "accountExit",
    "closeAccountPosition",
    "fillPendingOrder",
    "applyFill",
    "initialExitPlan",
    "orderExitPlan",
    "mergeExitPlan",
    "summarize",
    "feeRate",
    "optionLegPnL",
]

SKIP_EXPORTS = {
    "getFormulaEvidence",
    "getFormulaSourceAudit",
    "getFormulaCapability",
    "getCapabilityStages",
    "getFormulaStage",
    "parseCsvText",
    "parseBinanceKlines",
    "parseOhlcv",
}


def exported_names(source: str) -> set[str]:
    names = set(re.findall(r"export function\s+([A-Za-z0-9_]+)", source))
    names.update(re.findall(r"export const\s+([A-Z][A-Za-z0-9_]+)", source))
    return names


def main() -> int:
    doc = DOC.read_text()
    expected: set[str] = set(EXTRA_REQUIRED_NAMES)
    for rel in SOURCE_FILES:
        path = ROOT / rel
        if not path.exists():
            print(f"missing source file: {rel}", file=sys.stderr)
            return 1
        expected.update(exported_names(path.read_text()))
    expected -= SKIP_EXPORTS

    failures = [name for name in sorted(expected) if f"`{name}`" not in doc]
    if failures:
        print("formula inventory audit failed", file=sys.stderr)
        for name in failures:
            print(f"{name}: missing from docs/formula-evidence/formula-inventory.md", file=sys.stderr)
        return 1
    print(f"formula inventory audit passed: {len(expected)} names covered")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
