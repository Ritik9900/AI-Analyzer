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


class LongTerm(BaseModel):
    """Multi-year trend, return and risk picture (daily data, up to 5 years)."""

    years_of_data: float
    sma_50: float | None
    sma_200: float | None
    price_vs_sma200_pct: float | None
    trend: Literal["uptrend", "downtrend", "sideways", "unknown"]
    high_52w: float
    low_52w: float
    pct_from_52w_high: float
    pct_from_52w_low: float
    return_1y_pct: float | None
    cagr_3y_pct: float | None
    cagr_5y_pct: float | None
    momentum_12_1_pct: float | None  # 12-month return excluding the last month (classic momentum factor)
    volatility_1y_pct: float | None
    max_drawdown_pct: float  # worst peak-to-trough over the available history
    current_drawdown_pct: float  # distance below the highest close in the available history
    rsi_weekly_14: float | None
    weekly_support: list[float]
    weekly_resistance: list[float]
    benchmark: str | None
    benchmark_return_1y_pct: float | None
    relative_return_1y_pct: float | None  # stock 1y return minus benchmark 1y return
    beta_1y: float | None


class PiotroskiTest(BaseModel):
    name: str
    passed: bool | None  # None = data not available


class Fundamentals(BaseModel):
    available: bool
    sector: str | None = None
    industry: str | None = None
    market_cap: float | None = None
    pe_trailing: float | None = None
    pe_forward: float | None = None
    price_to_book: float | None = None
    peg: float | None = None
    roe_pct: float | None = None
    roa_pct: float | None = None
    debt_to_equity: float | None = None  # ratio, e.g. 0.78
    current_ratio: float | None = None
    gross_margin_pct: float | None = None
    operating_margin_pct: float | None = None
    profit_margin_pct: float | None = None
    revenue_growth_pct: float | None = None  # latest quarter, YoY
    earnings_growth_pct: float | None = None  # latest quarter, YoY
    dividend_yield_pct: float | None = None
    payout_ratio_pct: float | None = None
    free_cash_flow: float | None = None
    analyst_target_mean: float | None = None
    analyst_target_low: float | None = None
    analyst_target_high: float | None = None
    analyst_upside_pct: float | None = None
    analyst_rating: str | None = None
    analyst_count: int | None = None
    piotroski_score: int | None = None
    piotroski_max: int | None = None  # number of the 9 tests with usable data
    piotroski_tests: list[PiotroskiTest] = []
    fiscal_year: str | None = None
    note: str | None = None


class Forecast(BaseModel):
    model: str
    is_mock: bool
    frequency: Literal["daily", "weekly"]
    horizon_periods: int
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
    name: str | None
    currency: str | None
    as_of: str
    history: list[PricePoint]  # weekly closes
    long_term: LongTerm
    fundamentals: Fundamentals
    technicals: Technicals  # daily, last ~6 months: entry timing only
    forecast: Forecast


class AnalyzeSignals(PositionSignals):
    sentiment: Sentiment
