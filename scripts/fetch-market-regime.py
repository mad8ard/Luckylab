#!/usr/bin/env python3
"""抓取大盘趋势判断所需的原始数据（只取数，不做指标计算）。

为什么分两段：指标要复用项目 domain 里的成本锚公式（buildMarketStatePath），
那是 JS 模块，所以 Python 只负责取数落盘，计算交给 Node。

用法：python scripts/fetch-market-regime.py
输出：src/data/market-regime/raw-<date>.json 与 market-regime-raw-latest.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "src" / "data" / "market-regime"
LATEST_PATH = OUT_DIR / "market-regime-raw-latest.json"
BREADTH_HISTORY_PATH = OUT_DIR / "breadth-history.jsonl"
SCHEMA_VERSION = "market-regime-raw.v1"

# 用于趋势面板的四个指数 + 一个用于合成全市场成交额的深证综指
INDEX_SYMBOLS = [
    ("sh000001", "上证综指", "panel"),
    ("sz399001", "深证成指", "panel"),
    ("sz399006", "创业板指", "panel"),
    ("sh000300", "沪深300", "panel"),
    ("sz399106", "深证综指", "turnover-only"),
]


def main() -> int:
    args = parse_args()
    ak = import_ak()
    generated_at = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    failures = []

    indices = {}
    for symbol, label, role in INDEX_SYMBOLS:
        rows = None
        for endpoint in ("stock_zh_index_daily_tx", "stock_zh_index_daily"):
            try:
                frame = getattr(ak, endpoint)(symbol=symbol)
                rows = normalize_index_rows(frame)
                if rows:
                    break
            except Exception as exc:  # noqa: BLE001
                failures.append({"id": "index:" + symbol, "endpoint": endpoint, "error": "%s: %s" % (type(exc).__name__, str(exc)[:160])})
            time.sleep(max(0.0, args.sleep))
        indices[symbol] = {"label": label, "role": role, "rows": rows or []}
        print("[index] %s %s rows=%s" % (symbol, label, len(rows) if rows else "FAILED"))
        time.sleep(max(0.0, args.sleep))

    breadth = None
    try:
        frame = ak.stock_market_activity_legu()
        breadth = {str(row["item"]).strip(): cell(row["value"]) for _, row in frame.iterrows()}
    except Exception as exc:  # noqa: BLE001
        failures.append({"id": "breadth", "endpoint": "stock_market_activity_legu", "error": "%s: %s" % (type(exc).__name__, str(exc)[:160])})
    print("[breadth] %s" % ("ok" if breadth else "FAILED"))
    time.sleep(max(0.0, args.sleep))

    margin = []
    try:
        frame = ak.stock_margin_account_info()
        margin = [{"date": cell(row["日期"]), "financing": cell(row["融资余额"]), "short": cell(row["融券余额"]), "financingBuy": cell(row["融资买入额"])} for _, row in frame.iterrows()]
    except Exception as exc:  # noqa: BLE001
        failures.append({"id": "margin", "endpoint": "stock_margin_account_info", "error": "%s: %s" % (type(exc).__name__, str(exc)[:160])})
    print("[margin] rows=%d" % len(margin))
    time.sleep(max(0.0, args.sleep))


    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        "akshareVersion": getattr(ak, "__version__", None),
        "indices": indices,
        "breadth": breadth,
        "margin": margin,
        "breadthHistoryAppended": append_breadth_history(breadth),
        "failures": failures,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # 指数历史必须完整保留：成本锚窗口是 sqrt(可见行数) 自适应的，
    # 裁掉历史会改变窗口长度、进而改变成本锚。因此这里只压紧 JSON 不裁行。
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    LATEST_PATH.write_text(body, encoding="utf-8")
    print("大盘原始数据写入完成：failures=%d（紧凑 JSON，不裁行）" % len(failures))
    print("  %s" % LATEST_PATH)
    return 0


def append_breadth_history(breadth):
    """把当日宽度快照追加到本地历史。宽度接口只给当天，所以分位要自己攒。"""
    if not breadth:
        return False
    stamp = str(breadth.get("统计日期") or "")[:10]
    if not stamp:
        return False
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    existing = []
    if BREADTH_HISTORY_PATH.exists():
        for line in BREADTH_HISTORY_PATH.read_text(encoding="utf-8").splitlines():
            if line.strip():
                existing.append(line)
    for line in existing:
        try:
            if json.loads(line).get("date") == stamp:
                return False
        except json.JSONDecodeError:
            continue
    with BREADTH_HISTORY_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"date": stamp, **{k: v for k, v in breadth.items() if k != "统计日期"}}, ensure_ascii=False) + "\n")
    return True


def normalize_index_rows(frame):
    if frame is None or len(frame) == 0:
        return []
    rows = []
    for _, row in frame.iterrows():
        item = {
            "date": cell(row.get("date") or row.get("日期")),
            "open": cell(row.get("open")),
            "high": cell(row.get("high")),
            "low": cell(row.get("low")),
            "close": cell(row.get("close")),
            "amount": cell(row.get("amount") if "amount" in frame.columns else row.get("volume")),
        }
        if not item["date"] or not isinstance(item["close"], (int, float)) or item["close"] <= 0:
            continue
        if not all(isinstance(item[key], (int, float)) for key in ("open", "high", "low")):
            continue
        rows.append(item)
    rows.sort(key=lambda item: item["date"])
    return rows


def cell(value):
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")
    if hasattr(value, "item") and getattr(value, "ndim", None) == 0:
        return cell(value.item())
    if isinstance(value, str):
        text = value.strip()
        return text if text and text.lower() not in ("nan", "none", "nat") else None
    try:
        if value != value:
            return None
    except Exception:
        pass
    return value


def import_ak():
    try:
        import akshare  # noqa: PLC0415
    except ImportError:
        print("缺少 akshare，请先运行：python -m pip install -r scripts/requirements-market-data.txt", file=sys.stderr)
        raise
    return akshare


def parse_args():
    parser = argparse.ArgumentParser(description="抓取大盘趋势判断所需的原始数据")
    parser.add_argument("--sleep", type=float, default=1.0, help="接口调用间隔秒数，默认 1.0")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())