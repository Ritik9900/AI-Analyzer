"""Sector screener: country -> exchanges -> sector -> ranked long-term shortlist.

Pipeline (each stage narrows the set, so the expensive work runs on few stocks):
  1. Yahoo screener: the largest stocks in the sector on the chosen exchanges (one listing per company).
  2. All candidates: profile/valuation data + 2y prices -> sector-relative factor scores
     (quality, valuation, trend, risk) as percentiles within the screened set.
  3. Top 8: Piotroski F-Score (annual statements) and headline sentiment (FinBERT) adjust the score.
  4. Top 3 ("finalists"): long-term picture and Chronos price projection for the AI comparison.

Scores are relative to the screened peers, not absolute "buy" signals.
"""

import logging
import math
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import yfinance as yf
from yfinance import EquityQuery

from app.schemas import Candidate, DiscoverRequest, DiscoverResponse, FactorScores, Finalist
from app.services import forecast, fundamentals, longterm, market_data, sentiment

logger = logging.getLogger(__name__)

MARKETS = {
    "in": {
        "label": "India",
        "currency": "INR",
        "benchmark": "^NSEI",
        "exchanges": {"NSE": ["NSI"], "BSE": ["BSE"]},
        "cap_presets": [0, 5e10, 2e11, 1e12],  # any, >5k Cr, >20k Cr, >1L Cr
    },
    "us": {
        "label": "United States",
        "currency": "USD",
        "benchmark": "^GSPC",
        "exchanges": {"NYSE": ["NYQ"], "NASDAQ": ["NMS", "NGM", "NCM"]},
        "cap_presets": [0, 2e9, 1e10, 2e11],  # any, >$2B, >$10B, >$200B
    },
}
SECTORS = [
    "Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy",
    "Financial Services", "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities",
]
WEIGHTS = {"quality": 0.35, "valuation": 0.25, "trend": 0.25, "risk": 0.15}
DEEP_N, FINALISTS_N = 8, 3
TRADING_DAYS = 252
CACHE_TTL = 30 * 60

_cache: dict[tuple, tuple[float, DiscoverResponse]] = {}
_cache_lock = threading.Lock()


class DiscoverError(ValueError):
    pass


def options() -> dict:
    return {
        "markets": [
            {"code": c, "label": m["label"], "currency": m["currency"], "exchanges": list(m["exchanges"]), "cap_presets": m["cap_presets"]}
            for c, m in MARKETS.items()
        ],
        "sectors": SECTORS,
    }


def _num(x) -> float | None:
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def _r(x, d: int = 2) -> float | None:
    x = _num(x)
    return None if x is None else round(x, d)


def _root(symbol: str) -> str:
    return re.sub(r"\.(NS|BO)$", "", symbol.upper())


# --- Stage 1: universe -------------------------------------------------------------------


def _universe(req: DiscoverRequest) -> tuple[list[dict], int | None]:
    market = MARKETS[req.country]
    codes = [c for ex in req.exchanges for c in market["exchanges"].get(ex, [])]
    if not codes:
        raise DiscoverError(f"Choose at least one exchange for {market['label']}.")
    if req.sector not in SECTORS:
        raise DiscoverError(f"Unknown sector '{req.sector}'.")
    clauses = [EquityQuery("eq", ["region", req.country]), EquityQuery("is-in", ["exchange", *codes]), EquityQuery("eq", ["sector", req.sector])]
    if req.min_market_cap:
        clauses.append(EquityQuery("gt", ["intradaymarketcap", req.min_market_cap]))
    # Ask for extra rows: NSE and BSE list the same companies twice.
    res = yf.screen(EquityQuery("and", clauses), sortField="intradaymarketcap", sortAsc=False, size=min(250, req.size * 2 + 10))
    seen: dict[str, dict] = {}
    for q in res.get("quotes", []):
        if q.get("quoteType") != "EQUITY" or not q.get("symbol"):
            continue
        key = _root(q["symbol"]) if req.country == "in" else q["symbol"]
        if key in seen and not q["symbol"].endswith(".NS"):
            continue  # prefer the NSE listing
        seen[key] = q
    quotes = sorted(seen.values(), key=lambda q: -(q.get("marketCap") or 0))[: req.size]
    return quotes, res.get("total")


# --- Stage 2: factors --------------------------------------------------------------------


