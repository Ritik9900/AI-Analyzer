"""Pydantic request/response contracts. Mirrored in frontend/src/lib/types.ts."""

from typing import Literal

from pydantic import BaseModel, Field

# Yahoo symbols: AAPL, BRK-B, RELIANCE.NS, ^GSPC, EURUSD=X, BTC-USD
TICKER_PATTERN = r"^[A-Za-z0-9.\-^=]{1,20}$"


class TickerRequest(BaseModel):
    ticker: str = Field(pattern=TICKER_PATTERN)


class QuotesRequest(BaseModel):
    tickers: list[str] = Field(max_length=200)


class Quote(BaseModel):
    ticker: str
    price: float | None = None
    previous_close: float | None = None
    currency: str | None = None
    error: str | None = None


class QuotesResponse(BaseModel):
    quotes: list[Quote]


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=60)


class SymbolMatch(BaseModel):
    symbol: str
    name: str | None
    exchange: str | None
    type: str | None


class SearchResponse(BaseModel):
    results: list[SymbolMatch]


class PricePoint(BaseModel):
    date: str
    close: float


class Technicals(BaseModel):
    indicator_engine: Literal["pandas-ta", "pandas"]
    last_close: float
    sma_20: float | None
    sma_50: float | None
    rsi_14: float | None
    rsi_state: Literal["overbought", "oversold", "neutral", "unknown"]
    macd: float | None
    macd_signal: float | None
    macd_hist: float | None
    macd_trend: Literal["bullish", "bearish", "unknown"]
    macd_crossover: Literal["bullish", "bearish", "none"]
    macd_crossover_bars_ago: int | None
    atr_14: float | None
    volatility_annual_pct: float | None
    support: list[float]
    resistance: list[float]
    high_period: float
    low_period: float
    change_period_pct: float


class ForecastPoint(BaseModel):
    date: str
    p10: float
    p50: float
    p90: float


class Forecast(BaseModel):
    model: str
    is_mock: bool
    horizon_trading_days: int
    points: list[ForecastPoint]
    expected_return_pct: float
    p10_end: float
    p90_end: float
    note: str | None = None


class Headline(BaseModel):
    title: str
    publisher: str | None = None
    published_at: str | None = None
    link: str | None = None
    label: Literal["positive", "negative", "neutral"]
    score: float  # P(positive) - P(negative), in [-1, 1]


class Sentiment(BaseModel):
    model: str
    is_mock: bool
    score: float
    label: Literal["positive", "negative", "neutral"]
    headlines: list[Headline]
    note: str | None = None


class PositionSignals(BaseModel):
    ticker: str
    currency: str | None
    as_of: str
    history: list[PricePoint]
    technicals: Technicals
    forecast: Forecast


class AnalyzeSignals(PositionSignals):
    name: str | None
    sentiment: Sentiment
