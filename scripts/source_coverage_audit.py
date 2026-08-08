#!/usr/bin/env python3
"""Check registry, evidence catalog, and source audit stay aligned."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_STATUSES = {"implemented", "research-only", "protocol-unverified", "proxy-only"}


def load_domain() -> dict:
    code = """
      import { formulaEvidenceCatalog } from './src/domain/formulas/evidence.js'
      import { formulaStages } from './src/domain/formulas/registry.js'
      import { formulaSourceAudit } from './src/domain/formulas/sourceAudit.js'
      console.log(JSON.stringify({ formulaEvidenceCatalog, formulaStages, formulaSourceAudit }))
    """
    result = subprocess.run(["node", "--input-type=module", "-e", code], cwd=ROOT, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def main() -> int:
    domain = load_domain()
    stages = {item["id"]: item for item in domain["formulaStages"]}
    evidence = {item["id"]: item for item in domain["formulaEvidenceCatalog"]}
    source_audit = {item["id"]: item for item in domain["formulaSourceAudit"]}
    failures = []

    if set(stages) != set(evidence):
        failures.append("registry and evidence catalog ids differ")
    if set(stages) != set(source_audit):
        failures.append("registry and source audit ids differ")

    for sid, stage in stages.items():
        if sid not in evidence:
            failures.append(f"{sid}: missing evidence catalog entry")
        elif stage.get("status") != evidence[sid].get("status"):
            failures.append(f"{sid}: registry/evidence status mismatch {stage.get('status')} != {evidence[sid].get('status')}")
        if stage.get("status") not in ALLOWED_STATUSES:
            failures.append(f"{sid}: invalid registry status {stage.get('status')}")
        for key in ("inputs", "outputs", "formulas"):
            if not stage.get(key):
                failures.append(f"{sid}: registry missing {key}")

    for eid, item in evidence.items():
        if eid not in stages:
            failures.append(f"{eid}: evidence entry has no registry stage")
        if item.get("status") not in ALLOWED_STATUSES:
            failures.append(f"{eid}: invalid evidence status {item.get('status')}")
        if not item.get("inputs") or not item.get("outputs"):
            failures.append(f"{eid}: evidence missing IO")
        if item.get("sourceTier") in {"paper", "desmos-source", "protocol-whitepaper"} and not item.get("sources"):
            failures.append(f"{eid}: external/protocol source tier must name at least one source")

    for sid, item in source_audit.items():
        if sid not in evidence:
            failures.append(f"{sid}: source audit has no evidence entry")
        if not item.get("inputs") or not item.get("outputs") or not item.get("boundary"):
            failures.append(f"{sid}: source audit missing IO/boundary")

    if not {"delta-band", "order-plan"}.issubset({sid for sid, item in evidence.items() if item.get("executable")}):
        failures.append("executable evidence must include delta-band and order-plan")
    if {sid for sid, item in evidence.items() if item.get("executionDecision")} != {"order-plan"}:
        failures.append("only order-plan may be marked executionDecision")
    if "delta-band" not in {sid for sid, item in evidence.items() if item.get("executionInput")}:
        failures.append("delta-band must be marked executionInput")
    if any(evidence[sid].get("executable") for sid in ["portfolio", "funding", "net-carry"] if sid in evidence):
        failures.append("research/proxy carry formulas must not be executable")

    if failures:
        print("source coverage audit failed", file=sys.stderr)
        for failure in failures:
            print(failure, file=sys.stderr)
        return 1
    print(f"source coverage audit passed: {len(stages)} registry stages, {len(evidence)} evidence entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
