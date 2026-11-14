#!/usr/bin/env python3
"""Audit the A-share pool without modifying src/data/stock-index.json.

The output is a review artifact. It intentionally keeps the raw evidence and
does not implement a pool-removal command.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "src" / "data" / "stock-index.json"
REPORT_DIR = ROOT / "reports"
QUARTER_ENDS = ("20260331", "20260630", "20260930")
QUARTER_LABELS = ("2026Q1", "2026Q2", "2026Q3")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--market-cap-yi", type=float, default=500.0)
    parser.add_argument("--material-loss-reduction", type=float, default=0.20)
    parser.add_argument("--below-anchor-min", type=float, default=0.62)
    parser.add_argument("--annual-slope-max", type=float, default=-0.18)
    parser.add_argument("--max-drawdown-max", type=float, default=-0.75)
    parser.add_argument("--output-prefix", default="stock-pool-quality-20261114")
    return parser.parse_args()


def load_a_share_index() -> list[dict[str, Any]]:
    items = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    stocks = [item for item in items if item.get("market") == "A股"]
    symbols = [item["symbol"] for item in stocks]
    if len(symbols) != len(set(symbols)):
        raise RuntimeError("A-share index contains duplicate symbols")
    return stocks


def tencent_quote_symbol(symbol: str) -> str:
    if symbol.startswith("6"):
        return f"sh{symbol}"
    if symbol.startswith(("0", "3")):
        return f"sz{symbol}"
    raise ValueError(f"unsupported A-share symbol: {symbol}")


def fetch_market_caps(symbols: list[str], batch_size: int = 60) -> dict[str, dict[str, Any]]:
    """Fetch Tencent's current quote snapshot.

    Field 45 is total market capitalisation in CNY 100m on the verified quote
    payload. Field 44 is float market capitalisation.
    """

    session = requests.Session()
    session.trust_env = False
    result: dict[str, dict[str, Any]] = {}
    for offset in range(0, len(symbols), batch_size):
        batch = symbols[offset : offset + batch_size]
        url = "http://qt.gtimg.cn/q=" + ",".join(tencent_quote_symbol(s) for s in batch)
        response = session.get(url, timeout=20)
        response.raise_for_status()
        response.encoding = "gbk"
        for fragment in response.text.split(";"):
            if "~" not in fragment or "=" not in fragment:
                continue
            fields = fragment.split("=", 1)[1].strip().strip('"').split("~")
            if len(fields) <= 45:
                continue
            symbol = fields[2]
            try:
                total_cap_yi = float(fields[45])
            except ValueError:
                continue
            if total_cap_yi > 0:
                result[symbol] = {
                    "quoteName": fields[1],
                    "totalMarketCapYi": total_cap_yi,
                    "floatMarketCapYi": safe_float(fields[44]),
                }
    missing = sorted(set(symbols) - set(result))
    if missing:
        raise RuntimeError(f"Tencent quote missing symbols: {missing}")
    return result


def fetch_financial_reports(
    symbols: set[str], material_reduction: float
) -> dict[str, dict[str, Any]]:
    """Fetch and convert cumulative net profit into single-quarter net profit."""

    try:
        import akshare as ak
        import pandas as pd
    except ImportError as exc:
        raise RuntimeError("AkShare and pandas are required for financial reports") from exc

    cumulative: dict[str, dict[str, dict[str, Any]]] = {}
    for quarter_end in QUARTER_ENDS:
        frame = ak.stock_yjbb_em(date=quarter_end)
        required = {"股票代码", "股票简称", "净利润-净利润", "最新公告日期", "所处行业"}
        missing = required - set(frame.columns)
        if missing:
            raise RuntimeError(f"AkShare fields changed, missing: {sorted(missing)}")
        frame = frame[frame["股票代码"].astype(str).str.zfill(6).isin(symbols)].copy()
        frame["股票代码"] = frame["股票代码"].astype(str).str.zfill(6)
        frame["最新公告日期"] = pd.to_datetime(frame["最新公告日期"], errors="coerce")
        frame = frame.sort_values("最新公告日期").drop_duplicates("股票代码", keep="last")
        cumulative[quarter_end] = {
            row["股票代码"]: {
                "name": row["股票简称"],
                "industry": None if pd.isna(row["所处行业"]) else str(row["所处行业"]),
                "cumulativeNetProfit": safe_float(row["净利润-净利润"]),
                "announcementDate": (
                    None
                    if pd.isna(row["最新公告日期"])
                    else row["最新公告日期"].date().isoformat()
                ),
            }
            for _, row in frame.iterrows()
        }

    result: dict[str, dict[str, Any]] = {}
    for symbol in symbols:
        reports = [cumulative[quarter_end].get(symbol) for quarter_end in QUARTER_ENDS]
        if not all(reports):
            result[symbol] = {
                "status": "数据缺失",
                "missingQuarters": [
                    label
                    for label, report in zip(QUARTER_LABELS, reports)
                    if report is None
                ],
            }
            continue
        cumulative_values = [report["cumulativeNetProfit"] for report in reports]
        if not all(math.isfinite(value) for value in cumulative_values):
            result[symbol] = {"status": "数据缺失", "missingQuarters": list(QUARTER_LABELS)}
            continue
        q1 = cumulative_values[0]
        q2 = cumulative_values[1] - cumulative_values[0]
        q3 = cumulative_values[2] - cumulative_values[1]
        single_quarters = [q1, q2, q3]
        reductions = [
            loss_reduction(single_quarters[0], single_quarters[1]),
            loss_reduction(single_quarters[1], single_quarters[2]),
        ]
        all_losses = all(value < 0 for value in single_quarters)
        material_transitions = [
            reduction is not None and reduction >= material_reduction
            for reduction in reductions
        ]
        if not all_losses:
            repair_status = "非连续亏损"
        elif all(material_transitions):
            repair_status = "连续三季亏损且每季均明显减亏"
        elif any(material_transitions):
            repair_status = "连续三季亏损但仅部分季度明显减亏"
        else:
            repair_status = "连续三季亏损且无任何明显减亏"
        result[symbol] = {
            "status": "ok",
            "name": reports[-1]["name"],
            "industry": reports[-1]["industry"],
            "announcementDates": [report["announcementDate"] for report in reports],
            "cumulativeNetProfitYi": [value / 1e8 for value in cumulative_values],
            "quarterNetProfitYi": [value / 1e8 for value in single_quarters],
            "lossReductions": reductions,
            "threeQuarterLoss": all_losses,
            "strictNoRepair": all_losses and not all(material_transitions),
            "clearNoRepair": all_losses and not any(material_transitions),
            "repairStatus": repair_status,
        }
    return result


def loss_reduction(previous: float, current: float) -> float | None:
    """Positive means the current-period loss narrowed materially in percentage terms."""

    if previous >= 0 or current >= 0:
        return None
    return 1.0 - abs(current) / abs(previous)


def read_ohlcv(url: str) -> list[dict[str, float | str]]:
    path = ROOT / "public" / url.lstrip("/")
    rows: list[dict[str, float | str]] = []
    with path.open("r", encoding="utf-8", newline="") as handle:
        for raw in csv.DictReader(handle):
            row = {
                "date": raw["Date"],
                "open": safe_float(raw["Open"]),
                "high": safe_float(raw["High"]),
                "low": safe_float(raw["Low"]),
                "close": safe_float(raw["Close"]),
                "volume": safe_float(raw["Volume"]),
            }
            if all(math.isfinite(row[key]) for key in ("high", "low", "close", "volume")):
                rows.append(row)
    if len(rows) < 2:
        raise RuntimeError(f"insufficient OHLCV rows: {path}")
    return rows


def market_path_metrics(rows: list[dict[str, float | str]]) -> dict[str, Any]:
    """Compute the pool's exact prefix-causal cost-anchor path plus risk context."""

    volume_sum = [0.0]
    weighted_typical_sum = [0.0]
    typical_sum = [0.0]
    for row in rows:
        typical = (row["high"] + row["low"] + row["close"]) / 3.0
        volume_sum.append(volume_sum[-1] + row["volume"])
        weighted_typical_sum.append(weighted_typical_sum[-1] + typical * row["volume"])
        typical_sum.append(typical_sum[-1] + typical)

    below_anchor = 0
    peak = -math.inf
    max_drawdown = 0.0
    log_closes: list[float] = []
    latest_anchor = None
    anchors: list[float] = []
    for index, row in enumerate(rows):
        visible_rows = index + 1
        cost_window = max(5, int(math.sqrt(visible_rows)))
        start = max(0, visible_rows - cost_window)
        raw_volume = volume_sum[visible_rows] - volume_sum[start]
        if raw_volume > 0:
            anchor = (
                weighted_typical_sum[visible_rows] - weighted_typical_sum[start]
            ) / raw_volume
        else:
            anchor = (typical_sum[visible_rows] - typical_sum[start]) / (
                visible_rows - start
            )
        anchors.append(anchor)
        latest_anchor = anchor
        below_anchor += row["close"] < anchor
        peak = max(peak, row["close"])
        max_drawdown = min(max_drawdown, row["close"] / peak - 1.0)
        log_closes.append(math.log(row["close"]))

    count = len(rows)
    x_mean = (count - 1) / 2.0
    y_mean = sum(log_closes) / count
    numerator = sum((index - x_mean) * (value - y_mean) for index, value in enumerate(log_closes))
    denominator = sum((index - x_mean) ** 2 for index in range(count))
    daily_log_slope = numerator / denominator
    annual_log_slope = daily_log_slope * 252.0
    worst_20d_return = min(
        (rows[index]["close"] / rows[index - 20]["close"] - 1.0 for index in range(20, count)),
        default=0.0,
    )
    recent_window = max(3, int(math.sqrt(max(5, int(math.sqrt(count))))))
    previous_anchor_index = max(0, count - 1 - recent_window)
    previous_anchor = anchors[previous_anchor_index]
    recent_anchor_slope = (
        (latest_anchor - previous_anchor) / previous_anchor
        if previous_anchor > 0
        else None
    )
    return {
        "dataFrom": rows[0]["date"],
        "dataThrough": rows[-1]["date"],
        "rows": count,
        "belowAnchorRatio": below_anchor / count,
        "latestClose": rows[-1]["close"],
        "latestCostAnchor": latest_anchor,
        "latestBelowAnchor": rows[-1]["close"] < latest_anchor,
        "maxCloseDrawdown": max_drawdown,
        "annualizedLogSlope": annual_log_slope,
        "worst20SessionReturn": worst_20d_return,
        "recentCostAnchorSlope": recent_anchor_slope,
    }