def _price_stats(df: pd.DataFrame | None, bench: pd.DataFrame | None) -> dict:
    out = dict.fromkeys(["pct_vs_sma200", "momentum_12_1_pct", "return_1y_pct", "relative_1y_pct", "volatility_1y_pct", "max_drawdown_1y_pct"])
    if df is None or len(df) < 200:
        return out
    close = df["Close"]
    last = float(close.iloc[-1])
    out["pct_vs_sma200"] = (last / float(close.rolling(200).mean().iloc[-1]) - 1) * 100
    if len(close) > TRADING_DAYS:
        out["momentum_12_1_pct"] = (float(close.iloc[-21]) / float(close.iloc[-TRADING_DAYS - 1]) - 1) * 100
        out["return_1y_pct"] = (last / float(close.iloc[-TRADING_DAYS - 1]) - 1) * 100
        if bench is not None and len(bench) > TRADING_DAYS:
            b = bench["Close"]
            out["relative_1y_pct"] = out["return_1y_pct"] - (float(b.iloc[-1]) / float(b.iloc[-TRADING_DAYS - 1]) - 1) * 100
    yr = close.iloc[-TRADING_DAYS:]
    rets = np.log(yr / yr.shift(1)).dropna()
    out["volatility_1y_pct"] = float(rets.std() * math.sqrt(TRADING_DAYS) * 100) if len(rets) > 20 else None
    out["max_drawdown_1y_pct"] = float((yr / yr.cummax() - 1).min() * 100)
    return out


def _pct_rank(values: list[float | None], higher_better: bool = True) -> list[float | None]:
    s = pd.Series(values, dtype="float64")
    ranks = s.rank(pct=True, ascending=higher_better)  # NaN stays NaN
    return [None if pd.isna(v) else float(v) * 100 for v in ranks]


def _mean(xs: list[float | None]) -> float | None:
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def _score(rows: list[dict], is_financial: bool) -> None:
    """Sector-relative percentile factors; missing inputs are skipped (coverage records how many)."""
    # Valuation: lower P/E and P/B are better; a negative P/E (losses) ranks as most expensive.
    pe = [r["pe_trailing"] if (r["pe_trailing"] or 0) > 0 else (1e9 if r["pe_trailing"] is not None else None) for r in rows]
    inputs = {
        "quality": [
            _pct_rank([r["roe_pct"] for r in rows]),
            _pct_rank([r["operating_margin_pct"] for r in rows]),
            _pct_rank([r["revenue_growth_pct"] for r in rows]),
            *([] if is_financial else [_pct_rank([r["debt_to_equity"] for r in rows], higher_better=False)]),
        ],
        "valuation": [
            _pct_rank(pe, higher_better=False),
            _pct_rank([r["price_to_book"] for r in rows], higher_better=False),
            _pct_rank([r["analyst_upside_pct"] for r in rows]),
        ],
        "trend": [
            _pct_rank([r["pct_vs_sma200"] for r in rows]),
            _pct_rank([r["momentum_12_1_pct"] for r in rows]),
            _pct_rank([r["relative_1y_pct"] for r in rows]),
        ],
        "risk": [
            _pct_rank([r["volatility_1y_pct"] for r in rows], higher_better=False),
            _pct_rank([r["max_drawdown_1y_pct"] for r in rows]),  # less negative is better
        ],
    }
    n_inputs = sum(len(v) for v in inputs.values())
    for i, r in enumerate(rows):
        factors = {k: _mean([col[i] for col in cols]) for k, cols in inputs.items()}
        have = sum(1 for cols in inputs.values() for col in cols if col[i] is not None)
        avail = {k: v for k, v in factors.items() if v is not None}
        total_w = sum(WEIGHTS[k] for k in avail)
        composite = sum(WEIGHTS[k] * v for k, v in avail.items()) / total_w if total_w else 0.0
        coverage = have / n_inputs
        r["factors"] = {k: _r(v, 1) for k, v in factors.items()}
        r["coverage"] = round(coverage, 2)
        # Thin data is less trustworthy: shrink toward the middle in proportion to what's missing.
        r["score"] = round(50 + (composite - 50) * (0.5 + 0.5 * coverage), 1)


def _row(q: dict, info: dict, stats: dict) -> dict:
    price = _num(q.get("regularMarketPrice")) or _num(info.get("currentPrice"))
    target = _num(info.get("targetMeanPrice"))
    dte = _num(info.get("debtToEquity"))
    return {
        "ticker": q["symbol"],
        "name": q.get("longName") or q.get("shortName"),
        "exchange": q.get("fullExchangeName"),
        "industry": info.get("industry"),
        "currency": q.get("currency"),
        "price": _r(price),
        "market_cap": _num(q.get("marketCap")),
        "pe_trailing": _r(q.get("trailingPE") or info.get("trailingPE")),
        "pe_forward": _r(q.get("forwardPE") or info.get("forwardPE")),
        "price_to_book": _r(q.get("priceToBook") or info.get("priceToBook")),
        "roe_pct": _r(_num(info.get("returnOnEquity")) * 100) if _num(info.get("returnOnEquity")) is not None else None,
        "operating_margin_pct": _r(_num(info.get("operatingMargins")) * 100) if _num(info.get("operatingMargins")) is not None else None,
        "debt_to_equity": _r(dte / 100) if dte is not None else None,  # Yahoo reports D/E x100
        "revenue_growth_pct": _r(_num(info.get("revenueGrowth")) * 100) if _num(info.get("revenueGrowth")) is not None else None,
        "dividend_yield_pct": _r(q.get("dividendYield")),  # already in percent
        "analyst_upside_pct": _r((target / price - 1) * 100) if target and price else None,
        "analyst_rating": q.get("averageAnalystRating"),
        **{k: _r(v) for k, v in stats.items()},
    }


