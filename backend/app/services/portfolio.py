"""Portfolio-level analytics: performance vs benchmark, risk contribution, correlation, HRP weights.

All risk numbers use daily returns over a trailing window and assume the CURRENT quantities were held
throughout (a "what your portfolio as it stands today did" view, not your actual trading history).
"""

import logging
import math
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from app.schemas import (
    Correlation,
    ExcludedHolding,
    HoldingAnalytics,
    HoldingInput,
    PortfolioAnalytics,
    PortfolioStats,
    SeriesPoint,
)
from app.services import market_data

logger = logging.getLogger(__name__)

TRADING_DAYS = 252
HISTORY_PERIOD = "2y"  # enough for a 1y window plus the 200-day average
MIN_COVERAGE = 0.8  # a holding needs prices on >= 80% of window days to enter the risk maths


def _r(x, digits: int = 2) -> float | None:
    if x is None:
        return None
    f = float(x)
    return None if math.isnan(f) or math.isinf(f) else round(f, digits)


def _num(x) -> float | None:
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def classify_sector(info: dict) -> str:
    """Yahoo sector, or a sensible bucket for funds/ETFs that have none."""
    if info.get("sector"):
        return info["sector"]
    name = f"{info.get('longName') or ''} {info.get('shortName') or ''}"
    if re.search(r"\b(gold|silver)\b", name, re.I):
        return "Precious metals (ETF)"
    if info.get("quoteType") in ("ETF", "MUTUALFUND") or re.search(r"\b(ETF|BeES|Fund|Index)\b", name, re.I):
        return "Funds & ETFs"
    return "Unclassified"


def _naive_daily(series: pd.Series) -> pd.Series:
    idx = pd.DatetimeIndex(series.index)
    idx = (idx.tz_localize(None) if idx.tz is not None else idx).normalize()
    return pd.Series(series.to_numpy(), index=idx)


# --- Hierarchical Risk Parity (Lopez de Prado, 2016), numpy-only ----------------------


def _single_linkage_order(dist: np.ndarray) -> list[int]:
    """Leaf order of a single-linkage agglomerative clustering (the 'quasi-diagonal' ordering)."""
    clusters: list[list[int]] = [[i] for i in range(len(dist))]
    while len(clusters) > 1:
        best = (math.inf, 0, 1)
        for a in range(len(clusters)):
            for b in range(a + 1, len(clusters)):
                d = dist[np.ix_(clusters[a], clusters[b])].min()
                if d < best[0]:
                    best = (d, a, b)
        _, a, b = best
        merged = clusters[a] + clusters[b]  # keep left-then-right leaf order
        clusters = [c for i, c in enumerate(clusters) if i not in (a, b)] + [merged]
    return clusters[0]


def _cluster_variance(cov: np.ndarray, idx: list[int]) -> float:
    sub = cov[np.ix_(idx, idx)]
    ivp = 1 / np.diag(sub)
    ivp /= ivp.sum()
    return float(ivp @ sub @ ivp)


def hrp_weights(cov: np.ndarray, corr: np.ndarray) -> np.ndarray:
    n = len(cov)
    if n == 1:
        return np.array([1.0])
    dist = np.sqrt(np.clip((1 - corr) / 2, 0, None))
    order = _single_linkage_order(dist)
    w = np.ones(n)
    pending = [order]
    while pending:
        nxt = []
        for cluster in pending:
            if len(cluster) < 2:
                continue
            half = len(cluster) // 2
            left, right = cluster[:half], cluster[half:]
            v_left, v_right = _cluster_variance(cov, left), _cluster_variance(cov, right)
            alpha = 1 - v_left / (v_left + v_right)
            w[left] *= alpha
            w[right] *= 1 - alpha
            nxt += [left, right]
        pending = nxt
    return w / w.sum()


# --- Main -----------------------------------------------------------------------------


