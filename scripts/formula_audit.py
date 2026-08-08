#!/usr/bin/env python3
"""Independent Python formula checks against the JS domain implementation."""

from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOL = 1e-5


def normal_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)


def normal_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def get_delta_bands(entry_price: float, holding_days: float, iv: float, delta_slope: float, tdpy: float = 365) -> dict:
    e_t = math.sqrt(holding_days / (tdpy * 2 * math.pi))
    wave = iv * e_t
    ratio = ((1 + wave) / (1 - wave)) ** 2
    long_cost = entry_price * (delta_slope * ratio - delta_slope + 1) ** 2 / ratio
    short_cost = entry_price * (delta_slope / ratio - delta_slope + 1) ** 2 * ratio
    return {
        "wave": wave,
        "ratio": ratio,
        "longLow": long_cost / ratio,
        "longCost": long_cost,
        "longHigh": long_cost * ratio,
        "shortLow": short_cost / ratio,
        "shortCost": short_cost,
        "shortHigh": short_cost * ratio,
    }


def black_scholes(entry_price: float, strike_price: float, holding_days: float, iv: float, risk_free_rate: float, opt_type: str, tdpy: float = 365) -> dict:
    t = holding_days / tdpy
    d1 = (math.log(entry_price / strike_price) + (risk_free_rate + 0.5 * iv * iv) * t) / (iv * math.sqrt(t))
    d2 = d1 - iv * math.sqrt(t)
    if opt_type == "call":
        price = entry_price * normal_cdf(d1) - strike_price * math.exp(-risk_free_rate * t) * normal_cdf(d2)
        delta = normal_cdf(d1)
        theta = -(entry_price * normal_pdf(d1) * iv) / (2 * math.sqrt(t)) - risk_free_rate * strike_price * math.exp(-risk_free_rate * t) * normal_cdf(d2)
    else:
        price = strike_price * math.exp(-risk_free_rate * t) * normal_cdf(-d2) - entry_price * normal_cdf(-d1)
        delta = normal_cdf(d1) - 1
        theta = -(entry_price * normal_pdf(d1) * iv) / (2 * math.sqrt(t)) + risk_free_rate * strike_price * math.exp(-risk_free_rate * t) * normal_cdf(-d2)
    gamma = normal_pdf(d1) / (entry_price * iv * math.sqrt(t))
    return {"price": price, "delta": delta, "gamma": gamma, "thetaDaily": theta / tdpy}


def bachelier(entry_price: float, strike_price: float, holding_days: float, normal_vol: float, risk_free_rate: float, opt_type: str, tdpy: float = 365) -> dict:
    t = holding_days / tdpy
    sigma_t = normal_vol * math.sqrt(t)
    d = (entry_price - strike_price) / sigma_t
    undiscounted = (entry_price - strike_price) * normal_cdf(d) + sigma_t * normal_pdf(d)
    if opt_type == "put":
        undiscounted = (strike_price - entry_price) * normal_cdf(-d) + sigma_t * normal_pdf(d)
    price = math.exp(-risk_free_rate * t) * undiscounted
    discount = math.exp(-risk_free_rate * t)
    return {"price": price, "delta": discount * (normal_cdf(d) if opt_type == "call" else normal_cdf(d) - 1)}


def v3_inventory(mark_price: float, lower_price: float, upper_price: float, liquidity: float) -> dict:
    sqrt_p = math.sqrt(mark_price)
    sqrt_l = math.sqrt(lower_price)
    sqrt_u = math.sqrt(upper_price)
    if mark_price <= lower_price:
        token0 = liquidity * (sqrt_u - sqrt_l) / (sqrt_l * sqrt_u)
        token1 = 0
    elif mark_price >= upper_price:
        token0 = 0
        token1 = liquidity * (sqrt_u - sqrt_l)
    else:
        token0 = liquidity * (sqrt_u - sqrt_p) / (sqrt_p * sqrt_u)
        token1 = liquidity * (sqrt_p - sqrt_l)
    return {"token0": token0, "token1": token1, "value": token0 * mark_price + token1, "inventoryDelta": token0}


def impermanent_loss(mark_price: float, start_price: float) -> dict:
    ratio = mark_price / start_price
    il = 2 * math.sqrt(ratio) / (1 + ratio) - 1
    return {"impermanentLoss": il}


def capital_efficiency(range_width: float, skew: float) -> dict:
    lower = 1 - range_width
    upper = 1 + skew * range_width
    return {"efficiency": 1 / (1 - (lower / upper) ** 0.25)}


