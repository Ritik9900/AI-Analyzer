"""yfinance wrappers: price history, latest quotes, recent news headlines."""

import logging
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf

from app.config import settings
from app.schemas import Quote, SymbolMatch

logger = logging.getLogger(__name__)


class TickerNotFound(Exception):
    pass


def _clean(value) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def get_history(ticker: str, period: str | None = None) -> pd.DataFrame:
    """Daily OHLCV, unadjusted closes (so P/L lines up with what the user actually paid)."""
    df = yf.Ticker(ticker).history(period=period or settings.lookback_period, interval="1d", auto_adjust=False)
    if df is None or df.empty or "Close" not in df:
        raise TickerNotFound(f"No price history for '{ticker}'")
    df = df.dropna(subset=["Close"])
    if df.empty:
        raise TickerNotFound(f"No price history for '{ticker}'")
    return df


def benchmark_for(ticker: str) -> str:
    """Broad-market index to compare against: NIFTY 50 for Indian listings, S&P 500 otherwise."""
    return "^NSEI" if ticker.upper().endswith((".NS", ".BO")) else "^GSPC"


def get_benchmark_history(ticker: str) -> tuple[str, pd.DataFrame | None]:
    symbol = benchmark_for(ticker)
    try:
        return symbol, get_history(symbol)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Benchmark %s unavailable: %s", symbol, exc)
        return symbol, None


def get_info(ticker: str) -> dict:
    try:
        return yf.Ticker(ticker).info or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("info failed for %s: %s", ticker, exc)
        return {}


def get_financials(ticker: str) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Annual income statement, balance sheet and cash flow (columns = fiscal years, newest first)."""
    t = yf.Ticker(ticker)
    frames = []
    for attr in ("income_stmt", "balance_sheet", "cashflow"):
        try:
            df = getattr(t, attr)
            frames.append(df if isinstance(df, pd.DataFrame) else pd.DataFrame())
        except Exception as exc:  # noqa: BLE001
            logger.warning("%s failed for %s: %s", attr, ticker, exc)
            frames.append(pd.DataFrame())
    return frames[0], frames[1], frames[2]


def get_currency(ticker: str) -> str | None:
    try:
        return yf.Ticker(ticker).fast_info.currency
    except Exception:
        return None


# --- Quotes (small TTL cache so dashboard refreshes don't hammer Yahoo) ---------------

_quote_cache: dict[str, tuple[float, Quote]] = {}
_cache_lock = threading.Lock()


def _fetch_quote(ticker: str) -> Quote:
    t = yf.Ticker(ticker)
    try:
        fi = t.fast_info
        price = _clean(fi.last_price)
        prev = _clean(fi.previous_close)
        currency = fi.currency
        if price is not None:
            return Quote(ticker=ticker, price=price, previous_close=prev, currency=currency)
    except Exception as exc:
        logger.debug("fast_info failed for %s: %s", ticker, exc)

    # Fallback: last daily close.
    try:
        df = t.history(period="5d", interval="1d", auto_adjust=False).dropna(subset=["Close"])
        if not df.empty:
            prev = _clean(df["Close"].iloc[-2]) if len(df) > 1 else None
            return Quote(ticker=ticker, price=_clean(df["Close"].iloc[-1]), previous_close=prev)
    except Exception as exc:
        logger.debug("history fallback failed for %s: %s", ticker, exc)

    return Quote(ticker=ticker, error="Price unavailable")


def get_quotes(tickers: list[str]) -> list[Quote]:
    now = time.monotonic()
    unique = list(dict.fromkeys(t.upper() for t in tickers))
    results: dict[str, Quote] = {}
    missing: list[str] = []

    with _cache_lock:
        for t in unique:
            hit = _quote_cache.get(t)
            if hit and now - hit[0] < settings.quote_cache_seconds:
                results[t] = hit[1]
            else:
                missing.append(t)

    if missing:
        with ThreadPoolExecutor(max_workers=min(8, len(missing))) as pool:
            for quote in pool.map(_fetch_quote, missing):
                results[quote.ticker] = quote
                if quote.error is None:
                    with _cache_lock:
                        _quote_cache[quote.ticker] = (now, quote)

    return [results[t] for t in unique]


# --- Symbol search --------------------------------------------------------------------

# Derivatives can't be held as a simple position; everything else is fair game.
_EXCLUDED_TYPES = {"FUTURE", "OPTION"}


def search_symbols(query: str, limit: int = 8) -> list[SymbolMatch]:
    """Yahoo symbol search by name or (possibly misspelled) symbol, e.g. 'tata silver', 'TATASILV'."""
    try:
        s = yf.Search(query, max_results=limit * 2, news_count=0, lists_count=0, enable_fuzzy_query=True, raise_errors=False)
        quotes = s.quotes or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("Symbol search failed for %r: %s", query, exc)
        return []

    results: list[SymbolMatch] = []
    for q in quotes:
        symbol = q.get("symbol")
        qtype = q.get("quoteType")
        if not symbol or qtype in _EXCLUDED_TYPES:
            continue
        name = q.get("longname") or q.get("shortname")
        results.append(
            SymbolMatch(
                symbol=symbol,
                name=None if name == symbol else name,
                exchange=q.get("exchDisp") or q.get("exchange"),
                type=q.get("typeDisp") or qtype,
            )
        )
        if len(results) >= limit:
            break
    return results


# --- News -----------------------------------------------------------------------------


def get_headlines(ticker: str, limit: int | None = None) -> list[dict]:
    """Normalises both the legacy and the current (`content`-nested) yfinance news formats."""
    limit = limit or settings.max_headlines
    try:
        raw = yf.Ticker(ticker).news or []
    except Exception as exc:
        logger.warning("News fetch failed for %s: %s", ticker, exc)
        return []

    items: list[dict] = []
    for item in raw:
        content = item.get("content") if isinstance(item.get("content"), dict) else None
        if content:
            title = content.get("title")
            publisher = (content.get("provider") or {}).get("displayName")
            published_at = content.get("pubDate") or content.get("displayTime")
            link = (content.get("canonicalUrl") or {}).get("url") or (content.get("clickThroughUrl") or {}).get("url")
        else:
            title = item.get("title")
            publisher = item.get("publisher")
            ts = item.get("providerPublishTime")
            published_at = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None
            link = item.get("link")
        if title:
            items.append({"title": title.strip(), "publisher": publisher, "published_at": published_at, "link": link})
        if len(items) >= limit:
            break
    return items