def build_audit(
    stocks: list[dict[str, Any]],
    market_caps: dict[str, dict[str, Any]],
    financials: dict[str, dict[str, Any]],
    args: argparse.Namespace,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for stock in stocks:
        symbol = stock["symbol"]
        path = market_path_metrics(read_ohlcv(stock["url"]))
        quote = market_caps[symbol]
        finance = financials[symbol]
        low_cap = quote["totalMarketCapYi"] < args.market_cap_yi
        strict_no_repair = bool(finance.get("strictNoRepair"))
        clear_no_repair = bool(finance.get("clearNoRepair"))
        path_unhealthy = (
            path["belowAnchorRatio"] >= args.below_anchor_min
            and path["annualizedLogSlope"] <= args.annual_slope_max
            and path["maxCloseDrawdown"] <= args.max_drawdown_max
        )
        reasons = []
        if low_cap:
            reasons.append("总市值低于阈值")
        if strict_no_repair:
            reasons.append("三季连亏且未做到每季明显减亏")
        if path_unhealthy:
            reasons.append("成本锚/斜率/回撤路径风险")
        if not finance or finance.get("status") != "ok":
            reasons.append("财报数据缺失")
        records.append(
            {
                "symbol": symbol,
                "name": quote["quoteName"],
                "market": stock["market"],
                **quote,
                "financial": finance,
                "path": path,
                "lowCap": low_cap,
                "strictNoRepair": strict_no_repair,
                "clearNoRepair": clear_no_repair,
                "pathUnhealthy": path_unhealthy,
                "reasons": reasons,
                "removalCandidate": low_cap or strict_no_repair or path_unhealthy,
            }
        )
    return records


def render_markdown(
    records: list[dict[str, Any]], args: argparse.Namespace, generated_at: str
) -> str:
    low_caps = sorted(
        (record for record in records if record["lowCap"]),
        key=lambda record: record["totalMarketCapYi"],
    )
    losses = sorted(
        (record for record in records if record["financial"].get("threeQuarterLoss")),
        key=lambda record: record["financial"]["quarterNetProfitYi"][-1],
    )
    path_risks = sorted(
        (record for record in records if record["pathUnhealthy"]),
        key=lambda record: record["path"]["annualizedLogSlope"],
    )
    candidates = [record for record in records if record["removalCandidate"]]
    definite_candidates = [
        record
        for record in records
        if record["lowCap"] or record["clearNoRepair"] or record["pathUnhealthy"]
    ]
    financial_review = [
        record
        for record in records
        if record["strictNoRepair"]
        and not record["clearNoRepair"]
        and not record["lowCap"]
        and not record["pathUnhealthy"]
    ]
    missing = [record for record in records if record["financial"].get("status") != "ok"]
    multi_reason = [record for record in candidates if len(record["reasons"]) >= 2]
    through = Counter(record["path"]["dataThrough"] for record in records)

    lines = [
        "# A 股池质量审视候选名单",
        "",
        f"- 生成时间：{generated_at}",
        f"- A 股总数：{len(records)}",
        f"- 按当前规则形成的候选：{len(candidates)} 只（尚未删除）",
        f"- 其中按“低市值 / 完全无减亏 / 路径不健康”可直接判定的稳健候选：{len(definite_candidates)} 只",
        f"- 连亏但有一季明显减亏、需要你决定财务口径的观察项：{len(financial_review)} 只",
        f"- 明确低市值：{len(low_caps)} 只",
        f"- 最近三季连续亏损：{len(losses)} 只",
        f"- 严格财务口径下无修复迹象：{sum(record['strictNoRepair'] for record in records)} 只",
        f"- 完全没有任何减亏的明确样本：{sum(record['clearNoRepair'] for record in records)} 只",
        f"- K 线路径不健康：{len(path_risks)} 只",
        f"- 同时命中至少两类：{len(multi_reason)} 只",
        f"- 财报缺失：{len(missing)} 只",
        "",
        "## 口径",
        "",
        f"- 市值：腾讯行情总市值，阈值为低于 {args.market_cap_yi:.0f} 亿元。",
        "- 财务：2026Q1、Q2、Q3 单季净利润；由年内累计净利润逐级相减得到。",
        f"- 财务修复：相邻季度亏损额缩小至少 {args.material_loss_reduction:.0%} 才算明显减亏。",
        "- 严格口径：只要有一个相邻季度没有做到明显减亏，就列为未修复；报告同时标出完全没有任何减亏的样本。",
        "- 成本锚：复用项目定义，逐日使用前缀自适应窗口内成交额加权的典型价。",
        f"- 路径不健康：锚下比例 ≥ {args.below_anchor_min:.0%}，同时年化对数价格斜率 ≤ {args.annual_slope_max:.0%}，且收盘口径最大回撤 ≤ {args.max_drawdown_max:.0%}。",
        "- 年化斜率是整段可用历史的趋势描述，不是“下跌概率”。最差 20 日跌幅作为额外冲击参考。",
        f"- 行情截止日分布：{', '.join(f'{day}: {count} 只' for day, count in sorted(through.items()))}。",
        "",
        "## 多重风险交集",
        "",
    ]
    if multi_reason:
        lines.extend(
            [
                "| 代码 | 名称 | 总市值(亿) | 命中原因 |",
                "| --- | --- | ---: | --- |",
            ]
        )
        for record in sorted(multi_reason, key=lambda item: item["symbol"]):
            lines.append(
                f"| {record['symbol']} | {record['name']} | "
                f"{record['totalMarketCapYi']:.2f} | {'；'.join(record['reasons'])} |"
            )
    else:
        lines.append("无。")

    lines.extend(
        [
            "",
            "## 最近三季连续亏损",
            "",
            "| 代码 | 名称 | 总市值(亿) | Q1/Q2/Q3单季净利(亿) | Q2较Q1减亏 | Q3较Q2减亏 | 判断 |",
            "| --- | --- | ---: | --- | ---: | ---: | --- |",
        ]
    )
    for record in losses:
        finance = record["financial"]
        profits = "/".join(f"{value:.2f}" for value in finance["quarterNetProfitYi"])
        reductions = [
            "不适用" if value is None else f"{value:.1%}"
            for value in finance["lossReductions"]
        ]
        lines.append(
            f"| {record['symbol']} | {record['name']} | "
            f"{record['totalMarketCapYi']:.2f} | {profits} | "
            f"{reductions[0]} | {reductions[1]} | {finance['repairStatus']} |"
        )
    if not losses:
        lines.append("| - | - | - | - | - | - | - |")

    lines.extend(["", "## 财务口径观察项", ""])
    if financial_review:
        lines.append(
            "以下股票并非“完全没有减亏”，但并非每个相邻季度都明显减亏；"
            "是否按你要求的“任何一个季度没有大幅减少”一并剔除，需要单独确认。"
        )
        lines.append("")
        for record in financial_review:
            finance = record["financial"]
            lines.append(
                f"- {record['symbol']} {record['name']}："
                f"Q2 较 Q1 {finance['lossReductions'][0]:.1%}，"
                f"Q3 较 Q2 {finance['lossReductions'][1]:.1%}。"
            )
    else:
        lines.append("无。")

    lines.extend(
        [
            "",
            "## K 线路径不健康",
            "",
            "| 代码 | 名称 | 总市值(亿) | 锚下比例 | 年化对数斜率 | 最大回撤 | 最差20日 | 行情截止 |",
            "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
        ]
    )
    for record in path_risks:
        path = record["path"]
        lines.append(
            f"| {record['symbol']} | {record['name']} | "
            f"{record['totalMarketCapYi']:.2f} | {path['belowAnchorRatio']:.1%} | "
            f"{path['annualizedLogSlope']:.1%} | {path['maxCloseDrawdown']:.1%} | "
            f"{path['worst20SessionReturn']:.1%} | {path['dataThrough']} |"
        )
    if not path_risks:
        lines.append("| - | - | - | - | - | - | - | - |")

    lines.extend(
        [
            "",
            "## 总市值低于阈值",
            "",
            "| 代码 | 名称 | 总市值(亿) | 锚下比例 | 年化斜率 | 最大回撤 | 三季连亏 | 路径不健康 |",
            "| --- | --- | ---: | ---: | ---: | ---: | --- | --- |",
        ]
    )
    for record in low_caps:
        lines.append(
            f"| {record['symbol']} | {record['name']} | "
            f"{record['totalMarketCapYi']:.2f} | "
            f"{record['path']['belowAnchorRatio']:.1%} | "
            f"{record['path']['annualizedLogSlope']:.1%} | "
            f"{record['path']['maxCloseDrawdown']:.1%} | "
            f"{'是' if record['financial'].get('threeQuarterLoss') else '否'} | "
            f"{'是' if record['pathUnhealthy'] else '否'} |"
        )
    if not low_caps:
        lines.append("| - | - | - | - | - | - | - | - |")

    lines.extend(["", "## 数据缺失", ""])
    if missing:
        for record in missing:
            missing_quarters = record["financial"].get("missingQuarters", [])
            lines.append(
                f"- {record['symbol']} {record['name']}：缺 {', '.join(missing_quarters)}；"
                f"行情截止 {record['path']['dataThrough']}。未仅因缺失而列入删除候选。"
            )
    else:
        lines.append("无。")
    lines.extend(
        [
            "",
            "> 本报告只形成候选名单，没有修改股票池。路径规则是针对本次审视的研究阈值，不等同于概率或交易建议。",
            "",
        ]
    )
    return "\n".join(lines)


def write_csv(path: Path, records: list[dict[str, Any]]) -> None:
    fields = [
        "symbol",
        "name",
        "totalMarketCapYi",
        "lowCap",
        "threeQuarterLoss",
        "strictNoRepair",
        "clearNoRepair",
        "repairStatus",
        "q1NetProfitYi",
        "q2NetProfitYi",
        "q3NetProfitYi",
        "q2Reduction",
        "q3Reduction",
        "belowAnchorRatio",
        "annualizedLogSlope",
        "maxCloseDrawdown",
        "worst20SessionReturn",
        "dataThrough",
        "pathUnhealthy",
        "removalCandidate",
        "reasons",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for record in sorted(records, key=lambda item: item["symbol"]):
            finance = record["financial"]
            path = record["path"]
            profits = finance.get("quarterNetProfitYi", [None, None, None])
            reductions = finance.get("lossReductions", [None, None])
            writer.writerow(
                {
                    "symbol": record["symbol"],
                    "name": record["name"],
                    "totalMarketCapYi": round(record["totalMarketCapYi"], 4),
                    "lowCap": record["lowCap"],
                    "threeQuarterLoss": finance.get("threeQuarterLoss"),
                    "strictNoRepair": record["strictNoRepair"],
                    "clearNoRepair": record["clearNoRepair"],
                    "repairStatus": finance.get("repairStatus", finance.get("status")),
                    "q1NetProfitYi": profits[0],
                    "q2NetProfitYi": profits[1],
                    "q3NetProfitYi": profits[2],
                    "q2Reduction": reductions[0],
                    "q3Reduction": reductions[1],
                    "belowAnchorRatio": round(path["belowAnchorRatio"], 6),
                    "annualizedLogSlope": round(path["annualizedLogSlope"], 6),
                    "maxCloseDrawdown": round(path["maxCloseDrawdown"], 6),
                    "worst20SessionReturn": round(path["worst20SessionReturn"], 6),
                    "dataThrough": path["dataThrough"],
                    "pathUnhealthy": record["pathUnhealthy"],
                    "removalCandidate": record["removalCandidate"],
                    "reasons": "；".join(record["reasons"]),
                }
            )


def safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return math.nan


def main() -> None:
    for proxy_name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        os.environ.pop(proxy_name, None)
    args = parse_args()
    if not (0 < args.material_loss_reduction < 1):
        raise SystemExit("--material-loss-reduction must be between 0 and 1")
    if not (0 < args.below_anchor_min <= 1):
        raise SystemExit("--below-anchor-min must be between 0 and 1")
    if args.annual_slope_max >= 0 or args.max_drawdown_max >= 0:
        raise SystemExit("risk maximums must be negative")

    stocks = load_a_share_index()
    symbols = [stock["symbol"] for stock in stocks]
    print(f"[1/3] Fetching market caps: {len(symbols)} A shares")
    market_caps = fetch_market_caps(symbols)
    print("[2/3] Fetching 2026 Q1-Q3 financial reports")
    financials = fetch_financial_reports(set(symbols), args.material_loss_reduction)
    print("[3/3] Calculating cost-anchor and path metrics")
    records = build_audit(stocks, market_caps, financials, args)

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now().astimezone().isoformat(timespec="seconds")
    payload = {
        "generatedAt": generated_at,
        "criteria": {
            "marketCapYiBelow": args.market_cap_yi,
            "materialLossReduction": args.material_loss_reduction,
            "belowAnchorMin": args.below_anchor_min,
            "annualSlopeMax": args.annual_slope_max,
            "maxDrawdownMax": args.max_drawdown_max,
        },
        "records": records,
    }
    json_path = REPORT_DIR / f"{args.output_prefix}.json"
    markdown_path = REPORT_DIR / f"{args.output_prefix}.md"
    csv_path = REPORT_DIR / f"{args.output_prefix}.csv"
    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    markdown_path.write_text(
        render_markdown(records, args, generated_at),
        encoding="utf-8",
    )
    write_csv(csv_path, records)
    candidate_count = sum(record["removalCandidate"] for record in records)
    print(f"Candidates: {candidate_count}/{len(records)} (pool unchanged)")
    print(f"Markdown: {markdown_path}")
    print(f"JSON: {json_path}")
    print(f"CSV: {csv_path}")


if __name__ == "__main__":
    main()
