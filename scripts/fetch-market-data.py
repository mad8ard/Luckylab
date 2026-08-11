#!/usr/bin/env python3
"""Fetch real OHLCV data into the workbook format used by Market Lab."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, time as clock_time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INDEX = ROOT / "src" / "data" / "stock-index.json"
DEFAULT_OUTPUT = ROOT / "data" / "workbooks" / "stocks_latest.xlsx"
PRICE_COLUMNS = ("open", "high", "low", "close", "volume")
DEFAULT_PREFERRED_START_DATE = "2021-01-01"
DEFAULT_PREFERRED_START_TOLERANCE_DAYS = 14
DEFAULT_FALLBACK_DAYS = 730
@dataclass(frozen=True)
class Instrument:
    symbol: str
    label: str
    market: str


def main() -> int:
    args = parse_args()
    instruments = load_instruments(args.index, args.markets)
    if args.limit:
        instruments = instruments[:args.limit]

    if args.plan:
        print_plan(instruments, args)
        return 0

    pd, ak, bs, requests = import_fetch_deps()
    start = args.start_date or args.preferred_start_date or (date.today() - timedelta(days=args.lookback_days)).isoformat()
    # 往后推 2 天保证凌晨定时任务也能覆盖最新交易日；各数据源多给两天无副作用。
    end = args.end_date or (date.today() + timedelta(days=2)).isoformat()

    frames = []
    failures = []
    bs_logged_in = False
    try:
        if any(item.market == "A股" for item in instruments) and bs is not None:
            login = bs.login()
            bs_logged_in = login.error_code == "0"
            print(f"[baostock] {login.error_msg}")

        for index, item in enumerate(instruments, start=1):
            print(f"[{index}/{len(instruments)}] {item.symbol} {item.label} {item.market}")
            frame = fetch_one(
                item,
                start,
                end,
                pd,
                ak,
                bs if bs_logged_in else None,
                requests,
                args,
            )
            if frame is None or frame.empty:
                print(f"  [FAIL] all sources failed")
                failures.append(item.symbol)
                continue
            frame = clip_requested_range(frame, start, end, pd)
            frame = keep_completed_daily_bars(frame, item.market)
            if frame.empty:
                print(f"  [FAIL] no completed daily bars")
                failures.append(item.symbol)
                continue
            frame, coverage = apply_coverage_policy(frame, args, pd)
            frames.append(to_named_columns(frame, item, pd))
            print(f"  [ok] {len(frame)} rows, {coverage}")
            if args.delay:
                time.sleep(args.delay)
    finally:
        if bs_logged_in and bs is not None:
            bs.logout()

    if not frames:
        print("[FAIL] no market data fetched", file=sys.stderr)
        return 1

    merged = pd.concat(frames, axis=1, sort=True).sort_index().dropna(how="all")
    write_workbook(merged, args.output, pd)
    print(f"[SAVE] {args.output}")
    print(f"[SUMMARY] fetched {len(frames)}/{len(instruments)}, missing {len(failures)}")
    if failures:
        print(f"[MISSING] {','.join(failures)}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch Market Lab OHLCV workbook")
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--markets", default="A股,港股", help="Comma-separated markets")
    parser.add_argument("--rows", type=int, default=0, help="Optional hard cap after coverage policy; <=0 keeps the policy range")
    parser.add_argument("--preferred-start-date", default=DEFAULT_PREFERRED_START_DATE)
    parser.add_argument("--preferred-start-tolerance-days", type=int, default=DEFAULT_PREFERRED_START_TOLERANCE_DAYS)
    parser.add_argument("--fallback-days", type=int, default=DEFAULT_FALLBACK_DAYS)
    parser.add_argument("--lookback-days", type=int, default=2200, help="Used only when no start or preferred start is provided")
    parser.add_argument("--start-date")
    parser.add_argument("--end-date")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--delay", type=float, default=0.2)
    parser.add_argument("--alpha-vantage-key", default=os.getenv("ALPHA_VANTAGE_API_KEY", ""))
    parser.add_argument("--plan", action="store_true", help="Print fetch plan without importing data deps")
    return parser.parse_args()


def load_instruments(index_path: Path, markets_arg: str) -> list[Instrument]:
    wanted = {part.strip() for part in markets_arg.split(",") if part.strip()}
    raw = json.loads(index_path.read_text(encoding="utf-8"))
    instruments = []
    for entry in raw:
        market = entry.get("market") or infer_market(entry.get("symbol", ""))
        if market not in wanted:
            continue
        instruments.append(Instrument(
            symbol=str(entry.get("symbol") or "").strip(),
            label=str(entry.get("label") or entry.get("symbol") or "").strip(),
            market=market,
        ))
    return instruments


def print_plan(instruments: list[Instrument], args: argparse.Namespace) -> None:
    counts = {}
    for item in instruments:
        counts[item.market] = counts.get(item.market, 0) + 1
    print(f"index: {args.index}")
    print(f"output: {args.output}")
    print(f"rows: {args.rows}")
    print(f"preferred-start-date: {args.preferred_start_date}")
    print(f"preferred-start-tolerance-days: {args.preferred_start_tolerance_days}")
    print(f"fallback-days: {args.fallback_days}")
    print(f"instruments: {len(instruments)}")
    for market, count in sorted(counts.items()):
        print(f"  {market}: {count}")


def apply_coverage_policy(frame, args, pd):
    if frame is None or frame.empty:
        return frame, "empty"
    frame = frame.sort_index()
    first = frame.index.min()
    last = frame.index.max()
    preferred_start = pd.Timestamp(args.preferred_start_date).normalize() if args.preferred_start_date else None
    tolerance_days = max(args.preferred_start_tolerance_days, 0)
    covers_preferred_start = preferred_start is not None and first <= preferred_start + pd.Timedelta(days=tolerance_days)
    if args.start_date:
        label = f"requested coverage {first.date()}~{last.date()}"
    elif covers_preferred_start:
        frame = frame.loc[frame.index >= preferred_start]
        label = f"coverage {first.date()}~{last.date()} from preferred {preferred_start.date()}"
    else:
        cutoff = last - pd.Timedelta(days=max(args.fallback_days, 1) - 1)
        frame = frame.loc[frame.index >= cutoff]
        label = f"fallback recent {args.fallback_days}d from {first.date()}"
    if args.rows > 0:
        before = len(frame)
        frame = frame.tail(args.rows)
        if before > len(frame):
            label = f"{label}, hard cap {args.rows}"
    return frame, label


def clip_requested_range(frame, start, end, pd):
    if frame is None or frame.empty:
        return frame
    start_timestamp = pd.Timestamp(start).normalize()
    end_timestamp = pd.Timestamp(end).normalize()
    return frame.loc[(frame.index >= start_timestamp) & (frame.index <= end_timestamp)]


def import_fetch_deps():
    try:
        import pandas as pd
        import akshare as ak
        import baostock as bs
        import requests
        return pd, ak, bs, requests
    except ModuleNotFoundError as exc:
        print(f"missing Python dependency: {exc.name}", file=sys.stderr)
        print("install with: python3 -m pip install -r scripts/requirements-market-data.txt", file=sys.stderr)
        raise


def fetch_one(item, start, end, pd, ak, bs, requests, args):
    if item.market == "A股":
        return fetch_a_share(item, start, end, pd, ak, bs)
    if item.market == "港股":
        return fetch_hk(item, start, end, pd, ak, requests)
    return fetch_us(item, start, end, pd, ak, requests, args.alpha_vantage_key)


def fetch_a_share(item, start, end, pd, ak, bs):
    if bs is not None:
        frame = fetch_baostock_daily(item.symbol, start, end, pd, bs)
        if usable(frame):
            return frame
    frame = fetch_ak_a_daily(item.symbol, pd, ak)
    if usable(frame):
        return frame
    return None


def fetch_hk(item, start, end, pd, ak, requests):
    frame = fetch_ak_hk_daily(item.symbol, pd, ak)
    if usable(frame):
        return frame
    return fetch_tencent_hk_daily(item.symbol, start, end, pd, requests)


def fetch_us(item, start, end, pd, ak, requests, alpha_key):
    frame = fetch_nasdaq_daily(item.symbol, start, end, pd, requests)
    if usable(frame):
        return frame
    frame = fetch_ak_us_daily(item.symbol, pd, ak)
    if usable(frame):
        return frame
    if alpha_key:
        return fetch_alpha_vantage_daily(item.symbol, pd, requests, alpha_key)
    return None


def fetch_baostock_daily(symbol, start, end, pd, bs):
    code = f"{'sh' if symbol.startswith('6') else 'sz'}.{symbol}"
    fields = "date,open,high,low,close,volume"
    rs = bs.query_history_k_data_plus(code, fields, start_date=start, end_date=end, frequency="d", adjustflag="2")
    if rs.error_code != "0":
        print(f"  [baostock] {rs.error_msg}")
        return None
    rows = []
    while rs.next():
        rows.append(rs.get_row_data())
    if not rows:
        return None
    frame = pd.DataFrame(rows, columns=fields.split(","))
    return normalize_frame(frame, pd)


def fetch_ak_a_daily(symbol, pd, ak):
    try:
        frame = ak.stock_zh_a_hist(symbol=symbol, period="daily", adjust="qfq")
        return normalize_frame(frame, pd, date_candidates=("日期", "date"))
    except Exception as exc:
        print(f"  [akshare A] {exc}")
        return None


def fetch_ak_hk_daily(symbol, pd, ak):
    code = symbol.replace(".HK", "").replace("_HK", "").zfill(5)
    try:
        frame = ak.stock_hk_daily(symbol=code, adjust="qfq")
        normalized = normalize_frame(frame, pd, date_candidates=("date", "日期"))
        if usable(normalized):
            return normalized
    except Exception as exc:
        print(f"  [akshare HK Sina] {exc}")
    try:
        frame = ak.stock_hk_hist(symbol=code, period="daily", adjust="qfq")
        return normalize_frame(frame, pd, date_candidates=("日期", "date"))
    except Exception as exc:
        print(f"  [akshare HK Eastmoney] {exc}")
        return None


def fetch_ak_us_daily(symbol, pd, ak):
    try:
        frame = ak.stock_us_daily(symbol=symbol, adjust="qfq")
        return normalize_frame(frame, pd)
    except Exception as exc:
        print(f"  [akshare US] {exc}")
    try:
        factors = ak.stock_us_daily(symbol=symbol, adjust="qfq-factor")
        identity = (
            len(factors) == 1
            and abs(float(factors.iloc[0]["qfq_factor"]) - 1) < 1e-12
            and abs(float(factors.iloc[0]["adjust"])) < 1e-12
        )
        if identity:
            print(f"  [akshare US] using raw OHLC; adjustment factor is identity")
            return normalize_frame(ak.stock_us_daily(symbol=symbol, adjust=""), pd)
    except Exception as exc:
        print(f"  [akshare US factor] {exc}")
    return None


def fetch_tencent_hk_daily(symbol, start, end, pd, requests):
    code = f"hk{symbol.replace('.HK', '').replace('_HK', '').zfill(5)}"
    url = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
    params = {"param": f"{code},day,{start},{end},2000,qfq"}
    try:
        payload = requests.get(url, params=params, timeout=30).json()
        data = (payload.get("data") or {}).get(code) or {}
        # A raw `day` response can contain unadjusted split discontinuities.
        # Only accept Tencent when it explicitly supplies adjusted candles.
        values = data.get("qfqday") or []
        if not values:
            return None
        frame = pd.DataFrame([{
            "date": row[0],
            "open": row[1],
            "close": row[2],
            "high": row[3],
            "low": row[4],
            "volume": row[5],
        } for row in values if len(row) >= 6])
        return normalize_frame(frame, pd)
    except Exception as exc:
        print(f"  [tencent HK {symbol}] {exc}")
        return None


def fetch_nasdaq_daily(symbol, start, end, pd, requests):
    url = f"https://api.nasdaq.com/api/quote/{symbol}/historical"
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    }
    last_error = None
    for asset_class in ("stocks", "etf"):
        params = {
            "assetclass": asset_class,
            "fromdate": start,
            "todate": end,
            "limit": 5000,
        }
        try:
            payload = requests.get(url, params=params, headers=headers, timeout=30).json()
            table = ((payload.get("data") or {}).get("tradesTable") or {})
            values = table.get("rows") or []
            if not values:
                continue
            frame = pd.DataFrame([{
                "date": row.get("date"),
                "open": market_number(row.get("open")),
                "high": market_number(row.get("high")),
                "low": market_number(row.get("low")),
                "close": market_number(row.get("close")),
                "volume": market_number(row.get("volume")),
            } for row in values])
            return normalize_frame(frame, pd)
        except Exception as exc:
            last_error = exc
    if last_error:
        print(f"  [nasdaq US {symbol}] {last_error}")
    return None


def market_number(value):
    raw = str(value or "").strip().replace("$", "").replace(",", "")
    return None if raw in ("", "--", "N/A") else raw


def fetch_alpha_vantage_daily(symbol, pd, requests, api_key):
    url = "https://www.alphavantage.co/query"
    params = {"function": "TIME_SERIES_DAILY_ADJUSTED", "symbol": symbol, "outputsize": "full", "apikey": api_key}
    data = requests.get(url, params=params, timeout=30).json()
    series = data.get("Time Series (Daily)")
    if not series:
        print(f"  [alpha] {data.get('Note') or data.get('Information') or data.get('Error Message')}")
        return None
    rows = []
    for day, values in series.items():
        raw_close = market_number(values.get("4. close"))
        adjusted_close = market_number(values.get("5. adjusted close"))
        if raw_close is None or adjusted_close is None or float(raw_close) <= 0:
            continue
        adjustment_factor = float(adjusted_close) / float(raw_close)
        rows.append({
            "date": day,
            "open": scaled_market_number(values.get("1. open"), adjustment_factor),
            "high": scaled_market_number(values.get("2. high"), adjustment_factor),
            "low": scaled_market_number(values.get("3. low"), adjustment_factor),
            "close": adjusted_close,
            "volume": values.get("6. volume"),
        })
    return normalize_frame(pd.DataFrame(rows), pd)


def scaled_market_number(value, factor):
    number = market_number(value)
    return None if number is None else float(number) * factor


def normalize_frame(frame, pd, date_candidates=("date", "日期")):
    if frame is None or frame.empty:
        return None
    frame = frame.copy()
    date_col = next((col for col in date_candidates if col in frame.columns), None)
    if date_col:
        frame.index = pd.to_datetime(frame[date_col]).dt.normalize()
    elif not isinstance(frame.index, pd.DatetimeIndex):
        frame.index = pd.to_datetime(frame.index).normalize()
    else:
        frame.index = frame.index.tz_localize(None).normalize()
    out = pd.DataFrame(index=frame.index)
    for name in PRICE_COLUMNS:
        source = find_col(frame, (name, name.capitalize(), cn_col(name)))
        out[name] = pd.to_numeric(frame[source], errors="coerce") if source else None
    out = out.dropna(subset=list(PRICE_COLUMNS))
    price_columns = ["open", "high", "low", "close"]
    out = out[(out[price_columns] > 0).all(axis=1) & (out["volume"] >= 0)]
    out = out[
        (out["high"] >= out[["open", "close"]].max(axis=1))
        & (out["low"] <= out[["open", "close"]].min(axis=1))
    ]
    return out.sort_index()


def keep_completed_daily_bars(frame, market, now_utc=None):
    """Drop today's still-forming daily candle using each market's session clock."""
    if frame is None or frame.empty:
        return frame
    now_utc = now_utc or datetime.now(timezone.utc)
    timezone_name, completed_after = {
        "A股": ("Asia/Shanghai", clock_time(15, 30)),
        "港股": ("Asia/Hong_Kong", clock_time(16, 30)),
        "美股": ("America/New_York", clock_time(16, 30)),
    }.get(market, ("UTC", clock_time(23, 59)))
    market_now = now_utc.astimezone(ZoneInfo(timezone_name))
    if market_now.time().replace(tzinfo=None) >= completed_after:
        return frame
    cutoff_date = market_now.date()
    return frame[frame.index.date < cutoff_date]


def find_col(frame, candidates):
    lower_map = {str(col).lower(): col for col in frame.columns}
    for candidate in candidates:
        if candidate in frame.columns:
            return candidate
        found = lower_map.get(str(candidate).lower())
        if found is not None:
            return found
    return None


def cn_col(name):
    return {"open": "开盘", "high": "最高", "low": "最低", "close": "收盘", "volume": "成交量"}[name]


def usable(frame):
    return frame is not None and not frame.empty and frame["close"].notna().any()


def to_named_columns(frame, item, pd):
    out = pd.DataFrame(index=frame.index)
    safe_symbol = item.symbol.replace(".HK", "_HK")
    for column in PRICE_COLUMNS:
        out[f"{safe_symbol}|{item.label}|{column}"] = frame[column]
    return out


def write_workbook(merged, output: Path, pd) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        for price_type in PRICE_COLUMNS:
            cols = [col for col in merged.columns if col.endswith(f"|{price_type}")]
            sheet = merged[cols].copy()
            sheet.columns = pd.MultiIndex.from_tuples([col.rsplit("|", 1)[0].split("|", 1) for col in cols], names=["code", "name"])
            sheet.index = sheet.index.strftime("%Y-%m-%d")
            sheet.round(4).to_excel(writer, sheet_name=price_type, index_label="Date")


def infer_market(symbol):
    if symbol.endswith("_HK") or symbol.endswith(".HK"):
        return "港股"
    if symbol.isdigit():
        return "A股"
    return "美股"


if __name__ == "__main__":
    raise SystemExit(main())
