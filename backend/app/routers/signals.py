"""Signal pipelines for long-term equity investing.

POST /signals/position — 5y history + benchmark -> long-term trend/risk, fundamentals + Piotroski,
                         short-term timing indicators, Chronos forecast on weekly closes
POST /signals/analyze  — the above + FinBERT sentiment over recent headlines
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.schemas import AnalyzeSignals, PositionSignals, PricePoint, TickerRequest
from app.services import forecast, fundamentals, longterm, market_data, sentiment, technicals

router = APIRouter(prefix="/signals", tags=["signals"])

WEEKLY_HISTORY_POINTS = 260  # ~5 years of weekly closes for the chart and the forecast context


def _base_signals(ticker: str, with_news: bool = False) -> dict:
    # Independent Yahoo calls in parallel; only the price history is mandatory.
    with ThreadPoolExecutor(max_workers=5) as pool:
        f_hist = pool.submit(market_data.get_history, ticker)
        f_bench = pool.submit(market_data.get_benchmark_history, ticker)
        f_info = pool.submit(market_data.get_info, ticker)
        f_fin = pool.submit(market_data.get_financials, ticker)
        f_news = pool.submit(market_data.get_headlines, ticker) if with_news else None

        try:
            df = f_hist.result()
            tech = technicals.compute_technicals(df.iloc[-settings.timing_window_days :])
        except market_data.TickerNotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except technicals.InsufficientHistory as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        bench_symbol, bench_df = f_bench.result()
        info = f_info.result()
        statements = f_fin.result()
        headlines = f_news.result() if f_news else None

    last = float(df["Close"].iloc[-1])
    weekly_close = longterm.to_weekly(df)["Close"].iloc[-WEEKLY_HISTORY_POINTS:]

    signals = {
        "ticker": ticker,
        "name": info.get("longName") or info.get("shortName"),
        "currency": info.get("currency") or market_data.get_currency(ticker),
        "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "history": [PricePoint(date=idx.strftime("%Y-%m-%d"), close=round(float(c), 4)) for idx, c in weekly_close.items()],
        "long_term": longterm.compute_long_term(df, bench_symbol, bench_df),
        "fundamentals": fundamentals.compute_fundamentals(info, statements, last),
        "technicals": tech,
        "forecast": forecast.forecast(weekly_close, settings.forecast_horizon_weeks, "weekly"),
    }
    if with_news:
        signals["sentiment"] = sentiment.analyze(headlines or [])
    return signals


@router.post("/position", response_model=PositionSignals)
def position_signals(body: TickerRequest) -> PositionSignals:
    return PositionSignals(**_base_signals(body.ticker.upper()))


@router.post("/analyze", response_model=AnalyzeSignals)
def analyze_signals(body: TickerRequest) -> AnalyzeSignals:
    return AnalyzeSignals(**_base_signals(body.ticker.upper(), with_news=True))
