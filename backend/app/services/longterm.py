"""Multi-year trend, return and risk metrics for long-term investing decisions."""

import math

import numpy as np
import pandas as pd

from app.schemas import LongTerm
from app.services.technicals import _cluster, _r, _rsi_pandas, _swing_points

TRADING_DAYS = 252


def to_weekly(df: pd.DataFrame) -> pd.DataFrame:
    """Daily OHLC -> weekly bars ending Friday."""
    weekly = df.resample("W-FRI").agg({"Open": "first", "High": "max", "Low": "min", "Close": "last"})
    return weekly.dropna(subset=["Close"])


def _naive(index: pd.Index) -> pd.DatetimeIndex:
    idx = pd.DatetimeIndex(index)
    return idx.tz_localize(None) if idx.tz is not None else idx


def _return_over(close: pd.Series, days: int) -> float | None:
    if len(close) <= days:
        return None
    return float(close.iloc[-1] / close.iloc[-1 - days] - 1)


def _cagr(close: pd.Series, years: int) -> float | None:
    """Annualised return using the first close on/after the date `years` ago (calendar-based)."""
    idx = _naive(close.index)
    target = idx[-1] - pd.DateOffset(years=years)
    if idx[0] > target + pd.Timedelta(days=10):  # not enough history
        return None
    start = close.iloc[int(idx.searchsorted(target))]
    return (float(close.iloc[-1]) / float(start)) ** (1 / years) - 1


def _pct(x: float | None, digits: int = 2) -> float | None:
    return None if x is None else _r(x * 100, digits)


def compute_long_term(df: pd.DataFrame, benchmark: str | None, bench_df: pd.DataFrame | None) -> LongTerm:
    close = df["Close"]
    last = float(close.iloc[-1])

    sma50 = close.rolling(50).mean().iloc[-1] if len(close) >= 50 else None
    sma200 = close.rolling(200).mean().iloc[-1] if len(close) >= 200 else None
    if sma50 is not None and sma200 is not None:
        if last > sma200 and sma50 > sma200:
            trend = "uptrend"
        elif last < sma200 and sma50 < sma200:
            trend = "downtrend"
        else:
            trend = "sideways"
    else:
        trend = "unknown"

    last_year = close.iloc[-TRADING_DAYS:]
    high_52w, low_52w = float(df["High"].iloc[-TRADING_DAYS:].max()), float(df["Low"].iloc[-TRADING_DAYS:].min())

    # 12-1 momentum: return from 12 months ago to 1 month ago (skips the short-term reversal month)
    momentum = None
    if len(close) > TRADING_DAYS:
        momentum = float(close.iloc[-21] / close.iloc[-TRADING_DAYS - 1] - 1)

    log_ret = np.log(last_year / last_year.shift(1)).dropna()
    vol = float(log_ret.std() * math.sqrt(TRADING_DAYS)) if len(log_ret) > 20 else None

    running_max = close.cummax()
    drawdowns = close / running_max - 1

    weekly = to_weekly(df)
    rsi_w = _rsi_pandas(weekly["Close"]).iloc[-1] if len(weekly) > 15 else None
    levels = _cluster(_swing_points(weekly.iloc[-156:], window=3), tolerance=0.03)  # last ~3 years of weekly swings
    support = sorted((lv for lv in levels if lv < last), reverse=True)[:3]
    resistance = sorted(lv for lv in levels if lv > last)[:3]

    stock_1y = _return_over(close, TRADING_DAYS)
    bench_1y = beta = None
    if bench_df is not None and not bench_df.empty:
        b_close = bench_df["Close"]
        bench_1y = _return_over(b_close, TRADING_DAYS)
        s_ret = pd.Series(close.pct_change().to_numpy(), index=_naive(close.index))
        b_ret = pd.Series(b_close.pct_change().to_numpy(), index=_naive(b_close.index))
        joined = pd.concat([s_ret, b_ret], axis=1, join="inner").dropna().iloc[-TRADING_DAYS:]
        if len(joined) > 60 and joined.iloc[:, 1].var() > 0:
            beta = float(joined.iloc[:, 0].cov(joined.iloc[:, 1]) / joined.iloc[:, 1].var())

    years = (df.index[-1] - df.index[0]).days / 365.25

    return LongTerm(
        years_of_data=round(years, 1),
        sma_50=_r(sma50),
        sma_200=_r(sma200),
        price_vs_sma200_pct=_pct(last / sma200 - 1) if sma200 else None,
        trend=trend,
        high_52w=_r(high_52w),
        low_52w=_r(low_52w),
        pct_from_52w_high=_pct(last / high_52w - 1),
        pct_from_52w_low=_pct(last / low_52w - 1),
        return_1y_pct=_pct(stock_1y),
        cagr_3y_pct=_pct(_cagr(close, 3)),
        cagr_5y_pct=_pct(_cagr(close, 5)),
        momentum_12_1_pct=_pct(momentum),
        volatility_1y_pct=_pct(vol),
        max_drawdown_pct=_pct(float(drawdowns.min())),
        current_drawdown_pct=_pct(float(drawdowns.iloc[-1])),
        rsi_weekly_14=_r(rsi_w, 1) if rsi_w is not None else None,
        weekly_support=[_r(x) for x in support],
        weekly_resistance=[_r(x) for x in resistance],
        benchmark=benchmark,
        benchmark_return_1y_pct=_pct(bench_1y),
        relative_return_1y_pct=_pct(stock_1y - bench_1y) if stock_1y is not None and bench_1y is not None else None,
        beta_1y=_r(beta, 2),
    )
