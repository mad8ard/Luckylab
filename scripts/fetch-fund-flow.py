#!/usr/bin/env python3
"""拉取同花顺个股全单资金净额，生成当前候选资金流确认快照。

口径：
  - 同花顺-数据中心-个股资金流（全单流入-流出）
  - 即时 / 3日排行 / 5日排行
  - 只做当前确认分，不进入历史回测

输出：src/data/fund-flow-latest.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "src" / "data" / "stock-index.json"
OUT_PATH = ROOT / "src" / "data" / "fund-flow-latest.json"
DEFAULT_CANDIDATES = ""

WEIGHTS = {"today": 0.25, "d3": 0.35, "d5": 0.40}
PERIODS = [
    ("today", "即时", "今日"),
    ("d3", "3日排行", "3日"),
    ("d5", "5日排行", "5日"),
]


def main() -> int:
    args = parse_args()
    ak = import_ak()
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    a_shares = [item for item in index if item.get("market") == "A股"]
    candidates_path = Path(args.candidates) if args.candidates else None
    candidate_symbols = set()
    candidate_source = None
    if candidates_path and candidates_path.exists():
        try:
            snapshot = json.loads(candidates_path.read_text(encoding="utf-8"))
            candidate_symbols = {
                str(row.get("symbol") or "").strip()
                for row in snapshot.get("rows", [])
                if row.get("symbol")
            }
            candidate_source = str(candidates_path)
        except Exception as exc:  # noqa: BLE001
            print(f"  [warn] 候选快照读取失败，回退全池：{exc}", file=sys.stderr)
    pool = [item for item in a_shares if str(item.get("symbol") or "").strip() in candidate_symbols] if candidate_symbols else a_shares
    if candidate_symbols:
        print(f"只处理指定候选：{len(pool)} 只（来自 {candidates_path.name}）", flush=True)
    else:
        print(f"全局 A 股池模式：{len(pool)} 只；135模块独立手工执行。", flush=True)

    period_maps = {}
    period_meta = {}
    for key, symbol, label in PERIODS:
        frame = fetch_period(ak, symbol, args.retries)
        records = build_period_records(frame, key)
        values = sorted(item["netAmount"] for item in records.values() if item.get("netAmount") is not None)
        for record in records.values():
            record[key + "Pct"] = percentile_rank(values, record.get("netAmount"))
        period_maps[key] = records
        period_meta[key] = {
            "symbol": symbol,
            "label": label,
            "rows": len(records),
            "withValue": len(values),
        }
        print(f"  {label}：{len(records)} 行，{len(values)} 个有效净额", flush=True)

    rows = {}
    missing = []
    for entry in pool:
        code = str(entry.get("symbol") or "").strip()
        label = str(entry.get("label") or code)
        if not code:
            continue
        row = {"label": label}
        for key, _symbol, _label in PERIODS:
            record = period_maps[key].get(code, {})
            row[key] = record.get("netAmount")
            row[key + "Pct"] = record.get(key + "Pct")
            row[key + "Detail"] = {
                name: record.get(name)
                for name in (
                    "netAmount", "amount", "turnoverPct", "changePct",
                    "phaseChangePct", "continuousTurnoverPct",
                )
                if record.get(name) is not None
            }
        score, used, missing_windows = combine_score(row)
        row["score"] = score
        row["usedWindows"] = used
        row["missingWindows"] = missing_windows
        rows[code] = row
        if missing_windows:
            missing.append({"symbol": code, "label": label, "windows": missing_windows})

    marked = sum(1 for row in rows.values() if row["score"] is not None)
    latest_index_date = max(
        (str(item.get("dataThrough") or "") for item in pool),
        default="",
    )
    payload = {
        "schemaVersion": "fund-flow.v1",
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "dataThrough": args.as_of or datetime.now().astimezone().strftime("%Y-%m-%d"),
        "priceDataThrough": latest_index_date or None,
        "source": "同花顺 stock_fund_flow_individual（即时 / 3日排行 / 5日排行）",
        "semantics": "全单资金净额（流入-流出），不是北向 JINGE，也不是主力净流入；只做当前确认分，不进入历史回测。",
        "weights": WEIGHTS,
        "periods": period_meta,
        "totalA": len(a_shares),
        "targeted": len(pool),
        "candidateSource": candidate_source,
        "matched": len(rows),
        "scored": marked,
        "missing": missing,
        "rows": rows,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"资金流快照写入完成：targeted={len(pool)} / scored={marked}/{len(rows)} / 截止 {payload['dataThrough']}", flush=True)
    print(f"  {OUT_PATH}", flush=True)
    return 0


def fetch_period(ak, symbol: str, retries: int):
    last_error = None
    for attempt in range(max(1, retries)):
        try:
            return ak.stock_fund_flow_individual(symbol=symbol)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            print(f"  [retry {attempt + 1}/{retries}] {symbol}: {type(exc).__name__}: {str(exc)[:120]}", file=sys.stderr, flush=True)
            time.sleep(2 + attempt * 2)
    raise SystemExit(f"拉取失败：{symbol}: {type(last_error).__name__}: {last_error}")


def build_period_records(frame, key: str):
    records = {}
    if frame is None or len(frame) == 0:
        return records
    for _, row in frame.iterrows():
        code = str(row.get("股票代码") or "").strip()
        if code.isdigit():
            code = code.zfill(6)
        if not code:
            continue
        net = parse_amount(row.get("资金流入净额") if key != "today" else row.get("净额"))
        if key == "today":
            records[code] = {
                "netAmount": net,
                "amount": parse_amount(row.get("成交额")),
                "turnoverPct": parse_pct(row.get("换手率")),
                "changePct": parse_pct(row.get("涨跌幅")),
            }
        else:
            records[code] = {
                "netAmount": net,
                "phaseChangePct": parse_pct(row.get("阶段涨跌幅")),
                "continuousTurnoverPct": parse_pct(row.get("连续换手率")),
            }
    return records


def percentile_rank(values, value):
    if value is None or not values or not math.isfinite(value):
        return None
    # 用“<= value”的占比，负数也按同一方向解释：越大越偏净买入。
    count = 0
    for item in values:
        if item <= value:
            count += 1
    return round(count / len(values) * 100, 2)


def combine_score(row):
    total = 0.0
    weight_sum = 0.0
    used = []
    missing = []
    for key in ("today", "d3", "d5"):
        value = row.get(key + "Pct")
        weight = WEIGHTS[key]
        if value is None or not math.isfinite(value):
            missing.append(key)
            continue
        total += value * weight
        weight_sum += weight
        used.append(key)
    score = round(total / weight_sum, 2) if weight_sum > 0 else None
    return score, used, missing


def parse_amount(value):
    if value is None:
        return None
    text = str(value).strip().replace(",", "").replace("，", "")
    if not text or text in ("--", "-", "—", "None", "nan"):
        return None
    multiplier = 1.0
    if text.endswith("亿"):
        multiplier = 1e8
        text = text[:-1]
    elif text.endswith("万"):
        multiplier = 1e4
        text = text[:-1]
    elif text.endswith("元"):
        text = text[:-1]
    text = text.replace("+", "")
    try:
        return round(float(text) * multiplier, 2)
    except ValueError:
        return None


def parse_pct(value):
    if value is None:
        return None
    text = str(value).strip().replace("%", "").replace(",", "")
    if not text or text in ("--", "-", "—", "None", "nan"):
        return None
    try:
        return round(float(text), 4)
    except ValueError:
        return None


def import_ak():
    try:
        import akshare  # noqa: PLC0415
    except ImportError:
        print("缺少 akshare，请先安装依赖。", file=sys.stderr)
        raise
    return akshare


def parse_args():
    parser = argparse.ArgumentParser(description="拉取同花顺个股全单资金净额，生成当前确认快照")
    parser.add_argument("--retries", type=int, default=3, help="每个周期失败后的重试次数")
    parser.add_argument("--as-of", default="", help="覆盖数据截止日期，默认今天")
    parser.add_argument("--candidates", default=DEFAULT_CANDIDATES, help="可选：只保留该 JSON 中的股票；留空则全局 A 股池")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
