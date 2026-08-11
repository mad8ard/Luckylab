#!/usr/bin/env python3
"""Check registry, evidence catalog, and source audit stay aligned."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_STATUSES = {"implemented", "research-only", "protocol-unverified", "proxy-only"}
SEMANTIC_REGISTRY = ROOT / "docs/formula-evidence/formula-semantic-registry.json"
ERRATA = ROOT / "docs/formula-evidence/ERRATA.md"
ERRATA_ID_RE = re.compile(r"^E-(\d{3})$")
EXTERNAL_SOURCE_RE = re.compile(r"^[a-z][a-z0-9+.-]*://", re.IGNORECASE)
LOCAL_SOURCE_PREFIXES = (".agents/", "docs/", "research/", "scripts/", "src/")
CORRECTION_STATUS_PRECEDENCE = {
    "reopened": 0,
    "open": 1,
    "fixing": 2,
    "fixed": 3,
    "accepted-risk": 4,
    "superseded": 5,
    "verified": 6,
}
SEMANTIC_REQUIRED_KEYS = {
    "formulaId",
    "canonicalTerm",
    "expression",
    "units",
    "timeKnownAt",
    "claimClass",
    "statusAxes",
    "objective",
    "useCases",
    "meaning",
    "domain",
    "constraints",
    "mechanism",
    "allowedInferences",
    "forbiddenInferences",
    "sources",
    "implementation",
    "tests",
    "horizonMode",
}
FORBIDDEN_CANONICAL_FIELDS = {"q", "theta", "rho", "delta", "fees", "targetReturn"}
PRODUCTION_SEMANTIC_ROOTS = (
    "src/domain",
    "src/stores",
    "src/composables",
    "src/components",
    ".agents/skills/china-stock-selection/scripts",
    "research/latent-liquidity-lab/src",
)
PRODUCTION_SOURCE_SUFFIXES = {".js", ".mjs", ".vue", ".pine"}
HIDDEN_FIXED_HORIZON_RE = re.compile(
    r"\b(?:holdingDays|holdDays|formulaHorizonSessions|modelHorizonSessions|recoveryDays|halfLifeSessions|"
    r"timeToExpirySessions)\s*[:=]\s*(?:30|60|90)\b"
)
UNIVERSAL_875_RE = re.compile(r"(?<![\d.])(?:0\.875|87\.5\s*%)(?!\d)")
SOURCE_SEMANTIC_GUARDS = (
    {
        "path": ".agents/skills/china-stock-selection/scripts/selection-helpers.mjs",
        "required": ("meanReversion?.arCoefficient", "meanReversion?.halfLifeSessions", "scoreFreshnessEvidence"),
        "forbidden": (
            r"meanReversion\?\.rho\b",
            r"meanReversion\?\.halfLifeDays\b",
            r"\bstaleDays\s*>\s*30\b",
        ),
    },
    {
        "path": "scripts/formula_wiring_audit.py",
        "required": ("fundingCashflowQuote", "cumulativeFundingProxy"),
        "forbidden": (r"\bfundingCost\s*:",),
    },
    {
        "path": "scripts/verify-domain.mjs",
        "required": ("row.cumulativeFundingProxy", "fundingCashflowQuote"),
        "forbidden": (r"row\.fundingProxy\b",),
    },
    {
        "path": "src/domain/formulas/lpResearch.js",
        "required": ("impermanentLoss: 'lpIlFraction'", "deprecatedInputs"),
        "forbidden": (r"lpIlFraction-with-model-required", r"feeTierFraction-not-fee-income"),
    },
    {
        "path": "src/domain/formula-research/researchSnapshot.js",
        "required": ("fundingCashflowQuote", "cumulativeFundingProxy"),
        "forbidden": (r"Math\.abs\([^\n]*cumulativeFundingProxy", r"fundingSettlementQuote"),
    },
    {
        "path": "src/domain/formulas/liquidity.js",
        "required": ("priceGrid: n",),
        "forbidden": (),
    },
    {
        "path": ".agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs",
        "required": ("staleDays",),
        "forbidden": (r"\bstale(?:Days)?\s*>\s*30\b",),
    },
)


def local_reference_path(reference: str, *, always_local: bool = False) -> tuple[Path, str] | None:
    """Return a repository-local path and fragment, or None for an external/non-path source id."""
    if not isinstance(reference, str) or not reference.strip():
        return None
    value = reference.strip()
    if EXTERNAL_SOURCE_RE.match(value):
        return None
    path_text, separator, fragment = value.partition("#")
    looks_local = always_local or path_text.startswith(LOCAL_SOURCE_PREFIXES) or "/" in path_text
    if not looks_local:
        return None
    return ROOT / path_text, unquote(fragment) if separator else ""


def is_within_root(path: Path) -> bool:
    try:
        path.resolve().relative_to(ROOT.resolve())
    except (OSError, ValueError):
        return False
    return True


def validate_local_references(formula_id: str, item: dict, failures: list[str]) -> None:
    for key in ("implementation", "tests", "sources"):
        references = item.get(key)
        if not isinstance(references, list):
            failures.append(f"{formula_id}: {key} must be a list")
            continue
        for reference in references:
            if not isinstance(reference, str) or not reference.strip():
                failures.append(f"{formula_id}: invalid {key} reference {reference!r}")
                continue
            local = local_reference_path(reference, always_local=key in {"implementation", "tests"})
            if local is None:
                continue
            path, fragment = local
            if not is_within_root(path):
                failures.append(f"{formula_id}: {key} path escapes repository root {reference}")
                continue
            if not path.exists():
                failures.append(f"{formula_id}: missing {key} path {reference}")
                continue
            if key == "sources" and path.suffix.lower() in {".md", ".markdown"} and fragment:
                anchors = markdown_heading_anchors(path)
                if fragment not in anchors:
                    failures.append(f"{formula_id}: missing Markdown heading anchor {reference}")


def markdown_heading_anchors(path: Path) -> set[str]:
    """Build GitHub-style heading anchors, including duplicate-heading suffixes."""
    anchors: set[str] = set()
    counts: dict[str, int] = {}
    in_fence = False
    fence_marker = ""
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.lstrip()
        fence = re.match(r"^(`{3,}|~{3,})", stripped)
        if fence:
            marker = fence.group(1)[0]
            if not in_fence:
                in_fence = True
                fence_marker = marker
            elif marker == fence_marker:
                in_fence = False
                fence_marker = ""
            continue
        if in_fence:
            continue
        match = re.match(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$", line)
        if not match:
            continue
        base = github_heading_slug(match.group(1))
        if not base:
            continue
        duplicate_index = counts.get(base, 0)
        counts[base] = duplicate_index + 1
        anchors.add(base if duplicate_index == 0 else f"{base}-{duplicate_index}")
    return anchors


def validate_source_semantics(failures: list[str]) -> None:
    """Lock the concrete regressions that previously escaped the formula evidence audit."""
    for guard in SOURCE_SEMANTIC_GUARDS:
        rel = guard["path"]
        path = ROOT / rel
        if not path.exists():
            failures.append(f"semantic source guard missing path {rel}")
            continue
        source = path.read_text(encoding="utf-8")
        for required in guard["required"]:
            if required not in source:
                failures.append(f"semantic source guard {rel}: missing required token {required!r}")
        for forbidden in guard["forbidden"]:
            if re.search(forbidden, source):
                failures.append(f"semantic source guard {rel}: forbidden pattern {forbidden!r}")

    for root_rel in PRODUCTION_SEMANTIC_ROOTS:
        root = ROOT / root_rel
        if not root.exists():
            failures.append(f"semantic production scan missing root {root_rel}")
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in PRODUCTION_SOURCE_SUFFIXES:
                continue
            if "__tests__" in path.parts or ".test." in path.name or path.name.endswith(".spec.js"):
                continue
            source = path.read_text(encoding="utf-8")
            rel = path.relative_to(ROOT)
            for match in HIDDEN_FIXED_HORIZON_RE.finditer(source):
                failures.append(f"{rel}: hidden fixed horizon literal {match.group(0)!r}")
            for match in UNIVERSAL_875_RE.finditer(source):
                failures.append(f"{rel}: universal 87.5% literal is forbidden in production source ({match.group(0)!r})")


def github_heading_slug(heading: str) -> str:
    text = re.sub(r"<[^>]*>", "", heading.strip().lower())
    text = re.sub(r"!\[([^]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^]]+)\]\([^)]*\)", r"\1", text)
    text = text.replace("`", "").replace("*", "")
    slug = []
    for char in text:
        if char.isspace():
            slug.append("-")
        elif char in {"-", "_"} or not unicodedata.category(char).startswith("P"):
            slug.append(char)
    return "".join(slug)


def load_errata_table(failures: list[str]) -> dict[str, str]:
    try:
        lines = ERRATA.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        failures.append(f"ERRATA cannot be loaded: {error}")
        return {}

    rows: dict[str, str] = {}
    for line in lines:
        cells = [cell.strip() for cell in line.split("|")]
        if len(cells) < 6 or not ERRATA_ID_RE.fullmatch(cells[1]):
            continue
        errata_id = cells[1]
        status = cells[4].strip("`")
        if errata_id in rows:
            failures.append(f"ERRATA contains duplicate id {errata_id}")
        rows[errata_id] = status

    if not rows:
        failures.append("ERRATA summary table contains no E-nnn rows")
        return rows
    numbers = sorted(int(ERRATA_ID_RE.fullmatch(errata_id).group(1)) for errata_id in rows)
    expected = list(range(1, numbers[-1] + 1))
    if numbers != expected:
        missing = sorted(set(expected) - set(numbers))
        extras = sorted(set(numbers) - set(expected))
        details = []
        if missing:
            details.append(f"missing {','.join(f'E-{number:03d}' for number in missing)}")
        if extras:
            details.append(f"unexpected {','.join(f'E-{number:03d}' for number in extras)}")
        failures.append(f"ERRATA ids must be continuous from E-001 ({'; '.join(details)})")
    return rows


def normalize_errata_coverage(raw: object, failures: list[str]) -> list[dict]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        if isinstance(raw.get("items"), list):
            return raw["items"]
        normalized = []
        for errata_id, value in raw.items():
            if not isinstance(value, dict):
                failures.append(f"errataCoverage.{errata_id} must be an object")
                continue
            normalized.append({"id": errata_id, **value})
        return normalized
    failures.append("semantic registry errataCoverage must be a list or object map")
    return []


def validate_errata_coverage(semantic: dict, formulas: list[dict], failures: list[str]) -> None:
    if "errataCoverage" not in semantic:
        failures.append("semantic registry must contain errataCoverage")
        return
    errata_rows = load_errata_table(failures)
    detail_ids = {
        f"E-{match.group(1)}"
        for anchor in markdown_heading_anchors(ERRATA)
        for match in re.finditer(r"(?:^|-)e-(\d{3})(?=-|$)", anchor)
    }
    for missing_id in sorted(set(errata_rows) - detail_ids):
        failures.append(f"ERRATA detail heading missing {missing_id}")
    for extra_id in sorted(detail_ids - set(errata_rows)):
        failures.append(f"ERRATA detail heading has unknown {extra_id}")
    coverage = normalize_errata_coverage(semantic.get("errataCoverage"), failures)
    formula_ids = {item.get("formulaId") for item in formulas if isinstance(item, dict)}
    seen: dict[str, dict] = {}

    for entry in coverage:
        if not isinstance(entry, dict):
            failures.append(f"errataCoverage entry must be an object: {entry!r}")
            continue
        errata_id = entry.get("id", entry.get("errataId"))
        if not isinstance(errata_id, str) or not ERRATA_ID_RE.fullmatch(errata_id):
            failures.append(f"errataCoverage has invalid id {errata_id!r}")
            continue
        if errata_id in seen:
            failures.append(f"errataCoverage contains duplicate id {errata_id}")
            continue
        seen[errata_id] = entry
        expected_status = errata_rows.get(errata_id)
        actual_status = entry.get("status")
        if expected_status is None:
            failures.append(f"errataCoverage contains id absent from ERRATA table: {errata_id}")
        elif actual_status != expected_status:
            failures.append(
                f"{errata_id}: errataCoverage/ERRATA status mismatch {actual_status!r} != {expected_status!r}"
            )
        linked_ids = entry.get("formulaIds")
        if not isinstance(linked_ids, list) or not linked_ids:
            failures.append(f"{errata_id}: formulaIds must be a non-empty list")
            continue
        invalid_linked_ids = [formula_id for formula_id in linked_ids if not isinstance(formula_id, str)]
        if invalid_linked_ids:
            failures.append(f"{errata_id}: formulaIds must contain only strings")
        valid_linked_ids = [formula_id for formula_id in linked_ids if isinstance(formula_id, str)]
        if len(valid_linked_ids) != len(set(valid_linked_ids)):
            failures.append(f"{errata_id}: formulaIds must be unique")
        for formula_id in valid_linked_ids:
            if formula_id not in formula_ids:
                failures.append(f"{errata_id}: unknown formulaId {formula_id!r}")

    coverage_ids = set(seen)
    errata_ids = set(errata_rows)
    for missing_id in sorted(errata_ids - coverage_ids):
        failures.append(f"errataCoverage missing {missing_id}")
    for extra_id in sorted(coverage_ids - errata_ids):
        failures.append(f"errataCoverage has unexpected {extra_id}")

    formula_statuses: dict[str, list[str]] = {}
    for errata_id, entry in seen.items():
        status = entry.get("status")
        if status not in CORRECTION_STATUS_PRECEDENCE:
            failures.append(f"{errata_id}: correction status {status!r} has no aggregation precedence")
            continue
        linked_ids = entry.get("formulaIds", [])
        if not isinstance(linked_ids, list):
            continue
        for formula_id in linked_ids:
            if isinstance(formula_id, str) and formula_id in formula_ids:
                formula_statuses.setdefault(formula_id, []).append(status)

    formulas_by_id = {item.get("formulaId"): item for item in formulas if isinstance(item, dict)}
    for formula_id, statuses in formula_statuses.items():
        expected_status = min(statuses, key=CORRECTION_STATUS_PRECEDENCE.__getitem__)
        actual_status = formulas_by_id[formula_id].get("statusAxes", {}).get("correctionStatus")
        if actual_status != expected_status:
            failures.append(
                f"{formula_id}: aggregated correctionStatus mismatch {actual_status!r} != {expected_status!r} "
                f"from {sorted(set(statuses))}"
            )


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
    validate_source_semantics(failures)

    try:
        semantic = json.loads(SEMANTIC_REGISTRY.read_text())
    except (OSError, json.JSONDecodeError) as error:
        semantic = None
        failures.append(f"semantic registry cannot be loaded: {error}")

    if semantic:
        formulas = semantic.get("formulas")
        if not isinstance(formulas, list) or not formulas:
            failures.append("semantic registry must contain a non-empty formulas list")
            formulas = []
        ids = [item.get("formulaId") if isinstance(item, dict) else None for item in formulas]
        if len(ids) != len(set(ids)):
            failures.append("semantic registry formulaId values must be unique")
        enums = semantic.get("enums", {})
        for item in formulas:
            if not isinstance(item, dict):
                failures.append(f"semantic registry formula entry must be an object: {item!r}")
                continue
            formula_id = item.get("formulaId", "<missing-id>")
            missing = sorted(SEMANTIC_REQUIRED_KEYS - set(item))
            if missing:
                failures.append(f"{formula_id}: semantic registry missing {', '.join(missing)}")
            status_axes = item.get("statusAxes", {})
            for axis, enum_key in (
                ("correctionStatus", "correctionStatus"),
                ("implementationStatus", "implementationStatus"),
                ("productStatus", "productStatus"),
                ("executionAuthority", "executionAuthority"),
            ):
                if status_axes.get(axis) not in enums.get(enum_key, []):
                    failures.append(f"{formula_id}: invalid {axis} {status_axes.get(axis)}")
            if item.get("horizonMode") not in enums.get("horizonMode", []):
                failures.append(f"{formula_id}: invalid horizonMode {item.get('horizonMode')}")
            for claim_key, claim in item.get("claimClass", {}).items():
                if claim_key == "reason":
                    continue
                if claim not in enums.get("claimClass", []):
                    failures.append(f"{formula_id}: invalid claim class {claim}")
            for term in item.get("canonicalTerm", []):
                field = term.get("field") if isinstance(term, dict) else None
                if field in FORBIDDEN_CANONICAL_FIELDS:
                    failures.append(f"{formula_id}: forbidden ambiguous canonical field {field}")
            validate_local_references(formula_id, item, failures)
        validate_errata_coverage(semantic, formulas, failures)

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