# --- Main --------------------------------------------------------------------------------


def run(req: DiscoverRequest) -> DiscoverResponse:
    key = (req.country, tuple(sorted(req.exchanges)), req.sector, req.min_market_cap, req.size)
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] < CACHE_TTL:
            return hit[1]

    t0 = time.monotonic()
    market = MARKETS[req.country]
    notes: list[str] = []
    quotes, total = _universe(req)
    if not quotes:
        raise DiscoverError("No stocks matched. Try another sector, more exchanges or a lower minimum size.")

    def hist(t):
        try:
            return market_data.get_history(t, "2y")
        except Exception:  # noqa: BLE001
            return None

    with ThreadPoolExecutor(max_workers=6) as pool:
        bench_f = pool.submit(hist, market["benchmark"])
        infos = list(pool.map(lambda q: market_data.get_info(q["symbol"]), quotes))
        hists = list(pool.map(lambda q: hist(q["symbol"]), quotes))
        bench = bench_f.result()

    rows, excluded = [], []
    for q, info, df in zip(quotes, infos, hists):
        if df is None or len(df) < 200:
            excluded.append(q["symbol"])  # recent listing or no data: trend/risk can't be judged fairly
            continue
        rows.append({**_row(q, info, _price_stats(df, bench)), "_df": df})
    if not rows:
        raise DiscoverError("Price history was unavailable for every stock in this screen. Try again in a minute.")
    if excluded:
        notes.append(f"{len(excluded)} stock(s) skipped for having under 200 trading days of history (e.g. recent listings).")

    _score(rows, is_financial=req.sector == "Financial Services")
    rows.sort(key=lambda r: r["score"], reverse=True)

    # Stage 3: F-Score + sentiment for the leaders, then re-rank them.
    deep = rows[:DEEP_N]

    def enrich(r):
        try:
            tests, _ = fundamentals.piotroski(*market_data.get_financials(r["ticker"]))
            usable = [t for t in tests if t.passed is not None]
            if usable:
                r["piotroski_score"], r["piotroski_max"] = sum(t.passed for t in usable), len(usable)
        except Exception as exc:  # noqa: BLE001
            logger.warning("piotroski failed for %s: %s", r["ticker"], exc)
        r["_headlines"] = market_data.get_headlines(r["ticker"], 8)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(enrich, deep))
    for r in deep:
        s = sentiment.analyze(r["_headlines"])  # FinBERT runs here (sequentially; it is CPU-bound)
        r["_sentiment"] = s
        r["sentiment_score"], r["sentiment_label"], r["sentiment_is_mock"] = s.score, s.label, s.is_mock
        adj = 0.0
        if r.get("piotroski_max") and r["piotroski_max"] >= 5:
            adj += (r["piotroski_score"] / r["piotroski_max"] - 0.5) * 10  # up to +/-5 points
        adj += max(-1.0, min(1.0, s.score)) * 2  # news is weak evidence for long-term investors: +/-2
        r["score"] = round(min(100, max(0, r["score"] + adj)), 1)
    rows[:DEEP_N] = sorted(deep, key=lambda r: r["score"], reverse=True)

    finalists = []
    for r in rows[:FINALISTS_N]:
        lt = longterm.compute_long_term(r["_df"], market["benchmark"], bench)
        weekly = longterm.to_weekly(r["_df"])["Close"]
        fc = forecast.forecast(weekly, 26, "weekly")
        finalists.append(Finalist(ticker=r["ticker"], long_term=lt, forecast=fc, headlines=r["_sentiment"].headlines[:5]))

    medians = {
        k: _r(pd.Series([r[k] for r in rows if r[k] is not None and (k != "pe_trailing" or r[k] > 0)], dtype="float64").median())
        for k in ("pe_trailing", "price_to_book", "roe_pct", "operating_margin_pct", "dividend_yield_pct", "return_1y_pct")
    }
    candidates = [
        Candidate(rank=i + 1, factors=FactorScores(**r["factors"]), **{k: v for k, v in r.items() if not k.startswith("_") and k != "factors"})
        for i, r in enumerate(rows)
    ]
    if any(r.get("sentiment_is_mock") for r in deep):
        notes.append("News sentiment uses the keyword fallback (FinBERT not loaded).")
    if finalists and finalists[0].forecast.is_mock:
        notes.append("Price projections are a statistical baseline (Chronos not loaded).")

    result = DiscoverResponse(
        as_of=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        country=req.country,
        exchanges=req.exchanges,
        sector=req.sector,
        currency=market["currency"],
        benchmark=market["benchmark"],
        total_in_sector=total,
        screened=len(rows),
        sector_medians=medians,
        candidates=candidates,
        finalists=finalists,
        excluded=excluded,
        notes=notes,
        elapsed_s=round(time.monotonic() - t0, 1),
    )
    with _cache_lock:
        _cache[key] = (time.monotonic(), result)
    return result