def analyze(holdings: list[HoldingInput], window_days: int) -> PortfolioAnalytics:
    tickers = list(dict.fromkeys(h.ticker.upper() for h in holdings))
    qty = {h.ticker.upper(): h.quantity for h in holdings}
    benchmark = Counter(market_data.benchmark_for(t) for t in tickers).most_common(1)[0][0]

    def fetch(t: str):
        try:
            return market_data.get_history(t, HISTORY_PERIOD)["Close"]
        except Exception as exc:  # noqa: BLE001
            logger.warning("history failed for %s: %s", t, exc)
            return None

    with ThreadPoolExecutor(max_workers=min(10, 2 * len(tickers) + 1)) as pool:
        closes_f = {t: pool.submit(fetch, t) for t in tickers}
        infos_f = {t: pool.submit(market_data.get_info, t) for t in tickers}
        bench_f = pool.submit(fetch, benchmark)
        closes = {t: f.result() for t, f in closes_f.items()}
        infos = {t: f.result() for t, f in infos_f.items()}
        bench_close = bench_f.result()

    excluded: list[ExcludedHolding] = [ExcludedHolding(ticker=t, reason="No price history") for t, c in closes.items() if c is None]
    frame = pd.concat({t: _naive_daily(c) for t, c in closes.items() if c is not None}, axis=1).sort_index().ffill()
    full = frame.copy()  # longer history for the 200-day average

    # Window: the last `window_days` sessions (+1 for the first return).
    frame = frame.iloc[-(window_days + 1) :]
    for t in list(frame.columns):
        coverage = frame[t].notna().mean()
        if coverage < MIN_COVERAGE:
            excluded.append(ExcludedHolding(ticker=t, reason=f"Only {coverage:.0%} price coverage in the window (recent listing?)"))
            frame = frame.drop(columns=t)
    frame = frame.dropna()
    used = list(frame.columns)

    if not used or len(frame) < 30:
        return PortfolioAnalytics(
            as_of=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            benchmark=benchmark,
            window_days=window_days,
            start_date=None,
            holdings=[],
            series=[],
            correlation=None,
            stats=PortfolioStats(return_pct=None, benchmark_return_pct=None, volatility_pct=None, beta=None, max_drawdown_pct=None, diversification_ratio=None, effective_holdings=0, avg_correlation=None),
            excluded=excluded,
        )

    q = np.array([qty[t] for t in used])
    values = frame[used].to_numpy() * q  # position values per day
    port = values.sum(axis=1)
    w = values[-1] / port[-1]  # current weights

    rets = frame[used].pct_change().dropna()
    port_ret = pd.Series(port, index=frame.index).pct_change().dropna()
    cov = rets.cov().to_numpy() * TRADING_DAYS
    corr = rets.corr().to_numpy()
    vols = np.sqrt(np.diag(cov))
    port_var = float(w @ cov @ w)
    port_vol = math.sqrt(port_var) if port_var > 0 else None
    rc = (w * (cov @ w)) / port_var if port_var > 0 else np.full(len(used), np.nan)
    hrp = hrp_weights(cov, corr) if len(used) > 1 else np.array([1.0])

    bench = None
    bench_ret = None
    if bench_close is not None:
        b = _naive_daily(bench_close).reindex(frame.index.union(_naive_daily(bench_close).index)).sort_index().ffill().reindex(frame.index)
        if b.notna().all():
            bench = b
            bench_ret = b.pct_change().dropna()

    def beta_of(r: pd.Series) -> float | None:
        if bench_ret is None:
            return None
        j = pd.concat([r, bench_ret], axis=1, join="inner").dropna()
        var = j.iloc[:, 1].var()
        return float(j.iloc[:, 0].cov(j.iloc[:, 1]) / var) if len(j) > 20 and var > 0 else None

    running_max = np.maximum.accumulate(port)
    off_diag = corr[~np.eye(len(used), dtype=bool)]

    holdings_out = []
    for i, t in enumerate(used):
        info = infos.get(t, {})
        long_close = full[t].dropna()
        sma200 = long_close.rolling(200).mean().iloc[-1] if len(long_close) >= 200 else None
        holdings_out.append(
            HoldingAnalytics(
                ticker=t,
                name=info.get("longName") or info.get("shortName"),
                sector=classify_sector(info),
                industry=info.get("industry"),
                weight_pct=_r(w[i] * 100),
                return_pct=_r((frame[t].iloc[-1] / frame[t].iloc[0] - 1) * 100),
                volatility_pct=_r(vols[i] * 100),
                beta=_r(beta_of(rets[t])),
                pct_vs_sma200=_r((long_close.iloc[-1] / sma200 - 1) * 100) if sma200 else None,
                dividend_yield_pct=_num(info.get("dividendYield")),  # Yahoo reports this in percent
                pe_trailing=_r(_num(info.get("trailingPE"))),
                risk_contribution_pct=_r(rc[i] * 100),
                hrp_weight_pct=_r(hrp[i] * 100),
            )
        )

    series = [
        SeriesPoint(date=d.strftime("%Y-%m-%d"), portfolio=round(float(v), 2), benchmark=None if bench is None else round(float(bench.iloc[k]), 2))
        for k, (d, v) in enumerate(zip(frame.index, port))
    ]

    return PortfolioAnalytics(
        as_of=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        benchmark=benchmark,
        window_days=window_days,
        start_date=frame.index[0].strftime("%Y-%m-%d"),
        holdings=holdings_out,
        series=series,
        correlation=Correlation(tickers=used, matrix=[[round(float(x), 3) for x in row] for row in corr]) if len(used) > 1 else None,
        stats=PortfolioStats(
            return_pct=_r((port[-1] / port[0] - 1) * 100),
            benchmark_return_pct=_r((bench.iloc[-1] / bench.iloc[0] - 1) * 100) if bench is not None else None,
            volatility_pct=_r(port_vol * 100) if port_vol else None,
            beta=_r(beta_of(port_ret)),
            max_drawdown_pct=_r(float((port / running_max - 1).min()) * 100),
            diversification_ratio=_r(float(w @ vols) / port_vol) if port_vol else None,
            effective_holdings=_r(1 / float((w**2).sum()), 1),
            avg_correlation=_r(float(off_diag.mean()), 2) if off_diag.size else None,
        ),
        excluded=excluded,
    )
