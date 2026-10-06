"""RSI, MACD, ATR (pandas-ta, with pure-pandas fallback) and swing-based support/resistance."""

import logging
import math

import numpy as np
import pandas as pd

from app.schemas import Technicals

logger = logging.getLogger(__name__)

try:  # pandas-ta is fragile across numpy/Python versions; never let it break the service.
    import pandas_ta as ta

    HAS_PANDAS_TA = True
except Exception as exc:  # noqa: BLE001
    ta = None
    HAS_PANDAS_TA = False
    logger.warning("pandas-ta unavailable (%s); using built-in indicator formulas", exc)


class InsufficientHistory(Exception):
    pass


MIN_BARS = 35  # MACD(12,26,9) needs 26 + 9 bars


def _r(value, digits: int = 4) -> float | None:
    if value is None:
        return None
    f = float(value)
    return None if math.isnan(f) or math.isinf(f) else round(f, digits)


# --- Indicator engines ----------------------------------------------------------------


def _rsi_pandas(close: pd.Series, length: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / length, min_periods=length, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / length, min_periods=length, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(100.0).where(loss.notna())


def _macd_pandas(close: pd.Series) -> tuple[pd.Series, pd.Series, pd.Series]:
    macd = close.ewm(span=12, adjust=False).mean() - close.ewm(span=26, adjust=False).mean()
    signal = macd.ewm(span=9, adjust=False).mean()
    return macd, signal, macd - signal


def _atr_pandas(df: pd.DataFrame, length: int = 14) -> pd.Series:
    prev_close = df["Close"].shift(1)
    tr = pd.concat(
        [df["High"] - df["Low"], (df["High"] - prev_close).abs(), (df["Low"] - prev_close).abs()], axis=1
    ).max(axis=1)
    return tr.ewm(alpha=1 / length, min_periods=length, adjust=False).mean()


def _indicators(df: pd.DataFrame) -> tuple[str, pd.Series, pd.Series, pd.Series, pd.Series, pd.Series]:
    close = df["Close"]
    if HAS_PANDAS_TA:
        try:
            rsi = ta.rsi(close, length=14)
            macd_df = ta.macd(close, fast=12, slow=26, signal=9)
            atr = ta.atr(df["High"], df["Low"], close, length=14)
            cols = {c[:5]: c for c in macd_df.columns}  # MACD_, MACDh, MACDs
            return (
                "pandas-ta",
                rsi,
                macd_df[cols["MACD_"]],
                macd_df[cols["MACDs"]],
                macd_df[cols["MACDh"]],
                atr,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("pandas-ta computation failed (%s); falling back", exc)
    macd, signal, hist = _macd_pandas(close)
    return "pandas", _rsi_pandas(close), macd, signal, hist, _atr_pandas(df)


# --- Support / resistance -------------------------------------------------------------


def _swing_points(df: pd.DataFrame, window: int = 5) -> list[float]:
    span = 2 * window + 1
    highs, lows = df["High"], df["Low"]
    swing_highs = highs[highs == highs.rolling(span, center=True).max()]
    swing_lows = lows[lows == lows.rolling(span, center=True).min()]
    return [float(x) for x in pd.concat([swing_highs, swing_lows]).dropna()]


def _cluster(levels: list[float], tolerance: float = 0.015) -> list[float]:
    """Merge levels within `tolerance` of each other; return cluster means."""
    clusters: list[list[float]] = []
    for level in sorted(levels):
        if clusters and abs(level - np.mean(clusters[-1])) / np.mean(clusters[-1]) <= tolerance:
            clusters[-1].append(level)
        else:
            clusters.append([level])
    return [float(np.mean(c)) for c in clusters]


def _support_resistance(df: pd.DataFrame, last: float, count: int = 3) -> tuple[list[float], list[float]]:
    levels = _cluster(_swing_points(df))
    support = sorted((lv for lv in levels if lv < last), reverse=True)[:count]
    resistance = sorted(lv for lv in levels if lv > last)[:count]
    if not support:
        support = [float(df["Low"].min())]
    if not resistance and float(df["High"].max()) > last:
        resistance = [float(df["High"].max())]
    return [_r(x) for x in support], [_r(x) for x in resistance]


# --- Public ---------------------------------------------------------------------------


def _recent_crossover(hist: pd.Series, lookback: int = 5) -> tuple[str, int | None]:
    h = hist.dropna()
    for bars_ago in range(0, min(lookback, len(h) - 1)):
        cur, prev = h.iloc[-1 - bars_ago], h.iloc[-2 - bars_ago]
        if prev <= 0 < cur:
            return "bullish", bars_ago
        if prev >= 0 > cur:
            return "bearish", bars_ago
    return "none", None


def compute_technicals(df: pd.DataFrame) -> Technicals:
    if len(df) < MIN_BARS:
        raise InsufficientHistory(f"Need at least {MIN_BARS} daily bars, got {len(df)}")

    close = df["Close"]
    last = float(close.iloc[-1])
    engine, rsi, macd, signal, hist, atr = _indicators(df)

    rsi_last = _r(rsi.iloc[-1], 2)
    if rsi_last is None:
        rsi_state = "unknown"
    elif rsi_last >= 70:
        rsi_state = "overbought"
    elif rsi_last <= 30:
        rsi_state = "oversold"
    else:
        rsi_state = "neutral"

    hist_last = _r(hist.iloc[-1])
    macd_trend = "unknown" if hist_last is None else ("bullish" if hist_last > 0 else "bearish")
    crossover, bars_ago = _recent_crossover(hist)

    log_ret = np.log(close / close.shift(1)).dropna()
    vol = _r(log_ret.std() * math.sqrt(252) * 100, 2) if len(log_ret) > 1 else None

    support, resistance = _support_resistance(df, last)

    return Technicals(
        indicator_engine=engine,
        last_close=_r(last),
        sma_20=_r(close.rolling(20).mean().iloc[-1]),
        sma_50=_r(close.rolling(50).mean().iloc[-1]) if len(close) >= 50 else None,
        rsi_14=rsi_last,
        rsi_state=rsi_state,
        macd=_r(macd.iloc[-1]),
        macd_signal=_r(signal.iloc[-1]),
        macd_hist=hist_last,
        macd_trend=macd_trend,
        macd_crossover=crossover,
        macd_crossover_bars_ago=bars_ago,
        atr_14=_r(atr.iloc[-1]),
        volatility_annual_pct=vol,
        support=support,
        resistance=resistance,
        high_period=_r(df["High"].max()),
        low_period=_r(df["Low"].min()),
        change_period_pct=_r((last / float(close.iloc[0]) - 1) * 100, 2),
    )
