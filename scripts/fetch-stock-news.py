#!/usr/bin/env python3
"""按需抓取单只 A 股的公开消息面数据，落成 JSON 供报告页渲染。

设计约束（与项目既有契约一致）：
  - 只做 A 股。港股消息面接口覆盖差，明确不支持。
  - 只按 symbol 取数，不接受批量全市场下载：每次只抓你在命令行里点名的几只。
  - 产出是「外部证据」，不参与任何评分。researchBoundary 会写死这一点。
  - 任何单个接口失败都不终止整体：失败原因原样记录，页面显示「本次未取到」。

依赖：akshare（已在 scripts/requirements-market-data.txt 中）。

用法：
  python scripts/fetch-stock-news.py 600519 000425
  python scripts/fetch-stock-news.py 600519 --recent-rows 20 --sleep 1.0
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "src" / "data" / "stock-news"
LATEST_PATH = ROOT / "src" / "data" / "stock-news-latest.json"
SCHEMA_VERSION = "stock-news.v1"

SYMBOL_PATTERN = re.compile(r"^\d{6}$")


def fund_flow_market(symbol: str) -> str:
    if symbol.startswith("6"):
        return "sh"
    if symbol.startswith(("0", "3")):
        return "sz"
    return "bj"


SOURCES = [
    {
        "id": "news",
        "label": "个股新闻",
        "endpoint": "stock_news_em",
        "params": lambda s: {"symbol": s},
        "dateColumn": "发布时间",
        "why": "东财个股新闻流最近 100 条，做事件与情绪判断的原料。",
    },
    {
        "id": "research",
        "label": "个股研报",
        "endpoint": "stock_research_report_em",
        "params": lambda s: {"symbol": s},
        "dateColumn": "日期",
        "why": "卖方研报列表：评级、机构、三年盈利预测与 PDF 链接。",
    },
    {
        "id": "notice",
        "label": "个股公告",
        "endpoint": "stock_individual_notice_report",
        "params": lambda s: {"security": s},
        "dateColumn": "公告日期",
        "why": "正式公告。业绩预告、减持、回购、诉讼这类硬事件都在这里。",
    },
    {
        "id": "hsgt",
        "label": "北向持股（个股明细）",
        "endpoint": "stock_hsgt_individual_em",
        "params": lambda s: {"symbol": s},
        "dateColumn": "持股日期",
        "why": "外资持股逐日明细。注意该口径在 2024-08 之后停止披露，看数据末尾日期。",
    },
    {
        "id": "gdhs",
        "label": "股东户数",
        "endpoint": "stock_zh_a_gdhs_detail_em",
        "params": lambda s: {"symbol": s},
        "dateColumn": "股东户数统计截止日",
        "why": "筹码集中度的公开代理：户数下降通常意味着筹码向少数账户集中。",
    },
    {
        "id": "institution",
        "label": "机构参与度",
        "endpoint": "stock_comment_detail_zlkp_jgcyd_em",
        "params": lambda s: {"symbol": s},
        "dateColumn": "交易日",
        "why": "东财千股千评的主力控盘-机构参与度，日频。",
    },
    {
        "id": "focus",
        "label": "用户关注指数",
        "endpoint": "stock_comment_detail_scrd_focus_em",
        "params": lambda s: {"symbol": s},
        "dateColumn": "交易日",
        "why": "散户关注度，用来判断是否已经被市场炒热。",
    },
    {
        "id": "desire",
        "label": "市场参与意愿",
        "endpoint": "stock_comment_detail_scrd_desire_em",
        "params": lambda s: {"symbol": s},
        "dateColumn": "交易日期",
        "why": "参与意愿及其 5 日均值，短线情绪代理。",
    },
    {
        "id": "score",
        "label": "综合评价历史评分",
        "endpoint": "stock_comment_detail_zhpj_lspf_em",
        "params": lambda s: {"symbol": s},
        "dateColumn": "交易日",
        "why": "东财千股千评的综合评分历史，日频。",
    },
    {
        "id": "fundflow",
        "label": "个股资金流",
        "endpoint": "stock_individual_fund_flow",
        "params": lambda s: {"stock": s, "market": fund_flow_market(s)},
        "dateColumn": "日期",
        "why": "主力/大单资金净流入，判断资金方向。本机实测该东财接口持续被对端断连（RemoteDisconnected），保留它只是为了让失败可见，不要因为缺这一项就下结论。",
    },
]


def main() -> int:
    args = parse_args()
    symbols = []
    for raw in args.symbols:
        symbol = str(raw).strip()
        if not SYMBOL_PATTERN.match(symbol):
            print(
                "invalid symbol %r: 只支持 6 位 A 股代码（港股与美股不支持）" % raw,
                file=sys.stderr,
            )
            return 2
        if symbol not in symbols:
            symbols.append(symbol)

    ak = import_ak()
    generated_at = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

    entries = []
    for symbol in symbols:
        entry = fetch_symbol(ak, symbol, args)
        entries.append(entry)
        summary = ", ".join(
            "%s=%s" % (source["id"], source["totalRows"] if source["status"] == "ok" else source["status"])
            for source in entry["sources"]
        )
        print("[%s] %s" % (symbol, summary))

    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        "akshareVersion": getattr(ak, "__version__", None),
        "pythonVersion": sys.version.split()[0],
        "markets": ["A股"],
        "recentRowsPerSource": args.recent_rows,
        "researchBoundary": {
            "status": "external-evidence-only",
            "participatesInScore": False,
            "executionAuthority": "none",
            "reasons": [
                "public-web-news-and-disclosure-snapshot",
                "no-point-in-time-archive; each fetch reflects what the upstream page showed at fetch time",
                "must-not-be-merged-into-price-based-scoring",
            ],
        },
        "symbols": entries,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dated = OUT_DIR / ("stock-news-%s.json" % generated_at[:10])
    body = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    dated.write_text(body, encoding="utf-8")
    LATEST_PATH.write_text(body, encoding="utf-8")
    print("stock-news 快照写入完成：%d 只标的" % len(entries))
    print("  %s" % dated)
    print("  %s" % LATEST_PATH)
    return 0


def fetch_symbol(ak, symbol: str, args) -> dict:
    sources = []
    for spec in SOURCES:
        started = time.time()
        record = {
            "id": spec["id"],
            "label": spec["label"],
            "endpoint": spec["endpoint"],
            "why": spec["why"],
            "status": "ok",
            "error": None,
            "columns": [],
            "totalRows": 0,
            "shownRows": 0,
            "order": None,
            "recent": [],
            "numericSummary": {},
        }
        try:
            frame = getattr(ak, spec["endpoint"])(**spec["params"](symbol))
            record.update(prepare_frame(frame, spec.get("dateColumn"), args.recent_rows))
        except Exception as exc:  # noqa: BLE001 - 上游接口失败必须原样记录而不是中断
            record["status"] = "failed"
            record["error"] = "%s: %s" % (type(exc).__name__, str(exc)[:200])
        record["elapsedMs"] = int((time.time() - started) * 1000)
        sources.append(record)
        time.sleep(max(0.0, args.sleep))
    return {
        "symbol": symbol,
        "market": "A股",
        "fetchedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "sources": sources,
        "derived": derive(sources),
    }


def prepare_frame(frame, date_column, recent_rows: int) -> dict:
    columns = [str(column) for column in frame.columns]
    records = []
    for position in range(len(frame)):
        row = frame.iloc[position]
        records.append({column: cell(row[column]) for column in frame.columns})

    order = "source-order"
    if date_column and date_column in columns:
        parsed = [parse_datetime(record.get(date_column)) for record in records]
        if records and all(value is not None for value in parsed):
            records = [record for _, record in sorted(zip(parsed, records), key=lambda pair: pair[0])]
            order = "sorted-ascending-by-%s" % date_column

    total = len(records)
    shown = records[-recent_rows:] if recent_rows > 0 and total > recent_rows else records
    return {
        "columns": columns,
        "totalRows": total,
        "shownRows": len(shown),
        "order": order,
        "recent": shown,
        "numericSummary": numeric_summary(shown),
    }


def numeric_summary(records) -> dict:
    summary = {}
    if not records:
        return summary
    for column in records[0].keys():
        raw = [record.get(column) for record in records]
        numeric = [value for value in raw if isinstance(value, (int, float)) and not isinstance(value, bool)]
        if not numeric or len(numeric) != len([value for value in raw if value is not None]):
            continue
        tail = numeric[-5:]
        summary[column] = {
            "latest": round(float(numeric[-1]), 4),
            "mean5": round(sum(tail) / len(tail), 4),
            "min": round(float(min(numeric)), 4),
            "max": round(float(max(numeric)), 4),
            "samples": len(numeric),
        }
    return summary


def derive(sources) -> dict:
    by_id = {source["id"]: source for source in sources}
    derived = {"failedSources": [source["id"] for source in sources if source["status"] != "ok"]}

    news = by_id.get("news")
    if news and news["recent"]:
        newest = max((parse_datetime(row.get("发布时间")) for row in news["recent"]), default=None)
        buckets = {"last7d": 0, "last30d": 0}
        if newest:
            for row in news["recent"]:
                stamp = parse_datetime(row.get("发布时间"))
                if stamp is None:
                    continue
                days = (newest - stamp).days
                if days <= 7:
                    buckets["last7d"] += 1
                if days <= 30:
                    buckets["last30d"] += 1
        derived["news"] = {
            "total": news["totalRows"],
            "latestDate": newest.strftime("%Y-%m-%d %H:%M") if newest else None,
            "last7d": buckets["last7d"],
            "last30d": buckets["last30d"],
            "topSources": top_counts(news["recent"], "文章来源", 5),
            "latestTitles": [row.get("新闻标题") for row in news["recent"][-5:][::-1]],
        }

    research = by_id.get("research")
    if research and research["recent"]:
        tail = research["recent"][-90:]
        rating_counts = Counter(str(row.get("东财评级") or "未评级") for row in tail)
        derived["research"] = {
            "total": research["totalRows"],
            "recentWindowSamples": len(tail),
            "latestDate": tail[-1].get("日期"),
            "latestRating": tail[-1].get("东财评级"),
            "latestInstitution": tail[-1].get("机构"),
            "ratingCounts": dict(rating_counts.most_common()),
            "topInstitutions": top_counts(tail, "机构", 5),
            "latestTitles": [row.get("报告名称") for row in tail[-5:][::-1]],
        }

    notice = by_id.get("notice")
    if notice and notice["recent"]:
        tail = notice["recent"]
        derived["notice"] = {
            "total": notice["totalRows"],
            "latestDate": tail[-1].get("公告日期"),
            "typeCounts": dict(Counter(str(row.get("公告类型") or "未分类") for row in tail).most_common()),
            "latestTitles": [
                {"date": row.get("公告日期"), "title": row.get("公告标题"), "url": row.get("网址")}
                for row in tail[-8:][::-1]
            ],
        }

    hsgt = by_id.get("hsgt")
    if hsgt and hsgt["recent"]:
        tail = hsgt["recent"]
        derived["hsgt"] = {
            "total": hsgt["totalRows"],
            "latestDate": tail[-1].get("持股日期"),
            "latestHoldPct": tail[-1].get("持股数量占A股百分比"),
            "latestHoldValue": tail[-1].get("持股市值"),
            "note": "北向个股明细口径在 2024-08 之后停止披露，最新一行日期即为该口径的终点。",
        }

    gdhs = by_id.get("gdhs")
    if gdhs and gdhs["recent"]:
        tail = gdhs["recent"]
        derived["gdhs"] = {
            "total": gdhs["totalRows"],
            "latestDate": tail[-1].get("股东户数统计截止日"),
            "latestHolders": tail[-1].get("股东户数-本次"),
            "changePct": tail[-1].get("股东户数-增减比例"),
            "avgHoldValue": tail[-1].get("户均持股市值"),
            "history": [
                {"date": row.get("股东户数统计截止日"), "holders": row.get("股东户数-本次"), "changePct": row.get("股东户数-增减比例")}
                for row in tail[-6:]
            ],
        }

    for key, column in (("institution", "机构参与度"), ("focus", "用户关注指数"), ("score", "评分"), ("desire", "参与意愿")):
        source = by_id.get(key)
        if not source or not source["recent"]:
            continue
        summary = source["numericSummary"].get(column)
        derived[key] = {
            "total": source["totalRows"],
            "column": column,
            "latestDate": last_date(source["recent"]),
            "latest": summary["latest"] if summary else None,
            "mean5": summary["mean5"] if summary else None,
        }

    fundflow = by_id.get("fundflow")
    if fundflow and fundflow["recent"]:
        tail = fundflow["recent"]
        main_net = [row.get("主力净流入-净额") for row in tail]
        numbers = [value for value in main_net if isinstance(value, (int, float))]
        derived["fundflow"] = {
            "total": fundflow["totalRows"],
            "latestDate": tail[-1].get("日期"),
            "mainNetLast5": round(sum(numbers[-5:]), 2) if numbers else None,
            "note": "主力净流入单位为元，正负代表方向，不代表可交易信号。",
        }

    return derived


def top_counts(records, column, limit: int):
    counter = Counter(str(row.get(column)).strip() for row in records if row.get(column))
    return [{"name": name, "count": count} for name, count in counter.most_common(limit)]


def last_date(records):
    for row in reversed(records):
        for key in ("交易日", "交易日期", "日期"):
            if row.get(key):
                return row[key]
    return None


def parse_datetime(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in ("nan", "none", "nat"):
        return None
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y/%m/%d", "%Y%m%d"):
        try:
            return datetime.strptime(text[: len(pattern) + 2].strip(), pattern)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text[:19])
    except ValueError:
        return None


def cell(value):
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d %H:%M:%S") if isinstance(value, datetime) else value.strftime("%Y-%m-%d")
    if hasattr(value, "item") and getattr(value, "ndim", None) == 0:
        return cell(value.item())
    if isinstance(value, str):
        text = value.strip()
        return text if text and text.lower() != "nan" else None
    try:
        if value != value:  # NaN 的通用判定
            return None
    except Exception:
        pass
    return value


def import_ak():
    try:
        import akshare  # noqa: PLC0415 - 依赖延迟导入，未安装时给出可执行提示
    except ImportError:
        print("缺少 akshare，请先运行：python -m pip install -r scripts/requirements-market-data.txt", file=sys.stderr)
        raise
    return akshare


def parse_args():
    parser = argparse.ArgumentParser(description="按需抓取单只 A 股的消息面快照（不参与评分）")
    parser.add_argument("symbols", nargs="+", help="6 位 A 股代码，可写多个")
    parser.add_argument("--recent-rows", type=int, default=40, help="每个数据源最多保留最近多少行，默认 40")
    parser.add_argument("--sleep", type=float, default=0.6, help="每次接口调用之间的间隔秒数，默认 0.6")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())