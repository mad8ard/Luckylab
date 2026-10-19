#!/usr/bin/env python3
"""用客户端导出的沪股通/深股通名单生成北向标记。

数据来源：
  data/northbound/沪股通.xls
  data/northbound/深股通.xls

文件是 GBK 制表符文本（扩展名 .xls），列为：
  名称 / JINGE（净额，元） / 市盈(动) / 市净率

标记口径：
  - 名单里出现，说明股东名单含「香港中央结算」；
  - JINGE > 0（净买入）才在页面打 *；
  - JINGE <= 0 仍保留在 JSON 里，但不打标记。
客户端会把部分名称截断成 4 个字（如 XD中国人、XD大秦铁），
因此匹配时先去掉 XD/DR/XR/ST 等前缀，再做前缀匹配。

输出：src/data/northbound-marks.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_DIR = ROOT / "data" / "northbound"
DEFAULT_INDEX = ROOT / "src" / "data" / "stock-index.json"
DEFAULT_OUT = ROOT / "src" / "data" / "northbound-marks.json"
EXPORTS = ("沪股通.xls", "深股通.xls")
ENCODINGS = ("gbk", "gb18030", "utf-8-sig")
PREFIX_RE = re.compile(r"^(\*?ST|XD|XR|DR|N|C|S)(?=[\u4e00-\u9fff])")


def main() -> int:
    args = parse_args()
    source_dir = Path(args.source_dir)
    index_path = Path(args.index)
    out_path = Path(args.out)

    index = json.loads(index_path.read_text(encoding="utf-8"))
    a_shares = [item for item in index if item.get("market") == "A股"]

    exports = {}
    export_counts = []
    newest_mtime = None
    for filename in EXPORTS:
        path = source_dir / filename
        if not path.exists():
            print(f"缺少导出文件：{path}", file=sys.stderr)
            return 2
        rows = read_export(path)
        export_counts.append({"file": filename, "count": len(rows)})
        mtime = datetime.fromtimestamp(path.stat().st_mtime)
        newest_mtime = max(newest_mtime, mtime) if newest_mtime else mtime
        for row in rows:
            key = normalize(row["name"])
            if key and key not in exports:
                exports[key] = {"name": row["name"], "netAmount": row["netAmount"], "file": filename}

    if not exports:
        print("导出名单为空，未写入。", file=sys.stderr)
        return 2

    date = args.as_of or (newest_mtime.strftime("%Y-%m-%d") if newest_mtime else None)
    matched = {}
    unmatched = []
    for entry in a_shares:
        symbol = str(entry.get("symbol") or "").strip()
        label = str(entry.get("label") or symbol)
        hit = find_export_match(label, exports)
        if not symbol or not hit:
            unmatched.append({"symbol": symbol, "label": label})
            continue
        amount = hit["netAmount"]
        matched[symbol] = {
            "label": label,
            "exports": [hit["file"]],
            "date": date,
            "netAmount": amount,
            "direction": "in" if isinstance(amount, (int, float)) and amount > 0 else (
                "out" if isinstance(amount, (int, float)) and amount < 0 else "flat"
            ),
        }

    inflow = sum(1 for item in matched.values() if item["direction"] == "in")
    outflow = sum(1 for item in matched.values() if item["direction"] == "out")
    flat = sum(1 for item in matched.values() if item["direction"] == "flat")
    payload = {
        "schemaVersion": "northbound-marks.v3",
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "dataThrough": date,
        "source": "客户端导出：沪股通.xls / 深股通.xls（名称 / JINGE 净额 / 市盈 / 市净率）",
        "note": "名单表示股东名单含香港中央结算；* 标记全部名单内股票，悬停显示 JINGE 净额。",
        "totalScanned": len(a_shares),
        "totalMatched": len(matched),
        "totalMarked": len(matched),
        "inflow": inflow,
        "outflow": outflow,
        "flat": flat,
        "unmatchedCount": len(unmatched),
        "exports": export_counts,
        "unmatched": unmatched,
        "symbols": matched,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        "北向标记写入完成：matched=%d / inflow=%d / outflow=%d / scanned=%d / 截止 %s"
        % (len(matched), inflow, outflow, len(a_shares), date)
    )
    if unmatched:
        print("  未匹配：%s" % ", ".join(f"{item['symbol']} {item['label']}" for item in unmatched))
    print("  %s" % out_path)
    return 0


def read_export(path: Path) -> list[dict]:
    raw = path.read_bytes()
    text = None
    for encoding in ENCODINGS:
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise SystemExit(f"无法解码导出文件：{path}")
    lines = [line for line in re.split(r"\r\n|\r|\n", text) if line.strip()]
    if not lines:
        return []
    header = [cell.strip() for cell in lines[0].split("\t")]
    name_index = header.index("名称") if "名称" in header else 0
    amount_index = next(
        (i for i, cell in enumerate(header) if "JINGE" in cell.upper() or "净" in cell),
        1,
    )
    rows = []
    for line in lines[1:]:
        cells = line.split("\t")
        name = cells[name_index].strip() if name_index < len(cells) else ""
        raw_amount = cells[amount_index].strip() if amount_index < len(cells) else ""
        if name and name != "名称":
            rows.append({"name": name, "netAmount": parse_amount(raw_amount)})
    return rows


def parse_amount(value: str):
    text = str(value or "").strip().replace(",", "").replace("，", "")
    if not text or text in ("--", "-", "—", "None", "nan"):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def normalize(value: str) -> str:
    text = unicodedata.normalize("NFKC", str(value)).upper()
    return re.sub(r"\s+", "", text)


def strip_prefix(value: str) -> str:
    text = normalize(value)
    while True:
        match = PREFIX_RE.match(text)
        if not match:
            return text
        text = text[match.end():]


def find_export_match(label: str, exports: dict):
    exact = exports.get(normalize(label))
    if exact:
        return exact
    target = strip_prefix(label)
    candidates = []
    for key, row in exports.items():
        source = strip_prefix(key)
        if len(source) >= 3 and target.startswith(source):
            candidates.append(row)
    return candidates[0] if len(candidates) == 1 else None


def parse_args():
    parser = argparse.ArgumentParser(description="用客户端沪股通/深股通名单生成北向标记")
    parser.add_argument("--source-dir", default=str(DEFAULT_SOURCE_DIR), help="导出文件目录")
    parser.add_argument("--index", default=str(DEFAULT_INDEX), help="stock-index.json 路径")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="输出 JSON 路径")
    parser.add_argument("--as-of", default="", help="覆盖数据截止日期，默认取导出文件修改日期")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
