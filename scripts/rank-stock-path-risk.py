#!/usr/bin/env python3
"""Rank current A shares by the path-risk evidence in an existing audit snapshot."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "src" / "data" / "stock-index.json"
AUDIT_PATH = ROOT / "reports" / "stock-pool-quality-20261114.json"
METRICS = (
    ("belowAnchorRatio", "成本锚下侧比例"),
    ("annualizedLogSlope", "年化对数价格斜率"),
    ("maxCloseDrawdown", "收盘口径最大回撤"),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--top", type=int, default=20)
    parser.add_argument(
        "--output-prefix",
        default="stock-path-risk-top20-20261114",
        help="File name prefix under reports/",
    )
    args = parser.parse_args()
    if args.top < 1:
        parser.error("--top must be positive")
    return args


def main() -> None:
    args = parse_args()
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    current_a = {
        entry["symbol"]: entry
        for entry in index
        if entry.get("market") == "A股"
    }
    audit = json.loads(AUDIT_PATH.read_text(encoding="utf-8"))
    audit_by_symbol = {
        record["symbol"]: record
        for record in audit["records"]
        if record.get("market") == "A股"
    }
    missing = sorted(set(current_a) - set(audit_by_symbol))
    if missing:
        raise RuntimeError(f"existing audit snapshot is missing current A shares: {missing}")

    records = []
    for symbol, entry in current_a.items():
        audit_record = audit_by_symbol[symbol]
        path = audit_record["path"]
        financial = audit_record.get("financial", {})
        records.append(
            {
                "symbol": symbol,
                "name": entry.get("label") or audit_record["name"],
                "industry": financial.get("industry"),
                "belowAnchorRatio": path["belowAnchorRatio"],
                "annualizedLogSlope": path["annualizedLogSlope"],
                "maxCloseDrawdown": path["maxCloseDrawdown"],
                "worst20SessionReturn": path["worst20SessionReturn"],
                "dataFrom": path["dataFrom"],
                "dataThrough": path["dataThrough"],
            }
        )

    # Rank from low risk (0) to high risk (100). For slope and drawdown,
    # negate the value so that more negative remains "larger" risk.
    risk_values = {
        "belowAnchorRatio": [record["belowAnchorRatio"] for record in records],
        "annualizedLogSlope": [
            -record["annualizedLogSlope"] for record in records
        ],
        "maxCloseDrawdown": [
            -record["maxCloseDrawdown"] for record in records
        ],
    }
    percentile_by_metric = {
        key: average_rank_percentiles(values)
        for key, values in risk_values.items()
    }
    for index, record in enumerate(records):
        components = {
            key: percentile_by_metric[key][index]
            for key, _ in METRICS
        }
        record["percentiles"] = components
        record["pathRiskScore"] = sum(components.values()) / len(components)

    ranked = sorted(
        records,
        key=lambda record: (
            -record["pathRiskScore"],
            record["worst20SessionReturn"],
            record["symbol"],
        ),
    )
    for rank, record in enumerate(ranked, start=1):
        record["riskRank"] = rank
    top = ranked[: args.top]
    industry_groups = group_by_industry(top)

    payload = {
        "sourceAudit": str(AUDIT_PATH.relative_to(ROOT)),
        "population": len(records),
        "topN": args.top,
        "method": {
            "description": "equal-weight average of empirical risk percentiles",
            "metrics": [label for _, label in METRICS],
            "worst20SessionReturn": "displayed only; not scored",
            "percentileDirection": "higher means less healthy",
        },
        "industryGroups": industry_groups,
        "items": top,
    }
    output_prefix = ROOT / "reports" / args.output_prefix
    output_prefix.with_suffix(".json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_csv(output_prefix.with_suffix(".csv"), top)
    output_prefix.with_suffix(".md").write_text(
        render_markdown(payload),
        encoding="utf-8",
    )
    print(f"Ranked {len(records)} current A shares from existing local data.")
    print(f"Top {args.top}: {output_prefix.with_suffix('.md')}")


def average_rank_percentiles(values: list[float]) -> list[float]:
    ordered = sorted(range(len(values)), key=lambda index: values[index])
    ranks = [0.0] * len(values)
    offset = 0
    while offset < len(ordered):
        end = offset + 1
        while end < len(ordered) and values[ordered[end]] == values[ordered[offset]]:
            end += 1
        average_rank = (offset + end - 1) / 2
        for position in range(offset, end):
            ranks[ordered[position]] = average_rank
        offset = end
    denominator = max(1, len(values) - 1)
    return [rank / denominator * 100 for rank in ranks]


def group_by_industry(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        industry = item.get("industry") or "行业缺失"
        groups.setdefault(industry, []).append(item)
    return [
        {
            "industry": industry,
            "count": len(members),
            "items": [
                {
                    "riskRank": member["riskRank"],
                    "symbol": member["symbol"],
                    "name": member["name"],
                    "pathRiskScore": member["pathRiskScore"],
                }
                for member in members
            ],
        }
        for industry, members in sorted(
            groups.items(),
            key=lambda pair: (-len(pair[1]), pair[0]),
        )
        if len(members) > 1
    ]


def render_markdown(payload: dict[str, Any]) -> str:
    items = payload["items"]
    through = Counter(item["dataThrough"] for item in items)
    lines = [
        f"# 当前 A 股 K 线路径风险末 {payload['topN']} 只",
        "",
        "- 数据来源：现有本地质量审视快照，没有重新联网或下载行情。",
        f"- 当前 A 股总体：{payload['population']} 只。",
        "- 排序分：锚下比例、负斜率和最大回撤的横截面风险百分位等权平均；100 最不健康。",
        "- 最差 20 日跌幅只作旁证，不参与排序分。",
        "- 本名单只供审视，没有修改股票池。",
        f"- 入选股票行情截止日：{', '.join(f'{day}: {count} 只' for day, count in sorted(through.items()))}。",
        "",
        "| 排名 | 代码 | 名称 | 行业 | 路径风险分 | 成本锚下侧 | 年化斜率 | 最大回撤 | 最差20日 | 行情截止 |",
        "| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for item in items:
        lines.append(
            f"| {item['riskRank']} | {item['symbol']} | {item['name']} | "
            f"{item.get('industry') or '缺失'} | "
            f"{item['pathRiskScore']:.1f} | {item['belowAnchorRatio']:.1%} | "
            f"{item['annualizedLogSlope']:.1%} | {item['maxCloseDrawdown']:.1%} | "
            f"{item['worst20SessionReturn']:.1%} | {item['dataThrough']} |"
        )
    lines.extend(["", "## 同行业群体", ""])
    if payload["industryGroups"]:
        for group in payload["industryGroups"]:
            members = "、".join(
                f"{item['symbol']} {item['name']}（{item['pathRiskScore']:.1f}）"
                for item in group["items"]
            )
            lines.append(f"- {group['industry']}：{group['count']} 只，{members}。")
    else:
        lines.append("末 50 只中没有重复行业。")
    lines.extend(
        [
            "",
            "> “路径风险分”是本次样本内的相对排名，不是下跌概率，也不构成交易建议。",
            "",
        ]
    )
    return "\n".join(lines)


def write_csv(path: Path, items: list[dict[str, Any]]) -> None:
    fields = [
        "riskRank",
        "symbol",
        "name",
        "industry",
        "pathRiskScore",
        "belowAnchorRatio",
        "annualizedLogSlope",
        "maxCloseDrawdown",
        "worst20SessionReturn",
        "dataFrom",
        "dataThrough",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for item in items:
            writer.writerow({field: item[field] for field in fields})


if __name__ == "__main__":
    main()