def funding_rate(perp_twap: float, spot_twap: float, hours: float) -> dict:
    basis = perp_twap / spot_twap - 1
    cumulative = basis * hours / 24
    return {"basisEstimate": basis, "fundingProxy": cumulative, "cumulativeFundingEstimate": cumulative}


def js_values() -> dict:
    code = """
      import {
        bachelierOption,
        blackScholes,
        capitalEfficiency,
        fundingRate,
        getDeltaBands,
        impermanentLoss,
        uniswapV3Inventory,
      } from './src/domain/formulas/core.js'
      const bands = getDeltaBands({ entryPrice: 100, holdingDays: 30, iv: 0.4, targetReturn: 0.3, tradingDaysPerYear: 365 })
      const bs = blackScholes({ entryPrice: 100, strikePrice: 105, holdingDays: 30, iv: 0.4, riskFreeRate: 0.04, type: 'put', tradingDaysPerYear: 365 })
      const bach = bachelierOption({ entryPrice: 100, strikePrice: 105, holdingDays: 30, normalVol: 40, riskFreeRate: 0.04, type: 'put', tradingDaysPerYear: 365 })
      const lp = uniswapV3Inventory({ markPrice: 110, lowerPrice: 70, upperPrice: 130, liquidity: 10 })
      const il = impermanentLoss({ markPrice: 110, startPrice: 100, liquidity: 10 })
      const ce = capitalEfficiency({ rangeWidth: 0.1, skew: 1.4 })
      const funding = fundingRate({ perpTwap: 101, spotTwap: 100, hours: 8 })
      console.log(JSON.stringify({ bands, bs, bach, lp, il, ce, funding }))
    """
    result = subprocess.run(
        ["node", "--input-type=module", "-e", code],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def compare(label: str, js: float, py: float, tol: float = TOL) -> list[str]:
    if js is None or not math.isfinite(js) or not math.isfinite(py):
        return [f"{label}: non-finite JS={js} PY={py}"]
    err = abs(js - py)
    scale = max(1.0, abs(js), abs(py))
    if err / scale > tol:
        return [f"{label}: JS={js:.12g} PY={py:.12g} err={err:.3g}"]
    return []


def main() -> int:
    js = js_values()
    py = {
        "bands": get_delta_bands(100, 30, 0.4, 0.3),
        "bs": black_scholes(100, 105, 30, 0.4, 0.04, "put"),
        "bach": bachelier(100, 105, 30, 40, 0.04, "put"),
        "lp": v3_inventory(110, 70, 130, 10),
        "il": impermanent_loss(110, 100),
        "ce": capital_efficiency(0.1, 1.4),
        "funding": funding_rate(101, 100, 8),
    }
    checks = [
        ("delta-band.long.low", js["bands"]["long"]["low"], py["bands"]["longLow"]),
        ("delta-band.long.cost", js["bands"]["long"]["cost"], py["bands"]["longCost"]),
        ("delta-band.long.high", js["bands"]["long"]["high"], py["bands"]["longHigh"]),
        ("black-scholes.price", js["bs"]["price"], py["bs"]["price"]),
        ("black-scholes.delta", js["bs"]["delta"], py["bs"]["delta"]),
        ("black-scholes.gamma", js["bs"]["gamma"], py["bs"]["gamma"]),
        ("black-scholes.thetaDaily", js["bs"]["thetaDaily"], py["bs"]["thetaDaily"]),
        ("bachelier.price", js["bach"]["price"], py["bach"]["price"]),
        ("bachelier.delta", js["bach"]["delta"], py["bach"]["delta"]),
        ("lp-v3.token0", js["lp"]["token0"], py["lp"]["token0"]),
        ("lp-v3.token1", js["lp"]["token1"], py["lp"]["token1"]),
        ("lp-v3.value", js["lp"]["value"], py["lp"]["value"]),
        ("impermanent-loss", js["il"]["impermanentLoss"], py["il"]["impermanentLoss"]),
        ("capital-efficiency", js["ce"]["efficiency"], py["ce"]["efficiency"]),
        ("funding.basisEstimate", js["funding"]["basisEstimate"], py["funding"]["basisEstimate"]),
        ("funding.cumulativeFundingEstimate", js["funding"]["cumulativeFundingEstimate"], py["funding"]["cumulativeFundingEstimate"]),
    ]
    failures = [msg for label, j, p in checks for msg in compare(label, j, p)]
    if failures:
        print("formula audit failed", file=sys.stderr)
        for failure in failures:
            print(failure, file=sys.stderr)
        return 1
    print(f"formula audit passed: {len(checks)} tolerance checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
